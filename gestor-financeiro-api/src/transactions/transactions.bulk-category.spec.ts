// ============================================================
// transactions.bulk-category.spec.ts
// ============================================================
// Reclassificar vários lançamentos de uma vez — a correção de um lojista que
// foi parar na categoria errada.
//
// O que precisa ser provado: que um id alheio na lista derruba a operação
// INTEIRA em vez de ser ignorado, e que nenhum saldo se mexe. Categoria é
// leitura, não movimento: se este caminho encostar em saldo ou fatura, o
// dinheiro passa a depender de como o gasto foi rotulado.
// ============================================================

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

describe('TransactionsService — reclassificar em lote', () => {
  let service: TransactionsService;
  let prisma: any;
  let transacoes: Map<string, any>;
  let cats: any[];
  let mexeuEmSaldo: number;
  let mexeuEmFatura: number;

  function t(id: string, parcial: any = {}) {
    transacoes.set(id, { id, userId: 'user-1', categoryId: 'cat-transporte', ...parcial });
    return id;
  }
  const casa = (x: any, where: any) =>
    (!where.userId || x.userId === where.userId) && (!where.id?.in || where.id.in.includes(x.id));

  beforeEach(() => {
    transacoes = new Map();
    cats = [
      { id: 'cat-transporte', name: 'Transporte', userId: 'user-1', filhas: 0 },
      { id: 'cat-alimentacao', name: 'Alimentação', userId: 'user-1', filhas: 0 },
      { id: 'cat-pai', name: 'Casa', userId: 'user-1', filhas: 3 },
      { id: 'cat-alheia', name: 'De outro', userId: 'outro', filhas: 0 },
    ];
    mexeuEmSaldo = 0;
    mexeuEmFatura = 0;

    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      transaction: {
        count: jest.fn(async ({ where }: any) =>
          [...transacoes.values()].filter((x) => casa(x, where)).length,
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvo = [...transacoes.values()].filter((x) => casa(x, where));
          alvo.forEach((x) => Object.assign(x, data));
          return { count: alvo.length };
        }),
      },
      category: {
        findFirst: jest.fn(async ({ where }: any) => {
          const c = cats.find(
            (x) =>
              x.id === where.id &&
              where.OR.some((o: any) => ('userId' in o ? x.userId === o.userId : false)),
          );
          return c ? { ...c } : null;
        }),
        count: jest.fn(async ({ where }: any) => {
          const pai = cats.find((x) => x.id === where.parentId);
          return pai && pai.userId === where.userId ? pai.filhas : 0;
        }),
      },
      // Nenhum destes deveria ser tocado. Se forem, os testes do fim contam.
      bankAccount: { update: jest.fn(async () => { mexeuEmSaldo++; }) },
      creditCardInvoice: { upsert: jest.fn(async () => { mexeuEmFatura++; }) },
    };
    service = new TransactionsService(prisma);
  });

  const cat = (id: string) => transacoes.get(id)?.categoryId;

  it('poe os lancamentos na categoria nova', async () => {
    t('p1'); t('p2'); t('p3');
    const r = await service.reclassificarEmLote('user-1', ['p1', 'p2', 'p3'], 'cat-alimentacao');
    expect(r).toEqual({ changed: 3 });
    expect([cat('p1'), cat('p2'), cat('p3')]).toEqual([
      'cat-alimentacao', 'cat-alimentacao', 'cat-alimentacao',
    ]);
  });

  it('id repetido conta uma vez so', async () => {
    t('p1');
    expect(await service.reclassificarEmLote('user-1', ['p1', 'p1'], 'cat-alimentacao'))
      .toEqual({ changed: 1 });
  });

  it('um id alheio na lista derruba a operacao INTEIRA', async () => {
    // Ignorar o alheio em silêncio faria o número devolvido mentir: a tela
    // diria "23 reclassificados" tendo mexido em 22.
    t('p1'); t('alheio', { userId: 'outro' });
    await expect(
      service.reclassificarEmLote('user-1', ['p1', 'alheio'], 'cat-alimentacao'),
    ).rejects.toThrow(NotFoundException);
    expect(cat('p1')).toBe('cat-transporte');
    expect(cat('alheio')).toBe('cat-transporte');
  });

  it('id que nao existe tambem derruba', async () => {
    t('p1');
    await expect(
      service.reclassificarEmLote('user-1', ['p1', 'nao-existe'], 'cat-alimentacao'),
    ).rejects.toThrow(NotFoundException);
    expect(cat('p1')).toBe('cat-transporte');
  });

  it('categoria de outro usuario nao serve', async () => {
    t('p1');
    await expect(service.reclassificarEmLote('user-1', ['p1'], 'cat-alheia'))
      .rejects.toThrow(NotFoundException);
    expect(cat('p1')).toBe('cat-transporte');
  });

  it('categoria com subcategorias nao serve', async () => {
    // Mesma regra de lançar: só folha recebe.
    t('p1');
    await expect(service.reclassificarEmLote('user-1', ['p1'], 'cat-pai'))
      .rejects.toThrow(BadRequestException);
    expect(cat('p1')).toBe('cat-transporte');
  });

  it('lancamento confirmado e reclassificado sem reabrir nada', async () => {
    // Categoria não é dinheiro. Confirmado, ou em fatura paga, continua
    // valendo o mesmo — só passa a ser contado noutro lugar.
    t('p1', { isConfirmed: true, creditCardId: 'card-1' });
    expect(await service.reclassificarEmLote('user-1', ['p1'], 'cat-alimentacao'))
      .toEqual({ changed: 1 });
    expect(cat('p1')).toBe('cat-alimentacao');
  });

  it('nenhum saldo e nenhuma fatura se mexem', async () => {
    t('p1', { isConfirmed: true, bankAccountId: 'acc-1', amount: 100 });
    t('p2', { isConfirmed: true, creditCardId: 'card-1', amount: 250 });
    await service.reclassificarEmLote('user-1', ['p1', 'p2'], 'cat-alimentacao');
    expect(mexeuEmSaldo).toBe(0);
    expect(mexeuEmFatura).toBe(0);
  });

  it('o valor de cada lancamento continua o mesmo', async () => {
    t('p1', { amount: 18.4 });
    await service.reclassificarEmLote('user-1', ['p1'], 'cat-alimentacao');
    expect(transacoes.get('p1').amount).toBe(18.4);
  });
});
