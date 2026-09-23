// ============================================================
// credit-cards.service.spec.ts
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditCardsService } from './credit-cards.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CreditCardsService', () => {
  let service: CreditCardsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((callback) => callback(prismaMock)),
      creditCard: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      creditCardInvoice: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
      transaction: { count: jest.fn() },
      invoicePayment: { count: jest.fn().mockResolvedValue(0) },
      bankAccount: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditCardsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<CreditCardsService>(CreditCardsService);
  });

  it('create() gera automaticamente a fatura do ciclo atual com total zero', async () => {
    prismaMock.creditCard.create.mockResolvedValue({ id: 'card-1' });

    await service.create({
      userId: 'user-1',
      name: 'Nubank Roxinho',
      limitAmount: 2000,
      closingDay: 10,
      dueDay: 17,
    });

    expect(prismaMock.creditCardInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creditCardId: 'card-1',
        totalAmount: 0,
        status: 'OPEN',
      }),
    });
  });

  it('create() valida que a conta bancária vinculada pertence ao usuário', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        userId: 'user-1',
        name: 'Itaú Click',
        limitAmount: 1000,
        closingDay: 5,
        dueDay: 12,
        bankAccountId: 'conta-de-outro-usuario',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.creditCard.create).not.toHaveBeenCalled();
  });

  // Faturas como o Prisma devolve (@db.Date = meia-noite UTC), com pagamentos.
  const fatura = (mes: string, total: number, pagos: number[] = []) => ({
    id: 'inv-' + mes,
    referenceMonth: new Date(mes + '-01T00:00:00Z'),
    closingDate: new Date(mes + '-10T00:00:00Z'),
    dueDate: new Date(mes + '-17T00:00:00Z'),
    totalAmount: total,
    payments: pagos.map((v, i) => ({ id: 'p' + i, amount: v, paidAt: new Date(mes + '-12T00:00:00Z'), bankAccountId: 'acc-1' })),
  });

  beforeEach(() => {
    prismaMock.creditCard.findUnique.mockResolvedValue({ id: 'card-1', closingDay: 10, dueDay: 17 });
  });

  it('getAvailableLimit() desconta o que está em aberto em TODAS as faturas, não só a atual', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([fatura('2020-01', 300), fatura('2020-02', 500)]);
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(1200);
  });

  it('getAvailableLimit() libera o que já foi pago, inclusive em parte', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([fatura('2020-01', 800, [500])]);
    // Janeiro/2020 já venceu, pagou 500 de 800: os 300 foram para fevereiro —
    // e contam uma vez só.
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(1700);
  });

  it('getAvailableLimit() retorna o limite cheio quando não há faturas', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([]);
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(2000);
  });

  it('delete() vira soft-delete quando há pagamento registrado, mesmo sem compras', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCardInvoice.count.mockResolvedValue(0);
    prismaMock.invoicePayment.count.mockResolvedValue(1);

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCard.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: false, archived: true });
  });

  it('updateBillingCycle() permite alterar quando só existe a fatura inicial (cartão sem uso)', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.creditCardInvoice.count.mockResolvedValue(1); // só a fatura criada no cadastro
    prismaMock.creditCard.update.mockResolvedValue({ id: 'card-1', closingDay: 15, dueDay: 22 });

    await service.updateBillingCycle('user-1', 'card-1', 15, 22);

    expect(prismaMock.creditCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { closingDay: 15, dueDay: 22 },
    });
  });

  it('updateBillingCycle() bloqueia alteração quando já há mais de uma fatura gerada', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.creditCardInvoice.count.mockResolvedValue(3);

    await expect(service.updateBillingCycle('user-1', 'card-1', 15, 22)).rejects.toThrow(
      BadRequestException,
    );
    expect(prismaMock.creditCard.update).not.toHaveBeenCalled();
  });

  it('delete() remove de fato (cartão + fatura vazia) quando não há uso real', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCardInvoice.count.mockResolvedValue(0); // nenhuma fatura com total > 0

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCardInvoice.deleteMany).toHaveBeenCalledWith({
      where: { creditCardId: 'card-1' },
    });
    expect(prismaMock.creditCard.delete).toHaveBeenCalledWith({ where: { id: 'card-1' } });
    expect(result).toEqual({ deleted: true, archived: false });
  });

  it('delete() vira soft-delete quando há transações lançadas no cartão', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(7);
    prismaMock.creditCardInvoice.count.mockResolvedValue(1);

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCard.delete).not.toHaveBeenCalled();
    expect(prismaMock.creditCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { isActive: false },
    });
    expect(result).toEqual({ deleted: false, archived: true });
  });
});
