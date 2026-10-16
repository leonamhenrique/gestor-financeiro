// ============================================================
// impacto-no-relatorio.spec.ts
// ============================================================
// Prova, e não promessa: o módulo de despesas compartilhadas não mexe em
// nenhum número de relatório que já existia.
//
// A garantia vem do desenho — acerto e divisão vivem em tabelas próprias, e
// o relatório lê `transaction` — mas "o desenho garante" é exatamente o tipo
// de frase que envelhece mal. Estes testes travam a garantia:
//
//   1. o acerto NÃO é lançamento, então não há o que o relatório pudesse ler;
//   2. dividir um gasto NÃO altera o lançamento, então o valor cheio
//      continua pesando no mês — a parte do outro é informação ao lado, e
//      não um desconto silencioso em todo relatório já visto pelo usuário.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { SettlementsService } from './settlements.service';
import { SharedExpensesService } from './shared-expenses.service';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { SettlementDirection } from '@prisma/client';

describe('o que as compartilhadas NÃO fazem com o relatório', () => {
  let acertos: SettlementsService;
  let despesas: SharedExpensesService;
  let prisma: any;
  let transactions: any;
  let lancamentosCriados: any[];
  let lancamentosAlterados: any[];

  beforeEach(async () => {
    lancamentosCriados = [];
    lancamentosAlterados = [];

    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      settlement: {
        create: jest.fn(async ({ data }: any) => ({ id: 's1', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      sharedExpense: {
        create: jest.fn(async ({ data }: any) => ({ id: 'd1', ...data })),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      transaction: {
        findFirst: jest.fn(async () => ({ id: 'tx-1', amount: 200, type: 'EXPENSE' })),
        update: jest.fn(async (args: any) => {
          lancamentosAlterados.push(args);
          return args;
        }),
      },
      bankAccount: { findFirst: jest.fn(async () => ({ id: 'acc-1' })), update: jest.fn() },
      expenseShare: { deleteMany: jest.fn(), createMany: jest.fn() },
    };

    transactions = {
      criarEm: jest.fn(async (_tx: any, input: any) => {
        lancamentosCriados.push(input);
        return { id: 'tx-novo', amount: input.amount };
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        SharedExpensesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TransactionsService, useValue: transactions },
        { provide: PeopleService, useValue: { minha: jest.fn(async (_u, id) => ({ id })) } },
      ],
    }).compile();

    acertos = module.get(SettlementsService);
    despesas = module.get(SharedExpensesService);
  });

  // ---- 1. o acerto ----

  it('receber um acerto não cria lançamento nenhum', async () => {
    await acertos.create({
      userId: 'u1',
      personId: 'rafael',
      direction: SettlementDirection.RECEIVED,
      amount: 300,
      settledAt: '2026-10-14',
      bankAccountId: 'acc-1',
    });

    // Sem lançamento não há o que entrar em mapa de calor, resultado do mês,
    // relatório por categoria ou fluxo de caixa — e nenhum deles precisa de
    // uma exceção para expulsar o acerto.
    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(lancamentosCriados).toHaveLength(0);
  });

  it('o acerto não tem categoria nem tipo: não há como ele virar receita', async () => {
    await acertos.create({
      userId: 'u1',
      personId: 'rafael',
      direction: SettlementDirection.RECEIVED,
      amount: 300,
      settledAt: '2026-10-14',
      bankAccountId: 'acc-1',
    });

    const gravado = prisma.settlement.create.mock.calls[0][0].data;
    expect(gravado).not.toHaveProperty('categoryId');
    expect(gravado).not.toHaveProperty('type');
  });

  it('pagar um acerto também não vira despesa', async () => {
    await acertos.create({
      userId: 'u1',
      personId: 'bruna',
      direction: SettlementDirection.PAID,
      amount: 120,
      settledAt: '2026-10-20',
      bankAccountId: 'acc-1',
    });

    expect(transactions.criarEm).not.toHaveBeenCalled();
  });

  // ---- 2. a divisão ----

  it('dividir um gasto que já existe não altera o lançamento', async () => {
    await despesas.create({
      userId: 'u1',
      transactionId: 'tx-1',
      mode: 'IGUAL',
      participants: [{ personId: 'rafael' }],
    });

    // O valor cheio continua lá: o relatório do mês não muda porque alguém
    // vai devolver metade depois.
    expect(lancamentosAlterados).toHaveLength(0);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('refazer o rateio também não encosta no lançamento', async () => {
    prisma.sharedExpense.findFirst.mockResolvedValue({
      id: 'd1',
      transaction: { amount: 200 },
    });

    await despesas.update('u1', 'd1', { mode: 'VALOR', participants: [{ personId: 'rafael', amount: 80 }] });

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it('o gasto nasce com o valor CHEIO, não com a minha parte', async () => {
    await despesas.create({
      userId: 'u1',
      amount: 200,
      date: '2026-10-12',
      categoryId: 'cat-1',
      bankAccountId: 'acc-1',
      mode: 'IGUAL',
      participants: [{ personId: 'rafael' }],
    });

    // Lançar só a minha parte "arrumaria" o relatório e quebraria o saldo da
    // conta: saíram 200 de lá, não 100.
    expect(lancamentosCriados[0].amount).toBe(200);
  });

  it('o gasto do amigo não vira lançamento meu: nada entra no meu relatório', async () => {
    await despesas.create({
      userId: 'u1',
      paidByPersonId: 'bruna',
      amount: 240,
      date: '2026-10-07',
      description: 'Ingressos',
      mode: 'IGUAL',
      participants: [{ personId: 'bruna' }],
    });

    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(lancamentosCriados).toHaveLength(0);
  });
});
