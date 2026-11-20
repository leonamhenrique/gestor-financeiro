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
import { CicloDoCartao, cicloDoDia, datasDoMesChave, referenciaComVencimentoEm } from './billing-cycle';
import { resolveInvoicePeriod } from '../transactions/transaction.utils';
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

      // O período de origem, valendo desde sempre. Sem ele, a primeira troca
      // de vencimento deste cartão criaria o ÚNICO período da lista — e as
      // faturas anteriores a ele, sem nenhum período que as cubra, passariam
      // a usar os dias novos. O passado mudaria de data, que é exatamente o
      // que a linha do tempo existe para impedir.
      await tx.creditCardBillingCycle.create({
        data: {
          creditCardId: card.id,
          validFrom: CreditCardsService.DESDE_SEMPRE,
          closingDay: input.closingDay,
          dueDay: input.dueDay,
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

  /** O começo do primeiro período: "desde sempre". Um marco, e não uma data
   * de verdade — é o que faz a busca pelo período de uma fatura nunca voltar
   * vazia, inclusive para fatura importada de antes do cadastro do cartão. */
  private static readonly DESDE_SEMPRE = new Date(Date.UTC(1900, 0, 1));

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
        // Cinto e suspensório: cartão de antes desta tabela, ou criado numa
        // janela em que o backfill não o alcançou, não tem período de
        // origem — e sem ele o período novo responderia também pelo passado.
        // Criar o de origem com os dias de HOJE é o que mantém as faturas
        // velhas exatamente como elas estão.
        if (!card.cycles?.length) {
          await tx.creditCardBillingCycle.create({
            data: {
              creditCardId,
              validFrom: CreditCardsService.DESDE_SEMPRE,
              closingDay: card.closingDay,
              dueDay: card.dueDay,
            },
          });
        }

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
          data: { creditCardId, validFrom: CreditCardsService.DESDE_SEMPRE, closingDay, dueDay },
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

  /**
   * CORRIGE os dias do cartão: eles sempre foram estes, o cadastro é que
   * estava errado.
   *
   * Diferente de `updateBillingCycle`, que trata o caso em que o cartão
   * REALMENTE mudou de datas e por isso preserva o passado com um ciclo
   * novo a partir da fatura aberta.
   *
   * A diferença não é de gosto, e custou caro para aparecer. Quem usa o
   * caminho errado abre um BURACO no calendário: trocar o vencimento do
   * dia 28 (mesmo mês do fechamento) para o dia 7 (mês seguinte) empurra o
   * vencimento um mês à frente, e a fatura de um mês inteiro deixa de
   * existir — medido, com a fatura de dezembro sumindo da lista e os
   * lançamentos dela aparecendo em janeiro.
   *
   * Aqui o histórico é reescrito: um ciclo só, desde sempre, e todas as
   * faturas recalculadas. É o que torna o calendário contínuo de novo.
   *
   * O QUE NÃO PODE MUDAR: o NOME de nenhuma fatura, e em que fatura cada
   * lançamento está. Para a pessoa, a fatura é "outubro/2026" — e uma fatura
   * já conferida, ou já paga, não pode mudar de conteúdo sozinha.
   *
   * Isto é mais forte do que preservar a referência, e a diferença foi
   * medida: a referência é o mês do FECHAMENTO, o nome é o mês do
   * VENCIMENTO, e a régua decide a distância entre os dois (fecha 1/vence 7
   * vencem no mesmo mês; fecha 30/vence 7 vence no mês seguinte). Preservar a
   * referência preserva o número interno e deixa o nome escorregar — foi
   * exatamente assim que um lançamento de 30/09 saiu de outubro e apareceu em
   * novembro. Então o que se preserva aqui é o nome, e as referências é que
   * são renumeradas por baixo para sustentá-lo.
   */
  async corrigirCiclo(userId: string, creditCardId: string, closingDay: number, dueDay: number) {
    const card = await this.findOneByUser(userId, creditCardId);

    /* O nome que uma fatura tem HOJE, pela régua antiga — com a linha do
     * tempo inteira, porque meses diferentes podem estar em períodos
     * diferentes. É a pergunta "onde isto aparece na tela agora". */
    const nomeDeHoje = (ref: Date) => {
      const datas = datasDoMesChave(chaveDoMes(ref), card);
      return { ano: datas.dueDate.getUTCFullYear(), mes0: datas.dueDate.getUTCMonth() };
    };

    /* E a referência que carrega esse mesmo nome com a régua nova. */
    const paraOnde = (nome: { ano: number; mes0: number }) => {
      const destino = referenciaComVencimentoEm(nome.ano, nome.mes0, closingDay, dueDay);
      if (!destino) {
        /* Recusar alto. O contrário — escolher a referência mais próxima —
         * moveria lançamento de fatura em silêncio, que é a única coisa que
         * esta operação promete nunca fazer. */
        throw new BadRequestException(
          'Com fechamento dia ' + closingDay + ' e vencimento dia ' + dueDay +
            ', a fatura de ' + String(nome.mes0 + 1).padStart(2, '0') + '/' + nome.ano +
            ' não existiria. Confira os dias com o banco.',
        );
      }
      return new Date(Date.UTC(destino.ano, destino.mes0, 1));
    };

    return this.prisma.$transaction(async (tx) => {
      const faturas = await tx.creditCardInvoice.findMany({
        where: { creditCardId },
        select: { id: true, referenceMonth: true },
        orderBy: { referenceMonth: 'asc' },
      });

      /* Para onde cada fatura vai, mantendo o nome. */
      const destinos = faturas.map((f) => ({ id: f.id, de: f.referenceMonth, para: paraOnde(nomeDeHoje(f.referenceMonth)) }));

      /* Duas faturas no mesmo destino significaria juntar duas faturas numa
       * — e, com elas, os pagamentos de ambas.
       *
       * Varridos os 961 pares de dias, nenhum chega aqui hoje: a distância
       * entre fechamento e vencimento é de zero ou um mês, e isso mantém o
       * mapeamento um-para-um. Fica como tranca, e não como caso previsto —
       * é uma linha, e o que ela evita é um estrago que não se desfaz. */
      const vistos = new Set<number>();
      for (const d of destinos) {
        const chave = d.para.getTime();
        if (vistos.has(chave)) {
          throw new BadRequestException(
            'Com estes dias, duas faturas do histórico passariam a ser a mesma. Confira os dias com o banco.',
          );
        }
        vistos.add(chave);
      }

      /* ANTES da régua nova, cada lançamento recebe gravada a fatura em que
       * está AGORA — já traduzida para a referência nova.
       *
       * Vale para os dois casos. O importado já guardava uma referência, mas
       * guardava a ANTIGA, que sob a régua nova se chama outra coisa; ele
       * precisa ser renumerado como as faturas. O digitado à mão não guardava
       * nada — a fatura dele é recalculada a cada leitura — e sem um valor
       * gravado a troca de régua o levaria embora. */
      const lancamentos = await tx.transaction.findMany({
        where: { userId, creditCardId },
        select: { id: true, transactionDate: true, invoiceMonthOverride: true },
      });
      let presos = 0;
      for (const t of lancamentos) {
        const refAtual = t.invoiceMonthOverride ?? resolveInvoicePeriod(t.transactionDate, card).referenceMonth;
        const destino = paraOnde(nomeDeHoje(refAtual));
        if (!t.invoiceMonthOverride || destino.getTime() !== t.invoiceMonthOverride.getTime()) {
          await tx.transaction.update({ where: { id: t.id }, data: { invoiceMonthOverride: destino } });
        }
        presos++;
      }

      /* A renumeração das faturas em duas voltas: `(cartão, referência)` é
       * único, e mover uma fatura para um mês que outra ainda ocupa estoura o
       * índice no meio do caminho. O desvio por um século à frente é um lugar
       * onde nenhuma fatura de verdade mora. */
      const DESVIO = 1200; // meses
      for (const d of destinos) {
        const longe = new Date(Date.UTC(d.de.getUTCFullYear(), d.de.getUTCMonth() + DESVIO, 1));
        await tx.creditCardInvoice.update({ where: { id: d.id }, data: { referenceMonth: longe } });
      }
      for (const d of destinos) {
        const datas = datasDoMesChave(chaveDoMes(d.para), { closingDay, dueDay });
        await tx.creditCardInvoice.update({
          where: { id: d.id },
          data: { referenceMonth: d.para, closingDate: datas.closingDate, dueDate: datas.dueDate },
        });
      }

      await tx.creditCardBillingCycle.deleteMany({ where: { creditCardId } });
      await tx.creditCardBillingCycle.create({
        data: {
          creditCardId,
          validFrom: CreditCardsService.DESDE_SEMPRE,
          closingDay,
          dueDay,
        },
      });

      const atualizado = await tx.creditCard.update({
        where: { id: creditCardId },
        data: { closingDay, dueDay },
      });

      return {
        cartao: atualizado,
        faturasRecalculadas: faturas.length,
        lancamentosPresos: presos,
      };
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
