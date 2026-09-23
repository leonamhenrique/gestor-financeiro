// ============================================================
// transactions.series.spec.ts
// ============================================================
// Fatura escolhida, séries (repetição e parcelamento), exclusão de série e
// antecipação de parcelas. Lançamentos e faturas vivem em memória e somam de
// verdade — o que precisa ser provado é em QUAL fatura cada valor termina e
// que parcelas de fatura paga não se mexem.
//
// Cartão fecha dia 10 e vence dia 17. "Hoje" é 13/09/2026: a fatura de
// setembro está fechada (vence 17/09) e o ciclo corrente é o de outubro.
// ============================================================

import { BadRequestException } from '@nestjs/common';
import { SeriesFrequency, SeriesKind, TransactionType } from '@prisma/client';
import { TransactionsService } from './transactions.service';

const utc = (s: string) => new Date(s + 'T00:00:00.000Z');
const CARTAO = { id: 'card-1', closingDay: 10, dueDay: 17 };

describe('TransactionsService — séries e fatura escolhida', () => {
  let service: TransactionsService;
  let transacoes: Map<string, any>;
  let faturas: Map<string, any>; // chave 'AAAA-MM'
  let saldo: number;
  let seq: number;

  const mesDe = (d: Date) => d.toISOString().slice(0, 7);
  const totalDe = (mes: string) => Number(faturas.get(mes)?.totalAmount ?? 0);

  function casa(t: any, where: any): boolean {
    if (where.id && t.id !== where.id) return false;
    if (where.userId && t.userId !== where.userId) return false;
    if (where.seriesId && t.seriesId !== where.seriesId) return false;
    if (where.seriesIndex?.gte !== undefined && t.seriesIndex < where.seriesIndex.gte) return false;
    if (where.creditCardId?.not === null && !t.creditCardId) return false;
    return true;
  }

  const prisma: any = {
    $transaction: jest.fn((cb: any) => cb(prisma)),
    $queryRaw: jest.fn(async () => []),
    transactionSeries: { create: jest.fn(async ({ data }: any) => ({ id: 'serie-' + ++seq, ...data })) },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: 't' + ++seq, seriesId: null, seriesIndex: null, invoiceMonthOverride: null, ...data };
        transacoes.set(t.id, t);
        return { ...t };
      }),
      findUnique: jest.fn(async ({ where }: any) => (transacoes.has(where.id) ? { ...transacoes.get(where.id) } : null)),
      findFirst: jest.fn(async ({ where }: any) => {
        const t = [...transacoes.values()].find((x) => casa(x, where));
        return t ? { ...t } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...transacoes.values()]
          .filter((x) => casa(x, where))
          .sort((a, b) => (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0))
          .map((x) => ({ ...x })),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const t = { ...transacoes.get(where.id), ...data };
        transacoes.set(where.id, t);
        return { ...t };
      }),
      delete: jest.fn(async ({ where }: any) => transacoes.delete(where.id)),
    },
    bankAccount: {
      findUnique: jest.fn(async () => ({ id: 'acc-1' })),
      update: jest.fn(async ({ data }: any) => {
        saldo += data.currentBalance.increment ?? -data.currentBalance.decrement;
      }),
    },
    creditCard: { findUnique: jest.fn(async () => CARTAO) },
    category: {
      findFirst: jest.fn(async () => ({ id: 'cat-1', name: 'Compras' })),
      count: jest.fn(async () => 0),
    },
    creditCardInvoice: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const mes = mesDe(where.creditCardId_referenceMonth.referenceMonth);
        const f = faturas.get(mes);
        if (f) f.totalAmount += Number(update.totalAmount.increment);
        else faturas.set(mes, { id: 'f-' + mes, payments: [], ...create, totalAmount: Number(create.totalAmount) });
      }),
      findMany: jest.fn(async () => [...faturas.values()].map((f) => ({ ...f }))),
    },
  };

  function base(extra: any = {}) {
    return {
      userId: 'user-1',
      categoryId: 'cat-1',
      type: TransactionType.EXPENSE,
      amount: 100,
      transactionDate: utc('2026-09-05'),
      creditCardId: CARTAO.id,
      ...extra,
    };
  }

  const parcelado = (count: number) => ({
    kind: SeriesKind.INSTALLMENT,
    frequency: SeriesFrequency.MONTHLY,
    count,
  });

  /** Paga a fatura do mês por inteiro — ela fica PAID. */
  function pagar(mes: string) {
    const f = faturas.get(mes);
    f.payments.push({ id: 'p-' + mes, amount: f.totalAmount, paidAt: utc('2026-09-12'), bankAccountId: 'acc-1' });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-13T15:00:00Z') });
    transacoes = new Map();
    faturas = new Map();
    saldo = 1000;
    seq = 0;
    jest.clearAllMocks();
    service = new TransactionsService(prisma);
  });

  afterEach(() => jest.useRealTimers());

  describe('criar série', () => {
    it('parcelado em 3x: a 1ª entra confirmada, as outras nascem previstas nos meses seguintes', async () => {
      const { series, transactions } = await service.createSeries(base(), parcelado(3));

      expect(series.count).toBe(3);
      expect(transactions.map((t) => t.transactionDate.toISOString().slice(0, 10))).toEqual([
        '2026-09-05',
        '2026-10-05',
        '2026-11-05',
      ]);
      expect(transactions.map((t) => [t.seriesIndex, t.isConfirmed])).toEqual([
        [0, true],
        [1, false],
        [2, false],
      ]);
      expect(transactions.every((t) => t.seriesId === series.id)).toBe(true);
      // Só a confirmada ocupa fatura.
      expect(totalDe('2026-09')).toBe(100);
      expect(faturas.size).toBe(1);
    });

    it('repetição na conta: só a primeira mexe no saldo', async () => {
      await service.createSeries(
        base({ creditCardId: undefined, bankAccountId: 'acc-1' }),
        { kind: SeriesKind.FIXED, frequency: SeriesFrequency.MONTHLY, count: 12 },
      );
      expect(saldo).toBe(900);
      expect(transacoes.size).toBe(12);
    });

    it('a fatura escolhida vale só para a primeira ocorrência', async () => {
      const { transactions } = await service.createSeries(base({ invoiceMonth: '2026-10' }), parcelado(2));
      expect(transactions[0].invoiceMonthOverride).toEqual(utc('2026-10-01'));
      expect(transactions[1].invoiceMonthOverride).toBeNull();
      expect(totalDe('2026-10')).toBe(100);
      expect(totalDe('2026-09')).toBe(0);
    });

    it.each([1, 61])('rejeita %i ocorrências', async (n) => {
      await expect(service.createSeries(base(), parcelado(n))).rejects.toThrow(BadRequestException);
      expect(transacoes.size).toBe(0);
    });
  });

  describe('fatura escolhida', () => {
    it('compra de 05/09 lançada na fatura de novembro soma em novembro', async () => {
      await service.create(base({ invoiceMonth: '2026-11' }));
      expect(totalDe('2026-11')).toBe(100);
      expect(totalDe('2026-09')).toBe(0);
    });

    it('trocar a fatura na edição move o valor; null volta para a da data', async () => {
      const t = await service.create(base());
      await service.update(t.id, { invoiceMonth: '2026-12' }, 'user-1');
      expect([totalDe('2026-09'), totalDe('2026-12')]).toEqual([0, 100]);

      await service.update(t.id, { invoiceMonth: null }, 'user-1');
      expect([totalDe('2026-09'), totalDe('2026-12')]).toEqual([100, 0]);
    });

    it('excluir tira da fatura escolhida, não da fatura da data', async () => {
      const t = await service.create(base({ invoiceMonth: '2026-11' }));
      await service.delete(t.id, 'user-1');
      expect(totalDe('2026-11')).toBe(0);
      expect(totalDe('2026-09')).toBe(0);
    });

    it('rejeita fatura em lançamento de conta e mês mal formado', async () => {
      await expect(
        service.create(base({ creditCardId: undefined, bankAccountId: 'acc-1', invoiceMonth: '2026-10' })),
      ).rejects.toThrow(BadRequestException);
      await expect(service.create(base({ invoiceMonth: '2026-13' }))).rejects.toThrow(BadRequestException);
    });
  });

  describe('excluir série', () => {
    it('ONLY, FOLLOWING e ALL', async () => {
      const { transactions: s } = await service.createSeries(base(), parcelado(4));

      expect(await service.deleteSeries('user-1', s[3].id, 'ONLY')).toEqual({ deleted: 1, protectedCount: 0 });
      expect(await service.deleteSeries('user-1', s[1].id, 'FOLLOWING')).toEqual({ deleted: 2, protectedCount: 0 });
      expect([...transacoes.keys()]).toEqual([s[0].id]);

      expect(await service.deleteSeries('user-1', s[0].id, 'ALL')).toEqual({ deleted: 1, protectedCount: 0 });
      expect(totalDe('2026-09')).toBe(0); // a confirmada saiu da fatura
    });

    it('parcela em fatura paga fica, e a resposta conta quantas ficaram', async () => {
      const { transactions: s } = await service.createSeries(base(), parcelado(3));
      pagar('2026-09');

      expect(await service.deleteSeries('user-1', s[1].id, 'ALL')).toEqual({ deleted: 2, protectedCount: 1 });
      expect([...transacoes.keys()]).toEqual([s[0].id]);
      expect(totalDe('2026-09')).toBe(100);
    });

    it('se nenhuma pode sair, nada é excluído', async () => {
      const { transactions: s } = await service.createSeries(base(), parcelado(3));
      pagar('2026-09');
      await expect(service.deleteSeries('user-1', s[0].id, 'ONLY')).rejects.toThrow(/fatura já paga/);
      expect(transacoes.size).toBe(3);
    });

    it('lançamento avulso não é série; série de outro usuário não aparece', async () => {
      const t = await service.create(base());
      await expect(service.deleteSeries('user-1', t.id, 'ALL')).rejects.toThrow(BadRequestException);
      const { transactions: s } = await service.createSeries(base(), parcelado(2));
      await expect(service.deleteSeries('user-2', s[0].id, 'ALL')).rejects.toThrow('Transação não encontrada');
    });
  });

  describe('antecipar parcelas', () => {
    // Compra em 20/09 (depois do fechamento): parcelas nas faturas de
    // outubro, novembro, dezembro e janeiro.
    async function serie4x() {
      const r = await service.createSeries(base({ transactionDate: utc('2026-09-20') }), parcelado(4));
      return r.series.id;
    }

    it('antecipa as 2 próximas para outubro e já confirma', async () => {
      const id = await serie4x();
      const r = await service.anticipate('user-1', id, { destinationMonth: '2026-10', quantity: 2, confirm: true });

      expect(r).toEqual({ anticipated: 2, remaining: 1 });
      expect(totalDe('2026-10')).toBe(300);
      const movidas = [...transacoes.values()].filter((t) => t.invoiceMonthOverride);
      expect(movidas.map((t) => t.seriesIndex)).toEqual([1, 2]);
      // A data da compra não muda: antecipar mexe só na fatura.
      expect(movidas.map((t) => t.transactionDate.toISOString().slice(0, 10))).toEqual(['2026-10-20', '2026-11-20']);
    });

    it('sem confirmar, antecipa como previstas: nada entra na fatura ainda', async () => {
      const id = await serie4x();
      await service.anticipate('user-1', id, { destinationMonth: '2026-10', quantity: 3 });
      expect(totalDe('2026-10')).toBe(100);
      expect([...transacoes.values()].filter((t) => t.invoiceMonthOverride).length).toBe(3);
    });

    it('antecipar parcela já confirmada tira da fatura antiga e põe na nova', async () => {
      const id = await serie4x();
      const segunda = [...transacoes.values()].find((t) => t.seriesIndex === 1);
      await service.update(segunda.id, { isConfirmed: true }, 'user-1');
      expect(totalDe('2026-11')).toBe(100);

      await service.anticipate('user-1', id, { destinationMonth: '2026-10', quantity: 1 });
      expect([totalDe('2026-10'), totalDe('2026-11')]).toEqual([200, 0]);
    });

    it('rejeita destino anterior à fatura atual, destino pago e destino sem parcelas depois', async () => {
      const id = await serie4x();
      await expect(
        service.anticipate('user-1', id, { destinationMonth: '2026-08', quantity: 1 }),
      ).rejects.toThrow(/anterior à fatura atual/);
      await expect(
        service.anticipate('user-1', id, { destinationMonth: '2027-01', quantity: 1 }),
      ).rejects.toThrow(/Nenhuma parcela/);

      pagar('2026-10');
      await expect(
        service.anticipate('user-1', id, { destinationMonth: '2026-10', quantity: 1 }),
      ).rejects.toThrow(/já paga/);
    });

    it('a fatura atual é a mais antiga com algo a pagar, mesmo se já fechou', async () => {
      await service.create(base()); // setembro, fechada e ainda não paga
      const id = await serie4x();
      const r = await service.anticipate('user-1', id, { destinationMonth: '2026-09', quantity: 1, confirm: true });
      expect(r.anticipated).toBe(1);
      expect(totalDe('2026-09')).toBe(200);
    });
  });
});
