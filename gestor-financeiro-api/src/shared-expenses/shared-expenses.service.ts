// ============================================================
// shared-expenses.service.ts
// ============================================================
// Criar, listar e apagar gasto dividido.
//
// Uma despesa compartilhada nasce de uma de três formas, e exatamente uma:
//
//   EU PAGUEI, LANÇAMENTO NOVO    cria a Transaction e a divisão na MESMA
//                                 transação de banco (`criarEm`). Separadas,
//                                 uma falha na divisão deixaria o lançamento
//                                 gravado sozinho, já tendo mexido no saldo.
//   EU PAGUEI, LANÇAMENTO EXISTE  divide um gasto que já está no extrato.
//   ELA PAGOU                     não há lançamento nenhum: o dinheiro não
//                                 passou por conta nem cartão meu. Os campos
//                                 do gasto ficam na própria despesa.
//
// O que NÃO acontece aqui: ninguém grava saldo de pessoa. Ele é somado na
// hora, a partir das partes e dos acertos.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionInput, TransactionsService } from '../transactions/transactions.service';
import { PeopleService } from './people.service';
import { dividir, ModoDeDivisao, Participante } from './shared-expense.utils';

export interface CriarDespesaCompartilhada {
  userId: string;
  paidByPersonId?: string;
  transactionId?: string;
  description?: string;
  amount?: number;
  date?: string;
  categoryId?: string;
  bankAccountId?: string;
  creditCardId?: string;
  invoiceMonth?: string;
  isConfirmed?: boolean;
  mode: ModoDeDivisao;
  participants: Participante[];
  clientKey?: string;
}

/** O que vem junto da despesa em toda leitura. Num lugar só, para as duas
 * formas chegarem sempre com as mesmas peças na mão. */
const COM_TUDO = {
  transaction: { include: { category: true, bankAccount: true, creditCard: true } },
  shares: { include: { person: true } },
  paidBy: true,
  category: true,
} as const;

@Injectable()
export class SharedExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly people: PeopleService,
  ) {}

  async create(input: CriarDespesaCompartilhada) {
    const elaPagou = Boolean(input.paidByPersonId);
    if (elaPagou && input.transactionId) {
      throw new BadRequestException(
        'Um gasto pago por outra pessoa não tem lançamento meu para dividir.',
      );
    }
    if (elaPagou && (input.bankAccountId || input.creditCardId)) {
      throw new BadRequestException(
        'Quem pagou foi outra pessoa: o dinheiro não saiu de conta nem de cartão seu.',
      );
    }

    // Posse de TODA pessoa citada, inclusive a que pagou — o id vem de fora.
    const citadas = new Set(input.participants.map((p) => p.personId));
    if (input.paidByPersonId) citadas.add(input.paidByPersonId);
    for (const personId of citadas) {
      await this.people.minha(input.userId, personId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const repetida = await this.jaGravada(tx, input.userId, input.clientKey);
        if (repetida) return repetida;

        const { total, transactionId } = await this.oGasto(tx, input);
        const rateio = dividir(total, input.mode, input.participants);

        return tx.sharedExpense.create({
          data: {
            userId: input.userId,
            transactionId,
            paidByPersonId: input.paidByPersonId ?? null,
            // Na forma "eu paguei" estes campos ficam vazios de propósito: a
            // verdade está no lançamento, e uma cópia aqui seria uma segunda
            // versão do mesmo número, livre para divergir.
            description: transactionId ? null : (input.description ?? null),
            amount: transactionId ? null : new Prisma.Decimal(total),
            expenseDate: transactionId ? null : new Date(input.date!),
            categoryId: transactionId ? null : (input.categoryId ?? null),
            clientKey: input.clientKey ?? null,
            shares: {
              create: rateio.partes.map((p) => ({
                personId: p.personId,
                amount: new Prisma.Decimal(p.amount),
                percent: p.percent === null ? null : new Prisma.Decimal(p.percent),
              })),
            },
          },
          include: COM_TUDO,
        });
      });
    } catch (e) {
      const existente = await this.perdeuACorrida(e, input.userId, input.clientKey);
      if (existente) return existente;
      throw e;
    }
  }

  /**
   * Resolve de onde sai o valor do gasto, nas três formas. Devolve o total
   * (que manda no rateio) e o lançamento, quando existe um.
   */
  private async oGasto(
    tx: Prisma.TransactionClient,
    input: CriarDespesaCompartilhada,
  ): Promise<{ total: number; transactionId: string | null }> {
    // ---- ela pagou: não há lançamento ----
    if (input.paidByPersonId) {
      if (input.amount === undefined || !input.date) {
        throw new BadRequestException('Informe o valor e a data do gasto.');
      }
      return { total: input.amount, transactionId: null };
    }

    // ---- dividir um lançamento que já existe ----
    if (input.transactionId) {
      const lancamento = await tx.transaction.findFirst({
        where: { id: input.transactionId, userId: input.userId },
      });
      if (!lancamento) throw new NotFoundException('Lançamento não encontrado');
      if (lancamento.type !== 'EXPENSE') {
        throw new BadRequestException('Só despesa se divide: receita não é gasto de ninguém.');
      }
      const jaDividido = await tx.sharedExpense.findUnique({
        where: { transactionId: input.transactionId },
        select: { id: true },
      });
      if (jaDividido) throw new BadRequestException('Este lançamento já está dividido.');
      return { total: Number(lancamento.amount), transactionId: lancamento.id };
    }

    // ---- eu paguei, lançamento novo ----
    if (input.amount === undefined || !input.date || !input.categoryId) {
      throw new BadRequestException('Informe o valor, a data e a categoria do gasto.');
    }
    const novo = await this.transactions.criarEm(tx, {
      userId: input.userId,
      categoryId: input.categoryId,
      type: 'EXPENSE',
      amount: input.amount,
      description: input.description,
      transactionDate: new Date(input.date),
      bankAccountId: input.bankAccountId,
      creditCardId: input.creditCardId,
      invoiceMonth: input.invoiceMonth,
      isConfirmed: input.isConfirmed,
      // A chave do lançamento é derivada da chave da despesa, e não a mesma:
      // são duas linhas em duas tabelas, cada uma com o seu índice único.
      clientKey: input.clientKey ? input.clientKey + ':lancamento' : undefined,
    } satisfies CreateTransactionInput);
    return { total: Number(novo.amount), transactionId: novo.id };
  }

  findAllByUser(userId: string, filtro: { from?: string; to?: string } = {}) {
    // A data mora em dois lugares, conforme a forma: no lançamento (eu
    // paguei) ou na própria despesa (ela pagou). O filtro precisa aceitar as
    // duas, senão as despesas do amigo somem da lista do mês.
    const faixa = {
      ...(filtro.from ? { gte: new Date(filtro.from) } : {}),
      ...(filtro.to ? { lte: new Date(filtro.to) } : {}),
    };
    const temFaixa = Boolean(filtro.from || filtro.to);

    return this.prisma.sharedExpense.findMany({
      where: {
        userId,
        ...(temFaixa
          ? { OR: [{ transaction: { transactionDate: faixa } }, { expenseDate: faixa }] }
          : {}),
      },
      include: COM_TUDO,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneByUser(userId: string, id: string) {
    const despesa = await this.prisma.sharedExpense.findFirst({
      where: { id, userId },
      include: COM_TUDO,
    });
    if (!despesa) throw new NotFoundException('Despesa compartilhada não encontrada');
    return despesa;
  }

  /**
   * Desfaz a divisão. O lançamento NÃO vai junto: o gasto continua tendo
   * acontecido e continua sendo meu — o que deixou de existir é a parte do
   * outro. Na forma "ela pagou" não há lançamento, e some tudo.
   */
  async remove(userId: string, id: string) {
    const despesa = await this.findOneByUser(userId, id);
    await this.prisma.sharedExpense.delete({ where: { id: despesa.id } });
    return { id: despesa.id, transactionId: despesa.transactionId };
  }

  /** Refaz o rateio de uma despesa que já existe, sem tocar no lançamento. */
  async updateSplit(
    userId: string,
    id: string,
    mode: ModoDeDivisao,
    participants: Participante[],
  ) {
    const despesa = await this.findOneByUser(userId, id);
    for (const p of participants) {
      await this.people.minha(userId, p.personId);
    }
    const total = Number(despesa.transaction ? despesa.transaction.amount : despesa.amount);
    const rateio = dividir(total, mode, participants);

    return this.prisma.$transaction(async (tx) => {
      await tx.expenseShare.deleteMany({ where: { sharedExpenseId: id } });
      await tx.expenseShare.createMany({
        data: rateio.partes.map((p) => ({
          sharedExpenseId: id,
          personId: p.personId,
          amount: new Prisma.Decimal(p.amount),
          percent: p.percent === null ? null : new Prisma.Decimal(p.percent),
        })),
      });
      return tx.sharedExpense.findUnique({ where: { id }, include: COM_TUDO });
    });
  }

  // ----------------------------------------------------------
  // Idempotência — mesmas duas defesas do resto do sistema
  // ----------------------------------------------------------

  private async jaGravada(tx: Prisma.TransactionClient, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    return tx.sharedExpense.findFirst({ where: { userId, clientKey }, include: COM_TUDO });
  }

  private async perdeuACorrida(e: unknown, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    if ((e as { code?: string })?.code !== 'P2002') return null;
    return this.prisma.sharedExpense.findFirst({ where: { userId, clientKey }, include: COM_TUDO });
  }
}
