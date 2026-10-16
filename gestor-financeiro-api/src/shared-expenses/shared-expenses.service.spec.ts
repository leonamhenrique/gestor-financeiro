// ============================================================
// shared-expenses.service.spec.ts
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SharedExpensesService } from './shared-expenses.service';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

describe('SharedExpensesService', () => {
  let service: SharedExpensesService;
  let prisma: any;
  let transactions: any;
  let people: any;
  let criada: any;

  const DIVIDIR_COM_RAFAEL = {
    mode: 'IGUAL' as const,
    participants: [{ personId: 'rafael' }],
  };

  beforeEach(async () => {
    criada = null;

    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      sharedExpense: {
        create: jest.fn(async ({ data }: any) => {
          criada = data;
          return { id: 'd1', ...data };
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
      transaction: { findFirst: jest.fn() },
      expenseShare: { deleteMany: jest.fn(), createMany: jest.fn() },
    };

    transactions = {
      criarEm: jest.fn(async (_tx: any, input: any) => ({
        id: 'tx-1',
        amount: input.amount,
      })),
    };

    people = { minha: jest.fn(async (_u: string, id: string) => ({ id })) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionsService, useValue: transactions },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();

    service = module.get(SharedExpensesService);
  });

  // ----------------------------------------------------------
  // eu paguei, lançamento novo
  // ----------------------------------------------------------

  it('cria o lançamento e a divisão na MESMA transação de banco', async () => {
    await service.create({
      userId: 'u1',
      description: 'Jantar',
      amount: 200,
      date: '2026-10-12',
      categoryId: 'cat-1',
      creditCardId: 'card-1',
      ...DIVIDIR_COM_RAFAEL,
    });

    // `criarEm` e não `create`: um `create` abriria uma segunda transação
    // dentro da primeira, e uma falha na divisão deixaria o lançamento
    // gravado sozinho, já tendo mexido na fatura.
    expect(transactions.criarEm).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(criada.transactionId).toBe('tx-1');
  });

  it('quando eu paguei, os campos do gasto NÃO são copiados para a divisão', async () => {
    await service.create({
      userId: 'u1',
      description: 'Jantar',
      amount: 200,
      date: '2026-10-12',
      categoryId: 'cat-1',
      bankAccountId: 'acc-1',
      ...DIVIDIR_COM_RAFAEL,
    });

    // A verdade está no lançamento. Uma cópia aqui seria uma segunda versão
    // do mesmo número, livre para divergir numa edição.
    expect(criada.description).toBeNull();
    expect(criada.amount).toBeNull();
    expect(criada.expenseDate).toBeNull();
    expect(criada.categoryId).toBeNull();
  });

  it('grava a parte do outro, e só a dele', async () => {
    await service.create({
      userId: 'u1',
      amount: 200,
      date: '2026-10-12',
      categoryId: 'cat-1',
      bankAccountId: 'acc-1',
      ...DIVIDIR_COM_RAFAEL,
    });

    const partes = criada.shares.create;
    expect(partes).toHaveLength(1);
    expect(partes[0].personId).toBe('rafael');
    expect(Number(partes[0].amount)).toBe(100);
  });

  it('divide com mais de uma pessoa', async () => {
    await service.create({
      userId: 'u1',
      amount: 300,
      date: '2026-10-12',
      categoryId: 'cat-1',
      bankAccountId: 'acc-1',
      mode: 'IGUAL',
      participants: [{ personId: 'a' }, { personId: 'b' }],
    });

    const partes = criada.shares.create;
    expect(partes.map((p: any) => Number(p.amount))).toEqual([100, 100]);
  });

  // ----------------------------------------------------------
  // ela pagou
  // ----------------------------------------------------------

  it('quando ela pagou, não existe lançamento nenhum', async () => {
    await service.create({
      userId: 'u1',
      paidByPersonId: 'bruna',
      description: 'Ingressos do show',
      amount: 240,
      date: '2026-10-07',
      categoryId: 'cat-2',
      mode: 'IGUAL',
      participants: [{ personId: 'bruna' }],
    });

    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(criada.transactionId).toBeNull();
    expect(criada.paidByPersonId).toBe('bruna');
    // Aqui os campos descritivos SÃO da despesa: não há lançamento que os
    // guarde.
    expect(criada.description).toBe('Ingressos do show');
    expect(Number(criada.amount)).toBe(240);
  });

  it('gasto do outro não sai de conta nem de cartão meu', async () => {
    await expect(
      service.create({
        userId: 'u1',
        paidByPersonId: 'bruna',
        amount: 240,
        date: '2026-10-07',
        bankAccountId: 'acc-1',
        mode: 'IGUAL',
        participants: [{ personId: 'bruna' }],
      }),
    ).rejects.toThrow(/não saiu de conta nem de cartão seu/);
  });

  it('gasto do outro não tem lançamento meu para dividir', async () => {
    await expect(
      service.create({
        userId: 'u1',
        paidByPersonId: 'bruna',
        transactionId: 'tx-9',
        amount: 240,
        date: '2026-10-07',
        mode: 'IGUAL',
        participants: [{ personId: 'bruna' }],
      }),
    ).rejects.toThrow(/não tem lançamento meu/);
  });

  // ----------------------------------------------------------
  // dividir um lançamento que já existe
  // ----------------------------------------------------------

  it('divide um lançamento existente usando o valor DELE', async () => {
    prisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-5',
      amount: 1200,
      type: 'EXPENSE',
    });

    await service.create({ userId: 'u1', transactionId: 'tx-5', ...DIVIDIR_COM_RAFAEL });

    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(criada.transactionId).toBe('tx-5');
    expect(Number(criada.shares.create[0].amount)).toBe(600);
  });

  it('receita não se divide: não é gasto de ninguém', async () => {
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-6', amount: 500, type: 'INCOME' });

    await expect(
      service.create({ userId: 'u1', transactionId: 'tx-6', ...DIVIDIR_COM_RAFAEL }),
    ).rejects.toThrow(/Só despesa se divide/);
  });

  it('não divide duas vezes o mesmo lançamento', async () => {
    prisma.transaction.findFirst.mockResolvedValue({ id: 'tx-7', amount: 100, type: 'EXPENSE' });
    prisma.sharedExpense.findUnique.mockResolvedValue({ id: 'ja-existe' });

    await expect(
      service.create({ userId: 'u1', transactionId: 'tx-7', ...DIVIDIR_COM_RAFAEL }),
    ).rejects.toThrow(/já está dividido/);
  });

  it('lançamento de outro dono não existe para mim', async () => {
    prisma.transaction.findFirst.mockResolvedValue(null);

    await expect(
      service.create({ userId: 'u1', transactionId: 'de-outro', ...DIVIDIR_COM_RAFAEL }),
    ).rejects.toThrow(NotFoundException);
  });

  // ----------------------------------------------------------
  // posse e idempotência
  // ----------------------------------------------------------

  it('confere a posse de TODA pessoa citada, inclusive a que pagou', async () => {
    await service.create({
      userId: 'u1',
      paidByPersonId: 'bruna',
      amount: 240,
      date: '2026-10-07',
      mode: 'VALOR',
      participants: [{ personId: 'bruna', amount: 120 }],
    });

    expect(people.minha).toHaveBeenCalledWith('u1', 'bruna');
  });

  it('pessoa de outro dono derruba a criação antes de gravar qualquer coisa', async () => {
    people.minha.mockRejectedValue(new NotFoundException('Pessoa não encontrada'));

    await expect(
      service.create({
        userId: 'u1',
        amount: 100,
        date: '2026-10-01',
        categoryId: 'c',
        bankAccountId: 'acc-1',
        ...DIVIDIR_COM_RAFAEL,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.sharedExpense.create).not.toHaveBeenCalled();
    expect(transactions.criarEm).not.toHaveBeenCalled();
  });

  it('mesma clientKey devolve a despesa que já existe', async () => {
    prisma.sharedExpense.findFirst.mockResolvedValue({ id: 'ja-gravada' });

    const r: any = await service.create({
      userId: 'u1',
      amount: 100,
      date: '2026-10-01',
      categoryId: 'c',
      bankAccountId: 'acc-1',
      clientKey: 'k1',
      ...DIVIDIR_COM_RAFAEL,
    });

    expect(r.id).toBe('ja-gravada');
    expect(prisma.sharedExpense.create).not.toHaveBeenCalled();
  });

  it('a chave do lançamento é derivada da chave da despesa, não a mesma', async () => {
    await service.create({
      userId: 'u1',
      amount: 100,
      date: '2026-10-01',
      categoryId: 'c',
      bankAccountId: 'acc-1',
      clientKey: 'k1',
      ...DIVIDIR_COM_RAFAEL,
    });

    // São duas linhas em duas tabelas, cada uma com o seu índice único.
    expect(transactions.criarEm.mock.calls[0][1].clientKey).toBe('k1:lancamento');
    expect(criada.clientKey).toBe('k1');
  });

  it('faltando valor ou data, não grava nada', async () => {
    await expect(
      service.create({ userId: 'u1', categoryId: 'c', bankAccountId: 'acc-1', ...DIVIDIR_COM_RAFAEL }),
    ).rejects.toThrow(BadRequestException);
  });

  // ----------------------------------------------------------
  // listar e apagar
  // ----------------------------------------------------------

  it('o filtro de data aceita as DUAS formas de despesa', async () => {
    await service.findAllByUser('u1', { from: '2026-10-01', to: '2026-10-31' });

    const where = prisma.sharedExpense.findMany.mock.calls[0][0].where;
    // Sem o OR, as despesas pagas pelo amigo (que guardam a data nelas
    // mesmas) sumiriam da lista do mês.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty('transaction.transactionDate');
    expect(where.OR[1]).toHaveProperty('expenseDate');
  });

  it('apagar a divisão não apaga o lançamento: o gasto continua tendo acontecido', async () => {
    prisma.sharedExpense.findFirst.mockResolvedValue({ id: 'd1', transactionId: 'tx-1' });

    const r = await service.remove('u1', 'd1');

    expect(prisma.sharedExpense.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(r.transactionId).toBe('tx-1');
  });

  it('refazer o rateio troca as partes sem tocar no lançamento', async () => {
    prisma.sharedExpense.findFirst.mockResolvedValue({
      id: 'd1',
      transaction: { amount: 200 },
    });

    await service.updateSplit('u1', 'd1', 'VALOR', [{ personId: 'rafael', amount: 50 }]);

    expect(prisma.expenseShare.deleteMany).toHaveBeenCalledWith({
      where: { sharedExpenseId: 'd1' },
    });
    expect(Number(prisma.expenseShare.createMany.mock.calls[0][0].data[0].amount)).toBe(50);
  });
});

// A regra travada do projeto: todo lançamento pertence a UMA conta OU a UM
// cartão. Criar pelo módulo das compartilhadas não pode ser um atalho para
// furá-la — e não é, porque `criarEm` passa por `validarEntrada`.
describe('SharedExpensesService — a regra do XOR continua valendo', () => {
  it('o destino do lançamento é repassado intacto ao TransactionsService', async () => {
    const transactions = {
      criarEm: jest.fn(async (_tx: any, input: any) => ({ id: 'tx', amount: input.amount })),
    };
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      sharedExpense: {
        create: jest.fn(async ({ data }: any) => ({ id: 'd', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionsService, useValue: transactions },
        { provide: PeopleService, useValue: { minha: jest.fn(async (_u, id) => ({ id })) } },
      ],
    }).compile();

    await mod.get(SharedExpensesService).create({
      userId: 'u1',
      amount: 100,
      date: '2026-10-01',
      categoryId: 'c',
      creditCardId: 'card-1',
      mode: 'IGUAL',
      participants: [{ personId: 'rafael' }],
    });

    // Nem a conta nem o cartão são inventados aqui: vão como vieram, e quem
    // recusa os dois juntos (ou nenhum) é `validateAccountXorCard`.
    const input = transactions.criarEm.mock.calls[0][1];
    expect(input.creditCardId).toBe('card-1');
    expect(input.bankAccountId).toBeUndefined();
    expect(input.type).toBe('EXPENSE');
  });
});
