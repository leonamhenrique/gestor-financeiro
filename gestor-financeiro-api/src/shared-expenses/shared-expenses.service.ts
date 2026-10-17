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
import { Prisma, SeriesFrequency, SeriesKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionInput, TransactionsService } from '../transactions/transactions.service';
import { PeopleService } from './people.service';
import {
  dividir,
  emCentavos,
  emReais,
  ModoDeDivisao,
  parcelarRateio,
  Participante,
  repartirEmParcelas,
} from './shared-expense.utils';

export interface RepetirDespesa {
  kind: SeriesKind;
  frequency: SeriesFrequency;
  count: number;
}

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

/**
 * Prazo da transação de banco deste módulo.
 *
 * O padrão do Prisma é 5 segundos, e ele NÃO basta aqui. Criar um gasto
 * dividido faz nove consultas numa transação só — confere a conta ou o
 * cartão, a categoria, grava o lançamento, acha o cartão, soma a fatura,
 * grava a divisão e as partes. Um lançamento comum faz seis.
 *
 * Seis cabem em 5 segundos; nove não, numa instância de 0,1 de CPU falando
 * com um banco do outro lado da rede. Quando o prazo estoura, o Prisma fecha
 * a transação e a consulta seguinte volta com "Transaction not found" — um
 * erro que parece de banco de dados e é de relógio. Medido em produção:
 * falhava SEMPRE, enquanto o lançamento comum passava sempre.
 *
 * `maxWait` é a espera por uma conexão livre do pool, e sobe junto: numa
 * instância que hiberna, a primeira requisição depois do sono também espera.
 */
export const PRAZO = { timeout: 20_000, maxWait: 10_000 };

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

  /**
   * Uma despesa dividida que SE REPETE: uma viagem em 12 parcelas rachada
   * com um amigo, ou um aluguel mensal.
   *
   * Cada ocorrência ganha a sua própria divisão, porque cada uma é um gasto
   * por si: a parcela de agosto dividida meio a meio é uma dívida de agosto,
   * e quitá-la não quita a de setembro. Uma divisão só, presa à primeira
   * parcela, diria que o amigo deve a viagem inteira no primeiro mês.
   *
   * Só vale para gasto MEU e lançamento novo. Dividir um lançamento que já
   * existe não repete nada (ele é um só), e gasto que a outra pessoa pagou
   * não tem série — ela que controla o parcelamento dela, não eu.
   *
   * O VALOR muda de significado conforme o tipo, e isto é o centro da
   * função. Numa despesa FIXA ele é o de cada vez: um aluguel de 2.500 é
   * 2.500 todo mês. Numa PARCELADA ele é o da compra inteira: 5.000 em 5x
   * são cinco parcelas de 1.000, e a parte do amigo são 500 por parcela,
   * 2.500 no total — e não 2.500 em cada uma, que cobraria dele cinco
   * vezes a conta. É o que a tela pergunta: "valor total" do gasto.
   */
  async createSeries(input: CriarDespesaCompartilhada, repeat: RepetirDespesa) {
    if (input.paidByPersonId || input.transactionId) {
      throw new BadRequestException(
        'Só dá para repetir um gasto seu, lançado agora. Para o que a outra pessoa pagou, registre cada vez que acontecer.',
      );
    }
    if (input.amount === undefined || !input.date || !input.categoryId) {
      throw new BadRequestException('Informe o valor, a data e a categoria do gasto.');
    }

    for (const p of input.participants) {
      await this.people.minha(input.userId, p.personId);
    }
    // A divisão é conferida ANTES de qualquer gravação: se ela não fecha,
    // não adianta ter criado doze lançamentos para descobrir depois.
    const rateio = dividir(input.amount, input.mode, input.participants);

    // Parcelada: o valor digitado é o da compra, e as parcelas são pedaços
    // dele. Fixa: é o de cada ocorrência, e ele se repete inteiro.
    const parcelada = repeat.kind === SeriesKind.INSTALLMENT;
    const valores = parcelada
      ? repartirEmParcelas(emCentavos(input.amount), repeat.count)
      : Array.from({ length: repeat.count }, () => emCentavos(input.amount!));
    const partesDa = parcelada
      ? parcelarRateio(rateio.partes, valores)
      : valores.map(() => rateio.partes);

    const chaveDa = (i: number) => (input.clientKey ? `${input.clientKey}#${i}` : undefined);

    return this.prisma.$transaction(async (tx) => {
      const { series, transactions } = await this.transactions.criarSerieEm(
        tx,
        {
          userId: input.userId,
          categoryId: input.categoryId!,
          type: 'EXPENSE',
          amount: input.amount!,
          description: input.description,
          transactionDate: new Date(input.date!),
          bankAccountId: input.bankAccountId,
          creditCardId: input.creditCardId,
          invoiceMonth: input.invoiceMonth,
          isConfirmed: input.isConfirmed,
        } as any,
        { kind: repeat.kind, frequency: repeat.frequency, count: repeat.count },
        null,
        (i: number) => (chaveDa(i) ? chaveDa(i) + ':lancamento' : undefined),
        (i: number) => emReais(valores[i]),
      );

      const despesas = [];
      for (let i = 0; i < transactions.length; i++) {
        // Reenvio da fila offline: `criarSerieEm` devolve os lançamentos que
        // JÁ existem quando a chave repete, então a divisão também tem de ser
        // reaproveitada. Sem isto, a segunda tentativa batia no único de
        // `transaction_id` e virava 500 — justo no caso em que a chave existe
        // para evitar estrago.
        const jaTem = await tx.sharedExpense.findFirst({
          where: { userId: input.userId, transactionId: transactions[i].id },
          include: COM_TUDO,
        });
        if (jaTem) {
          despesas.push(jaTem);
          continue;
        }
        despesas.push(
          await tx.sharedExpense.create({
            data: {
              userId: input.userId,
              transactionId: transactions[i].id,
              paidByPersonId: null,
              description: null,
              amount: null,
              expenseDate: null,
              categoryId: null,
              clientKey: chaveDa(i) ?? null,
              shares: {
                create: partesDa[i].map((p) => ({
                  personId: p.personId,
                  amount: new Prisma.Decimal(p.amount),
                  percent: p.percent === null ? null : new Prisma.Decimal(p.percent),
                })),
              },
            },
            include: COM_TUDO,
          }),
        );
      }
      return { series, despesas };
    }, PRAZO);
  }

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
      }, PRAZO);
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

  /**
   * Edita uma despesa dividida: valor, descrição, data e rateio, de uma vez.
   *
   * O valor e as partes mudam JUNTOS, na mesma transação de banco, e é essa
   * a razão de o método existir. Editar o lançamento por fora é recusado
   * exatamente porque lá o valor mudaria sozinho e a diferença cairia calada
   * na minha parte — a mensagem daquela recusa aponta para cá.
   *
   * Quando o gasto é meu, o lançamento é atualizado pelo caminho normal
   * (`atualizarEm`), que estorna o efeito antigo e aplica o novo: o saldo da
   * conta e o total da fatura acompanham sem ninguém fazer conta de
   * diferença. Quando quem pagou foi a outra pessoa, não há lançamento, e os
   * campos moram na própria despesa.
   */
  async update(
    userId: string,
    id: string,
    input: {
      description?: string;
      amount?: number;
      date?: string;
      categoryId?: string;
      mode: ModoDeDivisao;
      participants: Participante[];
    },
  ) {
    const despesa = await this.findOneByUser(userId, id);
    for (const p of input.participants) {
      await this.people.minha(userId, p.personId);
    }

    const totalAtual = Number(despesa.transaction ? despesa.transaction.amount : despesa.amount);
    const total = input.amount === undefined ? totalAtual : input.amount;
    // Antes de tocar em qualquer coisa: se a divisão não fecha, nada muda.
    const rateio = dividir(total, input.mode, input.participants);

    // Refazer SÓ o rateio não pode encostar no lançamento: ele não mudou, e
    // reescrevê-lo com os mesmos valores estornaria e reaplicaria o efeito
    // à toa, mexendo em saldo e fatura para chegar no mesmo lugar.
    const mudouOGasto =
      (input.amount !== undefined && input.amount !== totalAtual) ||
      input.description !== undefined ||
      input.date !== undefined ||
      input.categoryId !== undefined;

    return this.prisma.$transaction(async (tx) => {
      if (despesa.transactionId && mudouOGasto) {
        await this.transactions.atualizarEm(
          tx,
          despesa.transactionId,
          {
            amount: total,
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.date === undefined ? {} : { transactionDate: new Date(input.date) }),
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          },
          userId,
        );
      } else if (!despesa.transactionId && mudouOGasto) {
        await tx.sharedExpense.update({
          where: { id },
          data: {
            amount: new Prisma.Decimal(total),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.date === undefined ? {} : { expenseDate: new Date(input.date) }),
            ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          },
        });
      }

      // Apagar e recriar, em vez de casar linha a linha: a lista de pessoas
      // pode ter mudado, e conciliar dois conjuntos aqui seria mais código
      // para o mesmo resultado.
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
    }, PRAZO);
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
