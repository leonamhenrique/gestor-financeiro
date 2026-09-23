// ============================================================
// transactions.service.spec.ts
// ============================================================
// Cobre principalmente:
// 1. resolveInvoicePeriod — a lógica de "em qual fatura essa compra cai"
// 2. Validações de entrada (XOR conta/cartão, valor positivo)
// 3. Fluxo de create/update/delete usando um mock do PrismaService
//
// Observação: `resolveInvoicePeriod` e os helpers de aplicação de saldo
// são `private`. Para testá-los diretamente sem gambiarra de `any`,
// o ideal é extrair essas funções puras (resolveInvoicePeriod,
// validateAmount, validateAccountXorCard) para um arquivo utilitário
// separado (ex: `transaction.utils.ts`) e importar tanto no service
// quanto no teste. Deixei os testes já assumindo essa extração —
// veja a nota ao final do arquivo.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, TransactionSource } from '@prisma/client';
import { resolveInvoicePeriod, validateAmount, validateAccountXorCard } from './transaction.utils';

// Datas como chegam de verdade: colunas @db.Date e "AAAA-MM-DD" da API são
// meia-noite UTC. Ver billing-cycle.ts.
const utc = (s: string) => new Date(s + 'T00:00:00.000Z');

// Categoria visível e sem subcategorias — a que todo lançamento destes
// testes usa. As regras de categoria têm testes próprios mais abaixo.
const CATEGORIA_FOLHA = () => ({
  findFirst: jest.fn(async () => ({ id: 'cat-1', name: 'Mercado' })),
  count: jest.fn(async () => 0),
});

describe('resolveInvoicePeriod (função pura)', () => {
  it('compra antes do fechamento entra na fatura do mês corrente', () => {
    // Cartão fecha dia 10. Compra em 05/09 -> fatura de referência 09/2026.
    const result = resolveInvoicePeriod(utc('2026-09-05'), 10, 17);
    expect(result.referenceMonth).toEqual(utc('2026-09-01'));
  });

  it('compra depois do fechamento entra na fatura do mês seguinte', () => {
    // Cartão fecha dia 10. Compra em 15/09 -> fatura de referência 10/2026.
    const result = resolveInvoicePeriod(utc('2026-09-15'), 10, 17);
    expect(result.referenceMonth).toEqual(utc('2026-10-01'));
  });

  it('compra em dezembro após fechamento vira fatura de janeiro do ano seguinte', () => {
    const result = resolveInvoicePeriod(utc('2026-12-20'), 10, 17);
    expect(result.referenceMonth).toEqual(utc('2027-01-01'));
  });

  it('compra exatamente no dia de fechamento ainda entra no mês corrente', () => {
    // dia === closingDay não é "depois do fechamento", então cai no mês atual
    const result = resolveInvoicePeriod(utc('2026-09-10'), 10, 17);
    expect(result.referenceMonth).toEqual(utc('2026-09-01'));
  });

  // Regressão: lia o dia no fuso local. "2026-09-11" (meia-noite UTC) é dia
  // 10 às 21h no Brasil, e a compra caía na fatura de setembro.
  it('compra no dia seguinte ao fechamento vai para o mês seguinte, em qualquer fuso', () => {
    const result = resolveInvoicePeriod(utc('2026-09-11'), 10, 17);
    expect(result.referenceMonth).toEqual(utc('2026-10-01'));
  });
});

describe('validateAmount (função pura)', () => {
  it('rejeita valor zero', () => {
    expect(() => validateAmount(0)).toThrow(BadRequestException);
  });

  it('rejeita valor negativo', () => {
    expect(() => validateAmount(-10)).toThrow(BadRequestException);
  });

  it('aceita valor positivo', () => {
    expect(() => validateAmount(10.5)).not.toThrow();
  });
});

describe('validateAccountXorCard (função pura)', () => {
  it('rejeita quando nenhum é informado', () => {
    expect(() => validateAccountXorCard(undefined, undefined)).toThrow(BadRequestException);
  });

  it('rejeita quando os dois são informados', () => {
    expect(() => validateAccountXorCard('acc-1', 'card-1')).toThrow(BadRequestException);
  });

  it('aceita apenas conta', () => {
    expect(() => validateAccountXorCard('acc-1', undefined)).not.toThrow();
  });

  it('aceita apenas cartão', () => {
    expect(() => validateAccountXorCard(undefined, 'card-1')).not.toThrow();
  });
});

describe('TransactionsService (fluxo com Prisma mockado)', () => {
  let service: TransactionsService;
  let prismaMock: any;

  // Mock mínimo do client transacional do Prisma. `$transaction` aqui
  // simplesmente executa o callback passando o próprio mock, simulando
  // o comportamento de uma transação bem-sucedida.
  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((callback) => callback(prismaMock)),
      transaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      bankAccount: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      creditCard: {
        findUnique: jest.fn(),
      },
      category: CATEGORIA_FOLHA(),
      creditCardInvoice: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  it('create() incrementa o saldo da conta para uma receita (INCOME)', async () => {
    prismaMock.transaction.create.mockImplementation(async ({ data }: any) => ({ id: 'tx-1', ...data }));
    prismaMock.bankAccount.findUnique.mockResolvedValue({ id: 'acc-1', currentBalance: 100 });

    await service.create({
      userId: 'user-1',
      categoryId: 'cat-1',
      type: TransactionType.INCOME,
      amount: 50,
      transactionDate: new Date(2026, 8, 10),
      bankAccountId: 'acc-1',
      source: TransactionSource.APP,
    });

    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { currentBalance: { increment: 50 } },
    });
  });

  it('create() decrementa o saldo da conta para uma despesa (EXPENSE)', async () => {
    prismaMock.transaction.create.mockImplementation(async ({ data }: any) => ({ id: 'tx-2', ...data }));
    prismaMock.bankAccount.findUnique.mockResolvedValue({ id: 'acc-1', currentBalance: 100 });

    await service.create({
      userId: 'user-1',
      categoryId: 'cat-1',
      type: TransactionType.EXPENSE,
      amount: 30,
      transactionDate: new Date(2026, 8, 10),
      bankAccountId: 'acc-1',
    });

    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { currentBalance: { decrement: 30 } },
    });
  });

  it('create() rejeita quando conta E cartão são informados juntos', async () => {
    await expect(
      service.create({
        userId: 'user-1',
        categoryId: 'cat-1',
        type: TransactionType.EXPENSE,
        amount: 30,
        transactionDate: new Date(),
        bankAccountId: 'acc-1',
        creditCardId: 'card-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('delete() lança NotFoundException se a transação pertence a outro usuário', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-999',
      bankAccountId: 'acc-1',
      type: TransactionType.EXPENSE,
      amount: 30,
    });

    await expect(service.delete('tx-1', 'user-1')).rejects.toThrow(NotFoundException);
  });

  it('delete() estorna o valor no saldo (reverte EXPENSE somando de volta)', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      userId: 'user-1',
      bankAccountId: 'acc-1',
      creditCardId: null,
      type: TransactionType.EXPENSE,
      amount: 30,
      transactionDate: new Date(2026, 8, 10),
      isConfirmed: true,
    });
    prismaMock.bankAccount.findUnique.mockResolvedValue({ id: 'acc-1' });

    await service.delete('tx-1', 'user-1');

    // Reverter uma EXPENSE de 30 deve gerar um increment (devolve o dinheiro)
    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { currentBalance: { increment: 30 } },
    });
  });
});

// ============================================================
// Faturas de cartão: sinal por tipo e simetria aplicar/desfazer
// ============================================================
// Mock de `upsert` que só registra chamada não serve aqui: o que precisa
// ser provado é o ACÚMULO — que criar e depois excluir devolve a fatura
// exatamente ao valor anterior. Por isso a fatura vive em memória e soma de
// verdade, do mesmo jeito que o `increment` do Prisma soma no banco.
describe('TransactionsService — fatura de cartão', () => {
  let service: TransactionsService;
  let prismaMock: any;
  let faturas: Map<string, { id: string; totalAmount: number }>;
  const transacoes = new Map<string, any>();

  const CARTAO = { id: 'card-1', closingDay: 10, dueDay: 17 };
  const SETEMBRO = new Date(2026, 8, 5); // antes do fechamento: fatura de setembro

  function totalDaFatura() {
    const f = [...faturas.values()][0];
    return f ? f.totalAmount : 0;
  }

  async function lancar(id: string, type: TransactionType, amount: number) {
    prismaMock.transaction.create.mockImplementationOnce(async ({ data }: any) => {
      const t = { id, ...data };
      transacoes.set(id, t);
      return t;
    });
    await service.create({
      userId: 'user-1',
      categoryId: 'cat-1',
      type,
      amount,
      transactionDate: SETEMBRO,
      creditCardId: CARTAO.id,
    });
  }

  beforeEach(async () => {
    faturas = new Map();
    transacoes.clear();

    prismaMock = {
      $transaction: jest.fn((callback) => callback(prismaMock)),
      transaction: {
        create: jest.fn(),
        findUnique: jest.fn(async ({ where }: any) => transacoes.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const t = { ...transacoes.get(where.id), ...data };
          transacoes.set(where.id, t);
          return t;
        }),
        delete: jest.fn(async ({ where }: any) => transacoes.delete(where.id)),
      },
      creditCard: { findUnique: jest.fn(async () => CARTAO) },
      category: CATEGORIA_FOLHA(),
      creditCardInvoice: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const chave = where.creditCardId_referenceMonth.referenceMonth.toISOString();
          const atual = faturas.get(chave);
          if (!atual) {
            const nova = { id: chave, totalAmount: Number(create.totalAmount) };
            faturas.set(chave, nova);
            return { ...nova };
          }
          atual.totalAmount += Number(update.totalAmount.increment);
          return { ...atual };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const f = [...faturas.values()].find((x) => x.id === where.id);
          if (f) f.totalAmount = Number(data.totalAmount);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TransactionsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('create', () => {
    it('despesa aumenta a fatura', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      expect(totalDaFatura()).toBe(300);
    });

    it('receita no cartão é estorno e DIMINUI a fatura', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      await lancar('t2', TransactionType.INCOME, 80);
      expect(totalDaFatura()).toBe(220);
    });
  });

  describe('delete', () => {
    it('excluir uma despesa tira o valor da fatura', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      await service.delete('t1', 'user-1');
      expect(totalDaFatura()).toBe(0);
    });

    it('excluir um estorno DEVOLVE o valor à fatura, não subtrai de novo', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      await lancar('t2', TransactionType.INCOME, 80);
      await service.delete('t2', 'user-1');
      expect(totalDaFatura()).toBe(300);
    });
  });

  describe('update', () => {
    it('reduzir um estorno de 80 para 50 deixa a fatura em 250', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      await lancar('t2', TransactionType.INCOME, 80);
      await service.update('t2', { amount: 50 }, 'user-1');
      expect(totalDaFatura()).toBe(250);
    });

    it('aumentar uma despesa de 300 para 450 deixa a fatura em 450', async () => {
      await lancar('t1', TransactionType.EXPENSE, 300);
      await service.update('t1', { amount: 450 }, 'user-1');
      expect(totalDaFatura()).toBe(450);
    });
  });

  describe('simetria', () => {
    it.each([TransactionType.EXPENSE, TransactionType.INCOME])(
      'criar e excluir %s devolve a fatura exatamente ao valor anterior',
      async (tipo) => {
        await lancar('base', TransactionType.EXPENSE, 500);
        const antes = totalDaFatura();
        await lancar('ida-e-volta', tipo, 137.5);
        await service.delete('ida-e-volta', 'user-1');
        expect(totalDaFatura()).toBe(antes);
      },
    );

    // Regressão da trava que zerava total negativo: ela apagava parte do
    // acúmulo e a exclusão seguinte devolvia um valor que nunca foi tirado.
    it('estorno registrado ANTES da compra não corrompe o total ao ser excluído', async () => {
      await lancar('estorno', TransactionType.INCOME, 80);
      expect(totalDaFatura()).toBe(-80);

      await lancar('compra', TransactionType.EXPENSE, 300);
      expect(totalDaFatura()).toBe(220);

      await service.delete('estorno', 'user-1');
      expect(totalDaFatura()).toBe(300); // com a trava antiga, dava 380
    });

    it('estornos acima das compras deixam saldo credor em vez de sumir', async () => {
      await lancar('compra', TransactionType.EXPENSE, 100);
      await lancar('estorno', TransactionType.INCOME, 150);
      expect(totalDaFatura()).toBe(-50);
    });
  });
});

// ============================================================
// Previsto × confirmado
// ============================================================
// Saldo da conta e total da fatura vivem em memória e somam de verdade:
// o que precisa ser provado é que um previsto NUNCA mexe neles, e que
// confirmar/desconfirmar aplica e desfaz exatamente o valor certo.
describe('TransactionsService — previsto × confirmado', () => {
  let service: TransactionsService;
  let prismaMock: any;
  let saldo: number;
  let fatura: number;
  const transacoes = new Map<string, any>();
  const CARTAO = { id: 'card-1', closingDay: 10, dueDay: 17 };
  let seq = 0;

  async function lancar(parcial: Partial<{ type: TransactionType; amount: number; isConfirmed: boolean; cartao: boolean }>) {
    const id = 't' + ++seq;
    prismaMock.transaction.create.mockImplementationOnce(async ({ data }: any) => {
      const t = { id, ...data };
      transacoes.set(id, t);
      return t;
    });
    await service.create({
      userId: 'user-1',
      categoryId: 'cat-1',
      type: parcial.type ?? TransactionType.EXPENSE,
      amount: parcial.amount ?? 100,
      transactionDate: new Date(2026, 8, 5),
      bankAccountId: parcial.cartao ? undefined : 'acc-1',
      creditCardId: parcial.cartao ? CARTAO.id : undefined,
      isConfirmed: parcial.isConfirmed,
    });
    return id;
  }

  beforeEach(async () => {
    saldo = 1000;
    fatura = 0;
    transacoes.clear();
    seq = 0;
    prismaMock = {
      $transaction: jest.fn((cb) => cb(prismaMock)),
      transaction: {
        create: jest.fn(),
        findUnique: jest.fn(async ({ where }: any) => transacoes.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const t = { ...transacoes.get(where.id), ...data };
          transacoes.set(where.id, t);
          return t;
        }),
        delete: jest.fn(async ({ where }: any) => transacoes.delete(where.id)),
      },
      bankAccount: {
        findUnique: jest.fn(async () => ({ id: 'acc-1' })),
        update: jest.fn(async ({ data }: any) => {
          const c = data.currentBalance;
          saldo += c.increment ?? -c.decrement;
        }),
      },
      creditCard: { findUnique: jest.fn(async () => CARTAO) },
      category: CATEGORIA_FOLHA(),
      creditCardInvoice: {
        upsert: jest.fn(async ({ create, update }: any) => {
          fatura += fatura === 0 && create ? Number(create.totalAmount) : Number(update.totalAmount.increment);
        }),
      },
    };
    const modulo: TestingModule = await Test.createTestingModule({
      providers: [TransactionsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = modulo.get(TransactionsService);
  });

  it('sem informar nada, o lançamento nasce confirmado (compatível com quem já usa a API)', async () => {
    await lancar({ amount: 100 });
    expect(saldo).toBe(900);
    expect(transacoes.get('t1').isConfirmed).toBe(true);
  });

  it('previsto na conta é gravado e NÃO mexe no saldo', async () => {
    await lancar({ amount: 100, isConfirmed: false });
    expect(saldo).toBe(1000);
    expect(transacoes.get('t1').isConfirmed).toBe(false);
  });

  it('previsto no cartão NÃO entra no total da fatura (nem ocupa limite)', async () => {
    await lancar({ amount: 250, isConfirmed: false, cartao: true });
    expect(fatura).toBe(0);
    expect(prismaMock.creditCardInvoice.upsert).not.toHaveBeenCalled();
  });

  it('confirmar aplica o valor; voltar a previsto desfaz', async () => {
    const id = await lancar({ amount: 100, isConfirmed: false });
    await service.update(id, { isConfirmed: true }, 'user-1');
    expect(saldo).toBe(900);
    await service.update(id, { isConfirmed: false }, 'user-1');
    expect(saldo).toBe(1000);
  });

  it('confirmar uma receita prevista soma no saldo', async () => {
    const id = await lancar({ type: TransactionType.INCOME, amount: 3000, isConfirmed: false });
    expect(saldo).toBe(1000);
    await service.update(id, { isConfirmed: true }, 'user-1');
    expect(saldo).toBe(4000);
  });

  it('editar o valor de um previsto não mexe no saldo', async () => {
    const id = await lancar({ amount: 100, isConfirmed: false });
    await service.update(id, { amount: 180 }, 'user-1');
    expect(saldo).toBe(1000);
    expect(Number(transacoes.get(id).amount)).toBe(180);
  });

  it('confirmar e mudar o valor na mesma edição aplica o valor NOVO', async () => {
    const id = await lancar({ amount: 100, isConfirmed: false });
    await service.update(id, { amount: 120, isConfirmed: true }, 'user-1');
    expect(saldo).toBe(880);
  });

  it('editar o valor de um confirmado ajusta só a diferença', async () => {
    const id = await lancar({ amount: 100 });
    await service.update(id, { amount: 130 }, 'user-1');
    expect(saldo).toBe(870);
  });

  it('excluir um previsto não devolve dinheiro que nunca saiu', async () => {
    const id = await lancar({ amount: 100, isConfirmed: false });
    await service.delete(id, 'user-1');
    expect(saldo).toBe(1000);
  });

  it('excluir um confirmado devolve o valor', async () => {
    const id = await lancar({ amount: 100 });
    await service.delete(id, 'user-1');
    expect(saldo).toBe(1000);
  });

  it('no cartão: confirmar põe na fatura, desconfirmar tira', async () => {
    const id = await lancar({ amount: 250, isConfirmed: false, cartao: true });
    await service.update(id, { isConfirmed: true }, 'user-1');
    expect(fatura).toBe(250);
    await service.update(id, { isConfirmed: false }, 'user-1');
    expect(fatura).toBe(0);
  });

  it('ida e volta não deixa resíduo: 20 confirmações e desconfirmações seguidas', async () => {
    const id = await lancar({ amount: 37.5, isConfirmed: false });
    for (let i = 0; i < 20; i++) {
      await service.update(id, { isConfirmed: i % 2 === 0 }, 'user-1');
    }
    expect(saldo).toBe(1000); // terminou em previsto (último i é ímpar)
  });
});

// ============================================================
// Categoria do lançamento e contas ocultas
// ============================================================
describe('TransactionsService — categoria e conta oculta', () => {
  let service: TransactionsService;
  let prismaMock: any;
  const MERCADO = { id: 'cat-mercado', name: 'Mercado' };
  const ALIMENTACAO = { id: 'cat-alim', name: 'Alimentação' }; // tem filhas
  const existente = {
    id: 'tx-1',
    userId: 'user-1',
    categoryId: ALIMENTACAO.id, // lançado antes de Alimentação ganhar filhas
    bankAccountId: 'acc-1',
    creditCardId: null,
    type: TransactionType.EXPENSE,
    amount: 40,
    transactionDate: utc('2026-09-05'),
    invoiceMonthOverride: null,
    isConfirmed: true,
  };

  const lancamento = (categoryId: string) => ({
    userId: 'user-1',
    categoryId,
    type: TransactionType.EXPENSE,
    amount: 10,
    transactionDate: utc('2026-09-05'),
    bankAccountId: 'acc-1',
  });

  beforeEach(() => {
    const categorias: Record<string, any> = { [MERCADO.id]: MERCADO, [ALIMENTACAO.id]: ALIMENTACAO };
    prismaMock = {
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
      transaction: {
        create: jest.fn(async ({ data }: any) => ({ id: 'novo', ...data })),
        findUnique: jest.fn(async () => ({ ...existente })),
        update: jest.fn(async ({ data }: any) => ({ ...existente, ...data })),
        findMany: jest.fn(async () => []),
      },
      bankAccount: { findUnique: jest.fn(async () => ({ id: 'acc-1' })), update: jest.fn() },
      category: {
        // Só enxerga o que o where permite: id conhecido (do usuário ou padrão).
        findFirst: jest.fn(async ({ where }: any) => categorias[where.id] ?? null),
        count: jest.fn(async ({ where }: any) => (where.parentId === ALIMENTACAO.id ? 2 : 0)),
      },
    };
    service = new TransactionsService(prismaMock);
  });

  it('lançamento novo em categoria com subcategorias é recusado', async () => {
    await expect(service.create(lancamento(ALIMENTACAO.id))).rejects.toThrow(/tem subcategorias/);
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it('categoria de outro usuário (ou inexistente) é recusada', async () => {
    await expect(service.create(lancamento('cat-de-outro'))).rejects.toThrow(NotFoundException);
  });

  it('folha é aceita', async () => {
    await service.create(lancamento(MERCADO.id));
    expect(prismaMock.transaction.create).toHaveBeenCalled();
  });

  it('editar sem trocar a categoria continua valendo, mesmo que ela tenha ganhado filhas', async () => {
    await service.update('tx-1', { amount: 50 }, 'user-1');
    expect(prismaMock.transaction.update).toHaveBeenCalled();
  });

  it('trocar PARA uma categoria com filhas é recusado', async () => {
    prismaMock.transaction.findUnique.mockResolvedValue({ ...existente, categoryId: MERCADO.id });
    await expect(service.update('tx-1', { categoryId: ALIMENTACAO.id }, 'user-1')).rejects.toThrow(
      /tem subcategorias/,
    );
  });

  it('listagem deixa conta oculta de fora por padrão', async () => {
    await service.findAllByUser('user-1', {});
    const where = prismaMock.transaction.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ bankAccountId: null }, { bankAccount: { isHidden: false } }]);
  });

  it('includeHidden ou filtro pela própria conta mostram tudo', async () => {
    await service.findAllByUser('user-1', { includeHidden: true });
    await service.findAllByUser('user-1', { bankAccountId: 'acc-oculta' });
    for (const [args] of prismaMock.transaction.findMany.mock.calls) expect(args.where.OR).toBeUndefined();
  });
});

// ============================================================
// NOTA DE REATORAÇÃO NECESSÁRIA
// ============================================================
// Este arquivo de teste importa `resolveInvoicePeriod`, `validateAmount`
// e `validateAccountXorCard` de um `transaction.utils.ts` que ainda não
// existe no service anterior (lá elas estão como métodos `private`).
// Extraia essas três funções do `TransactionsService` para um arquivo
// `transaction.utils.ts` como funções puras exportadas — isso não muda
// nenhum comportamento, só move o código, e os testes acima passam a
// rodar sem precisar instanciar a classe inteira nem usar `any`/hacks
// para acessar métodos privados.
