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

    await service.update('u1', 'd1', { mode: 'VALOR', participants: [{ personId: 'rafael', amount: 50 }] });

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

// O prazo padrao do Prisma e 5 segundos, e esta operacao nao cabe nele: nove
// consultas numa transacao so, numa instancia de 0,1 de CPU. Em producao
// falhava SEMPRE, com "Transaction not found" -- a transacao era fechada pelo
// relogio e a consulta seguinte nao achava mais ela. O teste existe para o
// prazo nao sumir numa refatoracao futura.
describe('SharedExpensesService — o prazo da transacao', () => {
  async function montar() {
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      sharedExpense: {
        create: jest.fn(async ({ data }: any) => ({ id: 'd', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      expenseShare: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TransactionsService,
          useValue: { criarEm: jest.fn(async (_t: any, i: any) => ({ id: 'tx', amount: i.amount })) },
        },
        { provide: PeopleService, useValue: { minha: jest.fn(async (_u: any, id: string) => ({ id })) } },
      ],
    }).compile();
    return { service: mod.get(SharedExpensesService), prisma };
  }

  it('criar abre a transacao com prazo folgado, nao com o padrao', async () => {
    const { service, prisma } = await montar();
    await service.create({
      userId: 'u1', amount: 100, date: '2026-10-01', categoryId: 'c',
      creditCardId: 'card-1', mode: 'IGUAL', participants: [{ personId: 'p' }],
    });

    const opcoes = prisma.$transaction.mock.calls[0][1];
    expect(opcoes).toBeDefined();
    expect(opcoes.timeout).toBeGreaterThan(5000);
    expect(opcoes.maxWait).toBeGreaterThan(2000);
  });

  it('refazer o rateio tambem', async () => {
    const { service, prisma } = await montar();
    prisma.sharedExpense.findFirst.mockResolvedValue({ id: 'd1', transaction: { amount: 200 } });

    await service.update('u1', 'd1', { mode: 'VALOR', participants: [{ personId: 'p', amount: 50 }] });

    expect(prisma.$transaction.mock.calls[0][1].timeout).toBeGreaterThan(5000);
  });
});

// A saida que a recusa de editar o valor pelo lancamento comum manda
// procurar. Sem ela, a mensagem apontava para uma porta que nao existia: o
// usuario era mandado para a tela de compartilhadas e nao achava onde mudar.
describe('SharedExpensesService — editar valor e rateio juntos', () => {
  async function montar(despesa: any) {
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      sharedExpense: {
        findFirst: jest.fn().mockResolvedValue(despesa),
        findUnique: jest.fn().mockResolvedValue(despesa),
        update: jest.fn(),
      },
      expenseShare: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const transactions: any = {
      atualizarEm: jest.fn(async (_tx: any, _id: string, _dados: any) => ({ id: 'tx-1' })),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionsService, useValue: transactions },
        { provide: PeopleService, useValue: { minha: jest.fn(async (_u: any, id: string) => ({ id })) } },
      ],
    }).compile();
    return { service: mod.get(SharedExpensesService), prisma, transactions };
  }

  const MEU = { id: 'd1', transactionId: 'tx-1', transaction: { amount: 200 }, shares: [] };
  const DELA = { id: 'd2', transactionId: null, transaction: null, amount: 240, shares: [] };

  it('mudar o valor reescreve o lançamento E as partes, na mesma transação', async () => {
    const { service, prisma, transactions } = await montar(MEU);

    await service.update('u1', 'd1', {
      amount: 300,
      mode: 'IGUAL',
      participants: [{ personId: 'rafael' }],
    });

    expect(transactions.atualizarEm).toHaveBeenCalledTimes(1);
    expect(transactions.atualizarEm.mock.calls[0][2].amount).toBe(300);
    // E as partes acompanham: 300 meio a meio é 150, não os 100 de antes.
    expect(Number(prisma.expenseShare.createMany.mock.calls[0][0].data[0].amount)).toBe(150);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refazer só o rateio não encosta no lançamento', async () => {
    const { service, transactions } = await montar(MEU);

    await service.update('u1', 'd1', {
      mode: 'VALOR',
      participants: [{ personId: 'rafael', amount: 50 }],
    });

    // Reescrever com os mesmos valores estornaria e reaplicaria o efeito à
    // toa, mexendo em saldo e fatura para chegar no mesmo lugar.
    expect(transactions.atualizarEm).not.toHaveBeenCalled();
  });

  it('repetir o mesmo valor também não é mudança', async () => {
    const { service, transactions } = await montar(MEU);

    await service.update('u1', 'd1', {
      amount: 200,
      mode: 'IGUAL',
      participants: [{ personId: 'rafael' }],
    });

    expect(transactions.atualizarEm).not.toHaveBeenCalled();
  });

  it('divisão que não fecha é recusada ANTES de qualquer gravação', async () => {
    const { service, prisma, transactions } = await montar(MEU);

    await expect(
      service.update('u1', 'd1', {
        amount: 300,
        mode: 'VALOR',
        participants: [{ personId: 'rafael', amount: 500 }],
      }),
    ).rejects.toThrow(/passou do valor/);

    expect(transactions.atualizarEm).not.toHaveBeenCalled();
    expect(prisma.expenseShare.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no gasto que ELA pagou, o valor mora na própria despesa', async () => {
    const { service, prisma, transactions } = await montar(DELA);

    await service.update('u1', 'd2', {
      amount: 300,
      mode: 'IGUAL',
      participants: [{ personId: 'bruna' }],
    });

    expect(transactions.atualizarEm).not.toHaveBeenCalled();
    expect(Number(prisma.sharedExpense.update.mock.calls[0][0].data.amount)).toBe(300);
    expect(Number(prisma.expenseShare.createMany.mock.calls[0][0].data[0].amount)).toBe(150);
  });

  it('dá para trocar a pessoa com quem se divide', async () => {
    const { service, prisma } = await montar(MEU);

    await service.update('u1', 'd1', {
      mode: 'IGUAL',
      participants: [{ personId: 'outra-pessoa' }],
    });

    expect(prisma.expenseShare.deleteMany).toHaveBeenCalledWith({ where: { sharedExpenseId: 'd1' } });
    expect(prisma.expenseShare.createMany.mock.calls[0][0].data[0].personId).toBe('outra-pessoa');
  });
});

// Uma viagem em 12 parcelas rachada com um amigo. Cada parcela precisa da
// SUA divisao: a de agosto dividida meio a meio e uma divida de agosto, e
// quita-la nao quita a de setembro.
describe('SharedExpensesService — despesa dividida que se repete', () => {
  let service: SharedExpensesService;
  let prisma: any;
  let transactions: any;
  let criadas: any[];

  beforeEach(async () => {
    criadas = [];
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      sharedExpense: {
        create: jest.fn(async ({ data }: any) => { criadas.push(data); return { id: 'd' + criadas.length, ...data }; }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    transactions = {
      criarSerieEm: jest.fn(async (_tx: any, _i: any, repeat: any) => ({
        series: { id: 'serie-1', count: repeat.count },
        transactions: Array.from({ length: repeat.count }, (_, i) => ({ id: 'tx-' + i })),
      })),
      criarEm: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionsService, useValue: transactions },
        { provide: PeopleService, useValue: { minha: jest.fn(async (_u: any, id: string) => ({ id })) } },
      ],
    }).compile();
    service = mod.get(SharedExpensesService);
  });

  // 14.400 é o preço da VIAGEM INTEIRA: em 12x dá 1.200 por parcela, e 600
  // de parte do Rafael em cada uma. Numa parcelada o valor digitado é o da
  // compra, não o da parcela — ver `createSeries`.
  const VIAGEM = {
    userId: 'u1', description: 'Viagem', amount: 14400, date: '2026-10-16',
    categoryId: 'cat-1', creditCardId: 'card-1',
    mode: 'IGUAL' as const, participants: [{ personId: 'rafael' }],
  };
  const EM_12 = { kind: 'INSTALLMENT' as any, frequency: 'MONTHLY' as any, count: 12 };

  it('doze parcelas geram doze divisões, uma por ocorrência', async () => {
    const r: any = await service.createSeries(VIAGEM, EM_12);

    expect(transactions.criarSerieEm).toHaveBeenCalledTimes(1);
    expect(r.despesas).toHaveLength(12);
    expect(criadas).toHaveLength(12);
    // Uma divisão por lançamento, e cada uma no SEU.
    expect(criadas.map((c) => c.transactionId)).toEqual(
      Array.from({ length: 12 }, (_, i) => 'tx-' + i),
    );
  });

  // O caso que o usuário trouxe: digitou 5.000 no "valor total", parcelou
  // em 5 e a tela respondeu "total R$ 25.000,00". O valor da compra não
  // muda porque ela foi parcelada — são 5 de 1.000, e 500 dele por vez.
  it('PARCELADA: o valor digitado é o da compra, e as parcelas são pedaços dele', async () => {
    const r: any = await service.createSeries(
      { ...VIAGEM, amount: 5000 },
      { kind: 'INSTALLMENT' as any, frequency: 'MONTHLY' as any, count: 5 },
    );

    // Os lançamentos valem 1.000 cada, não 5.000.
    const valores = transactions.criarSerieEm.mock.calls[0][5];
    expect(Array.from({ length: 5 }, (_, i) => valores(i))).toEqual([1000, 1000, 1000, 1000, 1000]);
    // E a parte dele é 500 por parcela — 2.500 no total, não 12.500.
    expect(criadas.map((c) => Number(c.shares.create[0].amount))).toEqual([500, 500, 500, 500, 500]);
    expect(r.despesas).toHaveLength(5);
  });

  it('FIXA: o valor é o de cada vez, e se repete inteiro', async () => {
    // Um aluguel de 2.500 por mês é 2.500 todo mês — não um total a
    // repartir pelos doze. É a diferença que o "tipo de repetição" pergunta.
    await service.createSeries(
      { ...VIAGEM, amount: 2500 },
      { kind: 'FIXED' as any, frequency: 'MONTHLY' as any, count: 12 },
    );
    const valores = transactions.criarSerieEm.mock.calls[0][5];
    expect(valores(0)).toBe(2500);
    expect(valores(11)).toBe(2500);
    criadas.forEach((c) => expect(Number(c.shares.create[0].amount)).toBe(1250));
  });

  it('parcela que não fecha redonda: o centavo vai para a primeira', async () => {
    await service.createSeries(
      { ...VIAGEM, amount: 100 },
      { kind: 'INSTALLMENT' as any, frequency: 'MONTHLY' as any, count: 3 },
    );
    const valores = transactions.criarSerieEm.mock.calls[0][5];
    expect([valores(0), valores(1), valores(2)]).toEqual([33.34, 33.33, 33.33]);
    // E a soma das partes dele é exatamente a metade de 100.
    const dele = criadas.reduce((s, c) => s + Math.round(Number(c.shares.create[0].amount) * 100), 0);
    expect(dele).toBe(5000);
  });

  it('cada parcela carrega a parte do amigo, não a viagem inteira', async () => {
    await service.createSeries(VIAGEM, EM_12);

    criadas.forEach((c) => {
      expect(Number(c.shares.create[0].amount)).toBe(600);
      expect(c.shares.create[0].personId).toBe('rafael');
    });
  });

  it('tudo numa transação de banco só', async () => {
    await service.createSeries(VIAGEM, EM_12);
    // Doze lançamentos e doze divisões: se metade gravasse, a dívida ficaria
    // pela metade e ninguém saberia dizer qual metade.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a divisão é conferida ANTES de criar lançamento nenhum', async () => {
    await expect(
      service.createSeries(
        // 20.000 de parte numa viagem de 14.400: não fecha.
        { ...VIAGEM, mode: 'VALOR', participants: [{ personId: 'rafael', amount: 20000 }] },
        EM_12,
      ),
    ).rejects.toThrow(/passou do valor/);

    expect(transactions.criarSerieEm).not.toHaveBeenCalled();
    expect(prisma.sharedExpense.create).not.toHaveBeenCalled();
  });

  it('cada ocorrência tem a sua chave: a mesma nas doze colidiria consigo', async () => {
    await service.createSeries({ ...VIAGEM, clientKey: 'k1' }, EM_12);
    expect(criadas.map((c) => c.clientKey)).toEqual(
      Array.from({ length: 12 }, (_, i) => 'k1#' + i),
    );
  });

  // A fila offline reenvia quando a resposta se perde no caminho. Aí
  // `criarSerieEm` devolve os lançamentos que já existem, e se a divisão
  // tentasse nascer de novo batia no único de `transaction_id`: 500 na cara
  // do usuário, justo no caso em que a chave existe para proteger.
  it('reenviar a mesma chave devolve as divisões que já existem, sem duplicar', async () => {
    const jaGravadas = Array.from({ length: 12 }, (_, i) => ({
      id: 'd-velha-' + i,
      transactionId: 'tx-' + i,
      shares: [{ personId: 'rafael', amount: 600 }],
    }));
    prisma.sharedExpense.findFirst = jest.fn(async ({ where }: any) =>
      jaGravadas.find((d) => d.transactionId === where.transactionId) ?? null,
    );

    const r: any = await service.createSeries({ ...VIAGEM, clientKey: 'k1' }, EM_12);

    expect(prisma.sharedExpense.create).not.toHaveBeenCalled();
    expect(r.despesas.map((d: any) => d.id)).toEqual(jaGravadas.map((d) => d.id));
  });

  it('gasto que a OUTRA pessoa pagou não repete: a série é dela', async () => {
    await expect(
      service.createSeries({ ...VIAGEM, paidByPersonId: 'rafael', creditCardId: undefined }, EM_12),
    ).rejects.toThrow(/Só dá para repetir um gasto seu/);
  });

  it('dividir um lançamento que já existe também não repete', async () => {
    await expect(
      service.createSeries({ ...VIAGEM, transactionId: 'tx-9' }, EM_12),
    ).rejects.toThrow(/Só dá para repetir um gasto seu/);
  });
});
