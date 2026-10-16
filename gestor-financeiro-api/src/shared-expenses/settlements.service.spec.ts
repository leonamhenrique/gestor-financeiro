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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: people },
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

  it('não grava categoria: acerto não é gasto e não vai para relatório', async () => {
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
