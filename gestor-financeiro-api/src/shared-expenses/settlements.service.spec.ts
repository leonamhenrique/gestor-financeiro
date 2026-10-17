// ============================================================
// settlements.service.spec.ts
// ============================================================
// O acerto mexe em saldo mas não é lançamento. Os testes olham as duas
// coisas: que o saldo anda para o lado certo, e que apagar desfaz exatamente
// o que criar fez.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementDirection } from '@prisma/client';
import { TransactionsService } from '../transactions/transactions.service';

describe('SettlementsService', () => {
  let service: SettlementsService;
  let prisma: any;
  let saldo: number;
  let gravado: any;

  const BASE = {
    userId: 'u1',
    personId: 'rafael',
    amount: 300,
    settledAt: '2026-10-14',
    bankAccountId: 'acc-1',
  };

  beforeEach(async () => {
    saldo = 1000;
    gravado = null;

    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      settlement: {
        create: jest.fn(async ({ data }: any) => {
          gravado = { id: 's1', ...data, amount: Number(data.amount) };
          return gravado;
        }),
        findFirst: jest.fn(async () => gravado),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
      bankAccount: {
        findFirst: jest.fn(async () => ({ id: 'acc-1' })),
        update: jest.fn(async ({ data }: any) => {
          saldo += data.currentBalance.increment ?? -data.currentBalance.decrement;
        }),
      },
    };

    const people = { minha: jest.fn(async () => ({ id: 'rafael', userId: 'u1' })) };
    // Sem categoria nenhum teste daqui cria lancamento; o duble existe so
    // para o grafo de injecao fechar.
    const transactions = { criarEm: jest.fn(), apagarEm: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: people },
        { provide: TransactionsService, useValue: transactions },
      ],
    }).compile();

    service = module.get(SettlementsService);
  });

  it('receber entra na conta', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED });
    expect(saldo).toBe(1300);
  });

  it('pagar sai da conta', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID });
    expect(saldo).toBe(700);
  });

  // Dinheiro vivo: a dívida é abatida do mesmo jeito, mas nenhum saldo do
  // app mudou — porque nenhuma conta do app recebeu nada.
  it('acerto sem conta não mexe em saldo nenhum', async () => {
    await service.create({
      ...BASE,
      bankAccountId: undefined,
      direction: SettlementDirection.RECEIVED,
    });
    expect(saldo).toBe(1000);
    expect(prisma.bankAccount.update).not.toHaveBeenCalled();
  });

  it('apagar devolve o saldo ao que era: receber e depois apagar', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED });
    expect(saldo).toBe(1300);
    await service.remove('u1', 's1');
    expect(saldo).toBe(1000);
  });

  it('apagar devolve o saldo ao que era: pagar e depois apagar', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID });
    expect(saldo).toBe(700);
    await service.remove('u1', 's1');
    expect(saldo).toBe(1000);
  });

  it('apagar acerto sem conta não inventa movimento', async () => {
    await service.create({
      ...BASE,
      bankAccountId: undefined,
      direction: SettlementDirection.PAID,
    });
    await service.remove('u1', 's1');
    expect(saldo).toBe(1000);
  });

  it('acerto de outro dono não existe para mim', async () => {
    prisma.settlement.findFirst.mockResolvedValue(null);
    await expect(service.remove('u1', 'de-outro')).rejects.toThrow(NotFoundException);
  });

  it('recusa valor zero ou negativo', async () => {
    await expect(
      service.create({ ...BASE, amount: 0, direction: SettlementDirection.PAID }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create({ ...BASE, amount: -10, direction: SettlementDirection.PAID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa conta que não é minha', async () => {
    prisma.bankAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...BASE, direction: SettlementDirection.RECEIVED }),
    ).rejects.toThrow(NotFoundException);
  });

  it('sem categoria, o acerto só abate a dívida: não vira lançamento', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED });
    expect(gravado).not.toHaveProperty('categoryId');
    expect(gravado).not.toHaveProperty('type');
  });

  it('mesma clientKey devolve o acerto que já existe, sem mexer no saldo de novo', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED, clientKey: 'k1' });
    expect(saldo).toBe(1300);

    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED, clientKey: 'k1' });
    expect(saldo).toBe(1300);
    expect(prisma.settlement.create).toHaveBeenCalledTimes(1);
  });
});

// Mesmo motivo do modulo todo: ver o comentario de PRAZO em
// shared-expenses.service.ts.
describe('SettlementsService — o prazo da transacao', () => {
  it('criar e apagar abrem a transacao com prazo folgado', async () => {
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      settlement: {
        create: jest.fn(async ({ data }: any) => ({ id: 's1', ...data, amount: Number(data.amount) })),
        findFirst: jest.fn(async () => ({ id: 's1', bankAccountId: null, direction: 'RECEIVED', amount: 10 })),
        delete: jest.fn(),
      },
      bankAccount: { findFirst: jest.fn(async () => ({ id: 'a' })), update: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn(async () => ({ id: 'p' })) } },
        { provide: TransactionsService, useValue: { criarEm: jest.fn(), apagarEm: jest.fn() } },
      ],
    }).compile();
    const s = mod.get(SettlementsService);

    await s.create({
      userId: 'u1', personId: 'p', direction: SettlementDirection.RECEIVED,
      amount: 10, settledAt: '2026-10-14',
    });
    expect(prisma.$transaction.mock.calls[0][1].timeout).toBeGreaterThan(5000);

    await s.remove('u1', 's1');
    expect(prisma.$transaction.mock.calls[1][1].timeout).toBeGreaterThan(5000);
  });
});

// O buraco que isto fecha: quando a outra pessoa pagava e voce acertava com
// ela, saiam 500 da conta e NENHUMA despesa era reconhecida. O dinheiro
// sumia dos relatorios, e a sua metade do gasto -- que e consumo seu -- nao
// aparecia em "para onde foi o dinheiro".
describe('SettlementsService — o acerto que vira lançamento', () => {
  let service: SettlementsService;
  let prisma: any;
  let transactions: any;
  let saldo: number;
  let gravado: any;

  const BASE = {
    userId: 'u1', personId: 'rafael', amount: 500,
    settledAt: '2026-10-16', bankAccountId: 'acc-1', categoryId: 'cat-1',
  };

  beforeEach(async () => {
    saldo = 1000;
    gravado = null;
    transactions = {
      criarEm: jest.fn(async (_tx: any, i: any) => {
        // O lançamento é quem mexe no saldo, como no serviço de verdade.
        if (i.isConfirmed !== false) saldo += i.type === 'INCOME' ? i.amount : -i.amount;
        return { id: 'tx-1', ...i };
      }),
      apagarEm: jest.fn(async () => ({ success: true })),
    };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      settlement: {
        create: jest.fn(async ({ data }: any) => { gravado = data; return { id: 's1', ...data, amount: Number(data.amount) }; }),
        findFirst: jest.fn(async () => (gravado ? { id: 's1', ...gravado, amount: Number(gravado.amount) } : null)),
        update: jest.fn(),
        delete: jest.fn(),
      },
      bankAccount: {
        findFirst: jest.fn(async () => ({ id: 'acc-1' })),
        update: jest.fn(async ({ data }: any) => {
          saldo += data.currentBalance.increment ?? -data.currentBalance.decrement;
        }),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn(async () => ({ id: 'rafael' })) } },
        { provide: TransactionsService, useValue: transactions },
      ],
    }).compile();
    service = mod.get(SettlementsService);
  });

  it('pagar a alguém vira DESPESA: o consumo foi seu', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID });

    expect(transactions.criarEm).toHaveBeenCalledTimes(1);
    const lanc = transactions.criarEm.mock.calls[0][1];
    expect(lanc.type).toBe('EXPENSE');
    expect(lanc.isRefund).toBe(false);
    expect(lanc.categoryId).toBe('cat-1');
    expect(saldo).toBe(500);
  });

  it('receber de volta vira REEMBOLSO, não receita', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.RECEIVED });

    const lanc = transactions.criarEm.mock.calls[0][1];
    // O dinheiro entrou, então o saldo sobe — mas o relatório vai ler isto
    // como despesa negativa, abatendo o gasto original.
    expect(lanc.type).toBe('INCOME');
    expect(lanc.isRefund).toBe(true);
    expect(saldo).toBe(1500);
  });

  // O risco desta mudança: o acerto mexia no saldo por conta própria. Se
  // continuasse mexendo com o lançamento junto, o dinheiro andaria duas vezes.
  it('com lançamento, o acerto NÃO mexe no saldo por fora', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID });
    expect(prisma.bankAccount.update).not.toHaveBeenCalled();
    expect(saldo).toBe(500); // só o lançamento mexeu
  });

  it('sem categoria, nada de lançamento: volta a ser só abate de dívida', async () => {
    await service.create({ ...BASE, categoryId: undefined, direction: SettlementDirection.PAID });
    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(prisma.bankAccount.update).toHaveBeenCalled();
    expect(saldo).toBe(500);
  });

  // Dinheiro vivo não passa por conta nenhuma, e lançamento sem destino não
  // existe neste app.
  it('sem conta, nada de lançamento, mesmo com categoria', async () => {
    await service.create({ ...BASE, bankAccountId: undefined, direction: SettlementDirection.PAID });
    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(saldo).toBe(1000); // dinheiro vivo não mexe em saldo do app
  });

  it('pode nascer previsto e não mexer no saldo ainda', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID, isConfirmed: false });
    expect(transactions.criarEm.mock.calls[0][1].isConfirmed).toBe(false);
    expect(saldo).toBe(1000);
  });

  it('apagar o acerto apaga o lançamento, que sabe desfazer o próprio efeito', async () => {
    await service.create({ ...BASE, direction: SettlementDirection.PAID });
    await service.remove('u1', 's1');

    expect(transactions.apagarEm).toHaveBeenCalledWith(prisma, 'tx-1', 'u1');
    // E não desfaz pelo caminho antigo: isso tiraria o dinheiro duas vezes.
    expect(prisma.bankAccount.update).not.toHaveBeenCalled();
  });
});

// Editar um acerto pode mudar SE ele tem lancamento, e quem mexe no saldo
// depende disso. Sao quatro caminhos; misturar dois deles -- mexer direto E
// pelo lancamento -- faria o dinheiro andar duas vezes.
describe('SettlementsService — editar', () => {
  let service: SettlementsService;
  let prisma: any;
  let transactions: any;
  let saldo: number;
  let linha: any;

  function montarPrisma() {
    return {
      $transaction: jest.fn((cb: any) => cb(prisma)),
      settlement: {
        findFirst: jest.fn(async () => ({ ...linha })),
        update: jest.fn(async ({ data }: any) => { linha = { ...linha, ...data }; return { ...linha }; }),
        create: jest.fn(),
        delete: jest.fn(),
      },
      transaction: { findUnique: jest.fn(async () => ({ categoryId: 'cat-1' })) },
      bankAccount: {
        findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })),
        update: jest.fn(async ({ data }: any) => {
          saldo += data.currentBalance.increment !== undefined
            ? Number(data.currentBalance.increment)
            : -Number(data.currentBalance.decrement);
        }),
      },
    };
  }

  async function montar(inicial: any) {
    saldo = 1000;
    linha = { id: 's1', userId: 'u1', personId: 'p1', ...inicial };
    prisma = montarPrisma();
    transactions = {
      criarEm: jest.fn(async (_tx: any, i: any) => {
        if (i.isConfirmed !== false) saldo += i.type === 'INCOME' ? i.amount : -i.amount;
        return { id: 'tx-novo', ...i };
      }),
      atualizarEm: jest.fn(async () => ({ id: 'tx-1' })),
      apagarEm: jest.fn(async () => ({ success: true })),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn(async () => ({ id: 'p1' })) } },
        { provide: TransactionsService, useValue: transactions },
      ],
    }).compile();
    service = mod.get(SettlementsService);
  }

  const COM_LANCAMENTO = {
    direction: SettlementDirection.PAID, amount: 500,
    settledAt: new Date('2026-10-16'), bankAccountId: 'acc-1',
    description: null, transactionId: 'tx-1',
  };
  const SEM_LANCAMENTO = { ...COM_LANCAMENTO, transactionId: null };

  it('tinha lançamento e continua: quem se atualiza é o lançamento', async () => {
    await montar(COM_LANCAMENTO);
    await service.update('u1', 's1', { amount: 700 });

    expect(transactions.atualizarEm).toHaveBeenCalledTimes(1);
    expect(transactions.atualizarEm.mock.calls[0][2].amount).toBe(700);
    // O acerto NAO mexe no saldo: isso andaria o dinheiro duas vezes.
    expect(prisma.bankAccount.update).not.toHaveBeenCalled();
  });

  it('só a data muda, e o lançamento continua existindo', async () => {
    await montar(COM_LANCAMENTO);
    await service.update('u1', 's1', { settledAt: '2026-10-20' });

    // A categoria veio do proprio lancamento: quem so corrige a data nao
    // pode perder o lancamento por omissao.
    expect(transactions.atualizarEm).toHaveBeenCalledTimes(1);
    expect(transactions.atualizarEm.mock.calls[0][2].categoryId).toBe('cat-1');
    expect(linha.transactionId).toBe('tx-1');
  });

  it('tirar a categoria apaga o lançamento, e o acerto volta a mexer direto', async () => {
    await montar(COM_LANCAMENTO);
    await service.update('u1', 's1', { categoryId: null });

    expect(transactions.apagarEm).toHaveBeenCalledTimes(1);
    expect(linha.transactionId).toBeNull();
    // Agora quem move o saldo é o acerto.
    expect(saldo).toBe(500);
  });

  it('tirar a conta também tira o lançamento: dinheiro vivo não tem destino', async () => {
    await montar(COM_LANCAMENTO);
    await service.update('u1', 's1', { bankAccountId: null });

    expect(transactions.apagarEm).toHaveBeenCalledTimes(1);
    expect(linha.bankAccountId).toBeNull();
    expect(saldo).toBe(1000); // sem conta, nenhum saldo do app muda
  });

  it('ganhar categoria cria o lançamento, desfazendo o movimento direto', async () => {
    await montar(SEM_LANCAMENTO);
    await service.update('u1', 's1', { categoryId: 'cat-2' });

    expect(transactions.criarEm).toHaveBeenCalledTimes(1);
    expect(linha.transactionId).toBe('tx-novo');
    // O saldo fica IGUAL, e e esse o ponto: os mesmos 500 passam a ser
    // movidos pelo lancamento em vez de pelo acerto. O movimento antigo e
    // desfeito (+500) e o novo aplicado (−500). Se ele tivesse caido para
    // 500, o dinheiro teria saido duas vezes.
    expect(saldo).toBe(1000);
    expect(prisma.bankAccount.update).toHaveBeenCalledTimes(1); // só o desfazer
  });

  it('sem lançamento dos dois lados: desfaz o antigo e aplica o novo', async () => {
    await montar(SEM_LANCAMENTO);
    await service.update('u1', 's1', { amount: 200 });

    expect(transactions.criarEm).not.toHaveBeenCalled();
    expect(transactions.atualizarEm).not.toHaveBeenCalled();
    // +500 de volta, −200 do novo.
    expect(saldo).toBe(1300);
  });

  it('inverter o sentido inverte o lançamento junto', async () => {
    await montar(COM_LANCAMENTO);
    await service.update('u1', 's1', { direction: SettlementDirection.RECEIVED });

    const dados = transactions.atualizarEm.mock.calls[0][2];
    expect(dados.type).toBe('INCOME');
    // Receber de volta e reembolso, nao renda.
    expect(dados.isRefund).toBe(true);
  });

  it('recusa valor zero sem ter mexido em nada', async () => {
    await montar(COM_LANCAMENTO);
    await expect(service.update('u1', 's1', { amount: 0 })).rejects.toThrow(/maior que zero/);
    expect(transactions.atualizarEm).not.toHaveBeenCalled();
    expect(saldo).toBe(1000);
  });

  it('acerto de outro dono não existe para mim', async () => {
    await montar(COM_LANCAMENTO);
    prisma.settlement.findFirst.mockResolvedValue(null);
    await expect(service.update('u1', 'de-outro', { amount: 10 })).rejects.toThrow(NotFoundException);
  });
});
