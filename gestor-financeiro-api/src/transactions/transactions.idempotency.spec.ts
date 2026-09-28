// ============================================================
// transactions.idempotency.spec.ts
// ============================================================
// A fila offline do app só tira um item dela DEPOIS que a resposta do
// servidor chega. Se o servidor grava e a resposta se perde no caminho — a
// internet caindo no instante errado, ou o servidor dormindo —, o item
// continua na fila e é reenviado. Sem chave de idempotência, o mesmo dinheiro
// entra duas vezes, e foi exatamente isso que apareceu na tela: R$ 80 virando
// R$ 160 no mesmo dia.
//
// O banco tem um índice único em (user_id, client_key). Aqui o Prisma falso
// carrega esse índice junto, senão o teste passaria por um caminho que o
// banco de verdade recusaria.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, SeriesKind, SeriesFrequency } from '@prisma/client';

/** Erro que o Prisma levanta quando um índice único é violado. */
class ErroDeUnicidade extends Error {
  code = 'P2002';
}

describe('idempotência de create()', () => {
  let service: TransactionsService;
  let prisma: any;
  let gravadas: any[];
  let series: any[];

  beforeEach(async () => {
    gravadas = [];
    series = [];
    let seq = 0;

    const acharPelaChave = ({ where }: any) => {
      if (!where || where.clientKey === undefined) return null;
      return (
        gravadas.find((t) => t.userId === where.userId && t.clientKey === where.clientKey) ?? null
      );
    };

    prisma = {
      $transaction: jest.fn((cb) => cb(prisma)),
      transaction: {
        create: jest.fn(async ({ data }: any) => {
          // O índice único do banco, aqui dentro: mesma chave e mesmo dono
          // não entram duas vezes, aconteça o que acontecer antes.
          if (
            data.clientKey &&
            gravadas.some((t) => t.userId === data.userId && t.clientKey === data.clientKey)
          ) {
            throw new ErroDeUnicidade('Unique constraint failed');
          }
          const t = { id: 'tx-' + ++seq, seriesId: null, seriesIndex: null, ...data };
          gravadas.push(t);
          return t;
        }),
        findFirst: jest.fn(async (args: any) => acharPelaChave(args)),
        findMany: jest.fn(async ({ where }: any) =>
          gravadas.filter((t) => t.userId === where.userId && t.seriesId === where.seriesId),
        ),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      transactionSeries: {
        create: jest.fn(async ({ data }: any) => {
          const s = { id: 'serie-' + ++seq, ...data };
          series.push(s);
          return s;
        }),
        findFirst: jest.fn(async ({ where }: any) => series.find((s) => s.id === where.id) ?? null),
      },
      bankAccount: {
        findFirst: jest.fn(async () => ({ id: 'acc-1' })),
        findUnique: jest.fn(async () => ({ id: 'acc-1', currentBalance: 1000 })),
        update: jest.fn(),
      },
      creditCard: { findFirst: jest.fn(async () => ({ id: 'card-1' })), findUnique: jest.fn() },
      category: {
        findFirst: jest.fn(async () => ({ id: 'cat-1', name: 'Mercado' })),
        count: jest.fn(async () => 0),
      },
      creditCardInvoice: { upsert: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  const lancamento = (clientKey?: string) => ({
    userId: 'user-1',
    categoryId: 'cat-1',
    type: TransactionType.EXPENSE,
    amount: 80,
    transactionDate: new Date(Date.UTC(2026, 8, 27)),
    bankAccountId: 'acc-1',
    clientKey,
  });

  it('o reenvio da mesma chave devolve o lançamento que já existe', async () => {
    const primeira = await service.create(lancamento('fila-abc12345'));
    const reenvio = await service.create(lancamento('fila-abc12345'));

    expect(reenvio.id).toBe(primeira.id);
    expect(gravadas).toHaveLength(1);
  });

  it('e não mexe no saldo de novo — R$ 80 não viram R$ 160', async () => {
    await service.create(lancamento('fila-abc12345'));
    const depoisDaPrimeira = prisma.bankAccount.update.mock.calls.length;
    await service.create(lancamento('fila-abc12345'));

    expect(prisma.bankAccount.update.mock.calls.length).toBe(depoisDaPrimeira);
  });

  it('sem chave, dois envios iguais continuam sendo dois lançamentos', async () => {
    // Dois cafés de R$ 80 no mesmo dia são dois cafés. Quem não manda chave
    // não está pedindo idempotência, e o app não pode adivinhar por ele.
    await service.create(lancamento());
    await service.create(lancamento());

    expect(gravadas).toHaveLength(2);
  });

  it('chaves diferentes são lançamentos diferentes', async () => {
    await service.create(lancamento('fila-abc12345'));
    await service.create(lancamento('fila-xyz98765'));

    expect(gravadas).toHaveLength(2);
  });

  it('dois envios ao mesmo tempo: quem perde a corrida lê o vencedor', async () => {
    // A consulta antes de criar não basta aqui: os dois consultam antes de
    // qualquer um gravar, e os dois acham nada. Quem segura é o índice único,
    // e o perdedor tem de devolver o lançamento do vencedor, não um erro.
    prisma.transaction.findFirst.mockResolvedValueOnce(null);
    const vencedor = await service.create(lancamento('fila-corrida01'));

    prisma.transaction.findFirst.mockResolvedValueOnce(null); // ainda não vê
    const perdedor = await service.create(lancamento('fila-corrida01'));

    expect(perdedor.id).toBe(vencedor.id);
    expect(gravadas).toHaveLength(1);
  });

  it('erro que não é de unicidade continua estourando', async () => {
    prisma.transaction.create.mockRejectedValueOnce(new Error('banco fora do ar'));
    await expect(service.create(lancamento('fila-abc12345'))).rejects.toThrow('banco fora do ar');
  });

  it('série: o reenvio devolve a série gravada, sem criar outra', async () => {
    const repeat = { kind: SeriesKind.INSTALLMENT, frequency: SeriesFrequency.MONTHLY, count: 3 };
    const primeira: any = await service.createSeries(lancamento('fila-serie001'), repeat);
    const reenvio: any = await service.createSeries(lancamento('fila-serie001'), repeat);

    expect(gravadas).toHaveLength(3);
    expect(series).toHaveLength(1);
    expect(reenvio.series.id).toBe(primeira.series.id);
    expect(reenvio.transactions).toHaveLength(3);
  });

  it('série: cada parcela leva a sua própria chave', async () => {
    const repeat = { kind: SeriesKind.INSTALLMENT, frequency: SeriesFrequency.MONTHLY, count: 3 };
    await service.createSeries(lancamento('fila-serie001'), repeat);

    expect(gravadas.map((t) => t.clientKey)).toEqual([
      'fila-serie001#0',
      'fila-serie001#1',
      'fila-serie001#2',
    ]);
  });
});
