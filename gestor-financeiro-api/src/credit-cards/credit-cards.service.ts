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
import { cicloDoDia } from './billing-cycle';
import { ORDEM_DA_LISTA, gravarOrdem, novaOrdem } from '../common/ordering';
import { faturaAtual, hojeNoFuso, limiteEmUso, montarFaturas } from './invoice-statement';

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
      const { referenceMonth, closingDate, dueDate } = cicloDoDia(
        hojeNoFuso(),
        input.closingDay,
        input.dueDay,
      );

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
    return this.prisma.creditCard.findMany({
      where: { userId, isActive: includeInactive ? undefined : true },
      orderBy: ORDEM_DA_LISTA,
    });
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

  async findOneByUser(userId: string, creditCardId: string) {
    const card = await this.prisma.creditCard.findFirst({ where: { id: creditCardId, userId } });
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
    const card = await this.prisma.creditCard.findUnique({ where: { id: creditCardId } });
    if (!card) throw new NotFoundException('Cartão de crédito não encontrado');
    return limitAmount - limiteEmUso(await this.faturasCalculadas(card));
  }

  private async faturasCalculadas(card: { id: string; closingDay: number; dueDay: number }) {
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
  async updateBillingCycle(
    userId: string,
    creditCardId: string,
    closingDay: number,
    dueDay: number,
  ) {
    await this.findOneByUser(userId, creditCardId);

    const invoiceCount = await this.prisma.creditCardInvoice.count({
      where: { creditCardId },
    });

    // Toda criação de cartão já gera 1 fatura (a do ciclo atual), então
    // "mais de 1" é o sinal real de que o cartão já está em uso.
    if (invoiceCount > 1) {
      throw new BadRequestException(
        'Este cartão já possui faturas geradas. O ciclo de fechamento não pode mais ser alterado.',
      );
    }

    return this.prisma.creditCard.update({
      where: { id: creditCardId },
      data: { closingDay, dueDay },
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
