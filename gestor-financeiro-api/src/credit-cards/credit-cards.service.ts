// ============================================================
// credit-cards.service.ts
// ============================================================
// Regras de negócio centrais deste módulo:
//
// 1. Ao criar um cartão, já geramos a fatura do ciclo atual (com total
//    zerado) usando a mesma `resolveInvoicePeriod` que o
//    TransactionsService usa para decidir em qual fatura uma compra
//    cai. Isso evita que a primeira compra do cartão dispare um
//    `upsert` "silencioso" de fatura sem o usuário nunca ter visto a
//    fatura existir antes disso.
//
// 2. `closingDay`/`dueDay` não são editáveis pelo PATCH genérico. Uma
//    vez que existam faturas geradas, mudar o dia de fechamento
//    invalidaria os períodos já calculados no histórico (a mesma
//    lógica de "não mexer no initialBalance depois de haver
//    transações", aplicada aqui a ciclo de fatura).
//
// 3. Limite disponível = limite total - soma das faturas não pagas
//    (não só a fatura "atual" — se o usuário atrasou duas faturas, as
//    duas continuam consumindo limite até serem pagas).
//
// 4. Exclusão vira soft-delete se houver qualquer fatura ou transação
//    vinculada — mesma lógica já aplicada em BankAccountsService.
// ============================================================

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';
import { CicloDoCartao, cicloDoDia, datasDoMesChave } from './billing-cycle';
import { ORDEM_DA_LISTA, gravarOrdem, novaOrdem } from '../common/ordering';
import { chaveDoMes, dia, faturaAtual, hojeNoFuso, limiteEmUso, montarFaturas, proximoMes } from './invoice-statement';

interface CreateCreditCardInput {
  userId: string;
  name: string;
  limitAmount: number;
  closingDay: number;
  dueDay: number;
  bankAccountId?: string;
  color?: string;
}

interface UpdateCreditCardInput {
  name?: string;
  limitAmount?: number;
  bankAccountId?: string;
  color?: string;
}

@Injectable()
export class CreditCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCreditCardInput) {
    if (input.bankAccountId) {
      await this.assertBankAccountBelongsToUser(input.userId, input.bankAccountId);
    }

    return this.prisma.$transaction(async (tx) => {
      const ultimo = await tx.creditCard.findFirst({
        where: { userId: input.userId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const card = await tx.creditCard.create({
        data: {
          userId: input.userId,
          name: input.name,
          limitAmount: input.limitAmount,
          closingDay: input.closingDay,
          dueDay: input.dueDay,
          bankAccountId: input.bankAccountId,
          color: input.color,
          sortOrder: ultimo ? ultimo.sortOrder + 1 : 0, // novo cartão entra no fim
        },
      });

      // Já cria a fatura do ciclo atual, com total zerado, para o
      // dashboard poder mostrar "fatura atual: R$ 0,00" desde o primeiro
      // instante — sem depender da primeira compra ou do cron noturno.
      // "Hoje" é o dia do calendário no fuso do app: às 22h do dia do
      // fechamento, no Brasil, já é o dia seguinte em UTC.
      const { referenceMonth, closingDate, dueDate } = cicloDoDia(hojeNoFuso(), {
        closingDay: input.closingDay,
        dueDay: input.dueDay,
      });

      await tx.creditCardInvoice.create({
        data: {
          creditCardId: card.id,
          referenceMonth,
          closingDate,
          dueDate,
          totalAmount: 0,
          status: InvoiceStatus.OPEN,
        },
      });

      return card;
    });
  }

  async findAllByUser(userId: string, includeInactive = false) {
    const cards = await this.prisma.creditCard.findMany({
      where: { userId, isActive: includeInactive ? undefined : true },
      orderBy: ORDEM_DA_LISTA,
      // A linha do tempo vai junto: o app tem o mesmo motor de fatura aqui
      // dentro, e sem ela a tela calcularia as faturas antigas com os dias
      // de hoje.
      include: { cycles: { orderBy: { validFrom: 'asc' } } },
    });
    return this.comViradas(cards);
  }

  /**
   * As faturas VIRADAS entram no próprio cartão: `{ '2026-12': '2026-11-23' }`.
   *
   * O app precisa delas em toda tela de lançamento — é o que diz se a compra de
   * hoje cai na fatura deste mês ou na seguinte — e lê-las fatura por fatura
   * seria uma requisição por cartão para buscar um campo. Aqui é uma consulta
   * para todos os cartões, e ela só traz as viradas, que são a exceção.
   */
  private async comViradas<T extends { id: string }>(cards: T[]) {
    const vazio: Record<string, string> = {};
    if (!cards.length) return cards.map((c) => ({ ...c, earlyClosures: vazio }));

    const linhas = await this.prisma.creditCardInvoice.findMany({
      where: { creditCardId: { in: cards.map((c) => c.id) }, earlyClosedAt: { not: null } },
      select: { creditCardId: true, referenceMonth: true, earlyClosedAt: true },
    });
    const porCartao = new Map<string, Record<string, string>>();
    for (const l of linhas) {
      const mapa = porCartao.get(l.creditCardId) ?? {};
      mapa[chaveDoMes(l.referenceMonth)] = dia(l.earlyClosedAt!);
      porCartao.set(l.creditCardId, mapa);
    }
    return cards.map((c) => ({ ...c, earlyClosures: porCartao.get(c.id) ?? vazio }));
  }

  /** Nova ordem dos cartões (arrastar na lista). Ver common/ordering.ts. */
  async reorder(userId: string, ids: string[]) {
    const atuais = await this.prisma.creditCard.findMany({
      where: { userId },
      orderBy: ORDEM_DA_LISTA,
      select: { id: true, sortOrder: true },
    });
    const final = novaOrdem(ids, atuais);
    await this.prisma.$transaction(async (tx) => {
      await gravarOrdem(final, atuais, (id, sortOrder) => tx.creditCard.update({ where: { id }, data: { sortOrder } }));
    });
    return { order: final };
  }

  /** 'AAAA-MM' no dia 1 em UTC, que é como a coluna @db.Date guarda o mês. */
  private mesParaDia1(chave: string): Date {
    const [ano, mes] = chave.split('-').map(Number);
    return new Date(Date.UTC(ano, mes - 1, 1));
  }

  async findOneByUser(userId: string, creditCardId: string) {
    const card = await this.prisma.creditCard.findFirst({
      where: { id: creditCardId, userId },
      // Com a linha do tempo: quem pergunta pelo cartão costuma em seguida
      // perguntar por fatura, e aí os dias certos dependem dela.
      include: { cycles: { orderBy: { validFrom: 'asc' } } },
    });
    if (!card) throw new NotFoundException('Cartão de crédito não encontrado');
    return card;
  }

  // Visão consolidada para a Tela de Controle de Cartões: dados do cartão,
  // limite disponível, fatura atual e a sequência de faturas — tudo saído de
  // `montarFaturas`, a mesma regra que o pagamento usa.
  async getOverview(userId: string, creditCardId: string) {
    const card = await this.findOneByUser(userId, creditCardId);
    const invoices = await this.faturasCalculadas(card);
    return {
      ...card,
      availableLimit: Number(card.limitAmount) - limiteEmUso(invoices),
      currentInvoice: faturaAtual(invoices),
      invoices,
    };
  }

  // Limite disponível = limite - o que está em aberto em TODAS as faturas
  // (não só a atual): atrasadas continuam ocupando limite, transportadas
  // contam uma vez só (na fatura que recebeu o transporte), pagamentos
  // parciais já liberam o que pagaram.
  //
  // Pode passar do limite do cartão, e isso é decisão de produto: estorno
  // maior que as compras deixa saldo credor, que aumenta o disponível. Não
  // limitar a `limitAmount`.
  async getAvailableLimit(creditCardId: string, limitAmount: number) {
    const card = await this.prisma.creditCard.findUnique({ where: { id: creditCardId }, include: { cycles: { orderBy: { validFrom: 'asc' } } } });
    if (!card) throw new NotFoundException('Cartão de crédito não encontrado');
    return limitAmount - limiteEmUso(await this.faturasCalculadas(card));
  }

  private async faturasCalculadas(card: CicloDoCartao & { id: string }) {
    const gravadas = await this.prisma.creditCardInvoice.findMany({
      where: { creditCardId: card.id },
      include: { payments: true },
      orderBy: { referenceMonth: 'asc' },
    });
    return montarFaturas(card, gravadas, hojeNoFuso());
  }

  async update(userId: string, creditCardId: string, input: UpdateCreditCardInput) {
    await this.findOneByUser(userId, creditCardId);

    if (input.bankAccountId) {
      await this.assertBankAccountBelongsToUser(userId, input.bankAccountId);
    }

    return this.prisma.creditCard.update({
      where: { id: creditCardId },
      data: input,
    });
  }

  // Único caminho para mudar closingDay/dueDay — bloqueado se já
  // existir qualquer fatura gerada para este cartão.
  /**
   * Troca o ciclo A PARTIR de uma fatura, que é como o banco faz: muda-se o
   * vencimento, o fechamento vai junto, e a fatura que já fechou continua com
   * as datas que teve.
   *
   * Antes isto era proibido depois da primeira fatura, e a proibição era um
   * remendo: com UM par de dias por cartão, trocar os dias reescrevia o
   * passado inteiro — cada compra reagrupada, cada fatura velha com outra
   * data. Com a linha do tempo (`credit_card_billing_cycles`) o passado fica
   * onde está, e a troca é só mais um período.
   *
   * De qual fatura em diante: a aberta agora, ou a seguinte. Fatura fechada
   * não se mexe — esse é o pedido —, e agendar para daqui a meio ano deixaria
   * a tela prometendo um ciclo que ninguém lembraria de conferir.
   *
   * Cartão que ainda não rodou (no máximo a fatura que nasce com ele) não
   * ganha período novo: o primeiro é REESCRITO. É o caso de quem errou o dia
   * no cadastro, e inventar histórico para isso seria guardar um erro de
   * digitação como se fosse um fato da vida do cartão.
   */
  async updateBillingCycle(
    userId: string,
    creditCardId: string,
    closingDay: number,
    dueDay: number,
    validFrom?: string,
  ) {
    const card = await this.findOneByUser(userId, creditCardId);

    const invoiceCount = await this.prisma.creditCardInvoice.count({
      where: { creditCardId },
    });

    // Toda criação de cartão já gera 1 fatura (a do ciclo atual), então
    // "mais de 1" é o sinal real de que o cartão já está em uso.
    const emUso = invoiceCount > 1;

    const atual = chaveDoMes(cicloDoDia(hojeNoFuso(), card).referenceMonth);
    const seguinte = proximoMes(atual);
    const alvo = validFrom ?? atual;

    if (emUso && alvo !== atual && alvo !== seguinte) {
      throw new BadRequestException(
        `A troca vale da fatura aberta (${atual}) ou da seguinte (${seguinte}). ` +
          'Fatura que já fechou não muda de data.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (emUso) {
        const inicio = this.mesParaDia1(alvo);
        await tx.creditCardBillingCycle.upsert({
          where: { creditCardId_validFrom: { creditCardId, validFrom: inicio } },
          create: { creditCardId, validFrom: inicio, closingDay, dueDay },
          update: { closingDay, dueDay },
        });
      } else {
        // Sem uso: o período de origem é reescrito, e com ele some qualquer
        // outro que tenha sobrado de uma troca anterior deste mesmo cartão
        // parado.
        await tx.creditCardBillingCycle.deleteMany({ where: { creditCardId } });
        await tx.creditCardBillingCycle.create({
          data: { creditCardId, validFrom: new Date(Date.UTC(1900, 0, 1)), closingDay, dueDay },
        });
      }

      // As colunas do cartão são o período de AGORA: elas só mudam quando a
      // troca já vale hoje. Agendada para a fatura seguinte, quem realinha é
      // o job diário — e, enquanto isso, toda leitura que decide fatura já
      // carrega a linha do tempo, que é a verdade.
      const valeAgora = !emUso || alvo === atual;
      const atualizado = valeAgora
        ? await tx.creditCard.update({ where: { id: creditCardId }, data: { closingDay, dueDay } })
        : card;

      // A fatura do ciclo corrente pode ter nascido com as datas antigas.
      // Recalculada aqui, ela não fica mentindo até o cron da madrugada.
      if (valeAgora) {
        const datas = datasDoMesChave(atual, { closingDay, dueDay });
        await tx.creditCardInvoice.updateMany({
          where: { creditCardId, referenceMonth: datas.referenceMonth },
          data: { closingDate: datas.closingDate, dueDate: datas.dueDate },
        });
      }

      return atualizado;
    });
  }

  async delete(userId: string, creditCardId: string) {
    await this.findOneByUser(userId, creditCardId);

    const [transactionCount, invoiceCount, paymentCount] = await Promise.all([
      this.prisma.transaction.count({ where: { creditCardId } }),
      this.prisma.creditCardInvoice.count({ where: { creditCardId, totalAmount: { gt: 0 } } }),
      // Pagamento já tirou dinheiro de uma conta: apagar o cartão levaria os
      // pagamentos junto (cascade) e o saldo das contas perderia o lastro.
      this.prisma.invoicePayment.count({ where: { invoice: { creditCardId } } }),
    ]);

    const hasHistory = transactionCount > 0 || invoiceCount > 0 || paymentCount > 0;

    if (hasHistory) {
      await this.prisma.creditCard.update({
        where: { id: creditCardId },
        data: { isActive: false },
      });
      return { deleted: false, archived: true };
    }

    // Sem histórico real de uso: pode remover, inclusive a fatura vazia
    // criada automaticamente na hora do cadastro.
    return this.prisma.$transaction(async (tx) => {
      await tx.creditCardInvoice.deleteMany({ where: { creditCardId } });
      await tx.creditCard.delete({ where: { id: creditCardId } });
      return { deleted: true, archived: false };
    });
  }

  private async assertBankAccountBelongsToUser(userId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, userId },
    });
    if (!account) throw new NotFoundException('Conta bancária não encontrada');
  }
}
