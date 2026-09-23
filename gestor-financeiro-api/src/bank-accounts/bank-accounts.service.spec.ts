// ============================================================
// bank-accounts.service.spec.ts
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType } from '@prisma/client';

describe('BankAccountsService', () => {
  let service: BankAccountsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      bankAccount: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
      transaction: { count: jest.fn() },
      creditCard: { count: jest.fn() },
      invoicePayment: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BankAccountsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<BankAccountsService>(BankAccountsService);
  });

  it('create() usa initialBalance como currentBalance inicial', async () => {
    prismaMock.bankAccount.create.mockResolvedValue({ id: 'acc-1' });

    await service.create({
      userId: 'user-1',
      institutionName: 'Nubank',
      accountType: AccountType.CHECKING,
      initialBalance: 500,
    });

    expect(prismaMock.bankAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ initialBalance: 500, currentBalance: 500 }),
    });
  });

  it('create() assume zero quando initialBalance não é informado', async () => {
    prismaMock.bankAccount.create.mockResolvedValue({ id: 'acc-1' });

    await service.create({
      userId: 'user-1',
      institutionName: 'Itaú',
      accountType: AccountType.CHECKING,
    });

    expect(prismaMock.bankAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ initialBalance: 0, currentBalance: 0 }),
    });
  });

  it('updateInitialBalance() permite alterar quando não há transações', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.bankAccount.update.mockResolvedValue({ id: 'acc-1', initialBalance: 300 });

    await service.updateInitialBalance('user-1', 'acc-1', 300);

    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { initialBalance: 300, currentBalance: 300 },
    });
  });

  it('updateInitialBalance() bloqueia alteração quando já existem transações', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(5);

    await expect(service.updateInitialBalance('user-1', 'acc-1', 300)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
  });

  it('findOneByUser() lança NotFoundException se a conta não existe ou não é do usuário', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue(null);

    await expect(service.findOneByUser('user-1', 'acc-inexistente')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('delete() remove de fato quando não há transações nem cartões vinculados', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCard.count.mockResolvedValue(0);

    const result = await service.delete('user-1', 'acc-1');

    expect(prismaMock.bankAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
    expect(result).toEqual({ deleted: true, archived: false });
  });

  it('delete() vira soft-delete quando há transações vinculadas', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(10);
    prismaMock.creditCard.count.mockResolvedValue(0);

    const result = await service.delete('user-1', 'acc-1');

    expect(prismaMock.bankAccount.delete).not.toHaveBeenCalled();
    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { isActive: false },
    });
    expect(result).toEqual({ deleted: false, archived: true });
  });

  it('delete() vira soft-delete quando há cartão de crédito vinculado, mesmo sem transações', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: 'acc-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCard.count.mockResolvedValue(1);

    const result = await service.delete('user-1', 'acc-1');

    expect(result).toEqual({ deleted: false, archived: true });
  });

  it('getTotalBalance() retorna 0 quando o usuário não tem contas', async () => {
    prismaMock.bankAccount.aggregate.mockResolvedValue({ _sum: { currentBalance: null } });

    const total = await service.getTotalBalance('user-1');

    expect(total).toBe(0);
  });

  it('getTotalBalance() soma só contas ativas e não ocultas', async () => {
    prismaMock.bankAccount.aggregate.mockResolvedValue({ _sum: { currentBalance: 100 } });
    await service.getTotalBalance('user-1');
    expect(prismaMock.bankAccount.aggregate.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      isActive: true,
      isHidden: false,
    });
  });

  it('getBalanceSummary() separa visível e oculto', async () => {
    prismaMock.bankAccount.groupBy = jest.fn().mockResolvedValue([
      { isHidden: false, _sum: { currentBalance: 4543.35 }, _count: { _all: 2 } },
      { isHidden: true, _sum: { currentBalance: 52500 }, _count: { _all: 1 } },
    ]);
    expect(await service.getBalanceSummary('user-1')).toEqual({ visible: 4543.35, hidden: 52500, hiddenAccounts: 1 });
  });

  it('getBalanceSummary() sem contas ocultas', async () => {
    prismaMock.bankAccount.groupBy = jest.fn().mockResolvedValue([
      { isHidden: false, _sum: { currentBalance: 10 }, _count: { _all: 1 } },
    ]);
    expect(await service.getBalanceSummary('user-1')).toEqual({ visible: 10, hidden: 0, hiddenAccounts: 0 });
  });

  it('create() põe a conta nova no fim da lista', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue({ sortOrder: 3 });
    await service.create({ userId: 'user-1', institutionName: 'Inter', accountType: AccountType.CHECKING });
    expect(prismaMock.bankAccount.create.mock.calls[0][0].data.sortOrder).toBe(4);
  });

  it('reorder() grava a nova ordem e recusa conta de outro usuário', async () => {
    prismaMock.$transaction = jest.fn((cb: any) => cb(prismaMock));
    prismaMock.bankAccount.findMany.mockResolvedValue([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
    ]);
    expect(await service.reorder('user-1', ['b', 'a'])).toEqual({ order: ['b', 'a'] });
    expect(prismaMock.bankAccount.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { sortOrder: 0 } });
    expect(prismaMock.bankAccount.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    await expect(service.reorder('user-1', ['de-outro'])).rejects.toThrow(NotFoundException);
  });
});
