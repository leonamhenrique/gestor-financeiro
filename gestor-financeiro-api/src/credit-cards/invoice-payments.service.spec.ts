// ============================================================
// invoice-payments.service.spec.ts
// ============================================================
// Banco em memória com a forma das tabelas: o que precisa ser provado é o
// ACÚMULO (saldo da conta, pago da fatura, rotativo) através de várias
// operações, não só que um método foi chamado.
// Hoje fixo: 13/09/2026 (fatura de setembro fecha dia 10, vence dia 17).
// ============================================================

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InvoicePaymentsService } from './invoice-payments.service';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');

function bancoEmMemoria() {
  const db: any = {
    cartoes: [{ id: 'card-1', userId: 'u1', closingDay: 10, dueDay: 17 }],
    contas: [
      { id: 'acc-1', userId: 'u1', isActive: true, currentBalance: 5000 },
      { id: 'acc-2', userId: 'u1', isActive: true, currentBalance: 1000 },
      { id: 'acc-arq', userId: 'u1', isActive: false, currentBalance: 0 },
      { id: 'acc-outro', userId: 'u2', isActive: true, currentBalance: 0 },
    ],
    faturas: [] as any[],
    pagamentos: [] as any[],
    travas: [] as string[],
  };
  const comPagamentos = (f: any) => ({ ...f, payments: db.pagamentos.filter((p: any) => p.invoiceId === f.id) });

  const prisma: any = {
    creditCard: {
      findFirst: async ({ where }: any) => db.cartoes.find((c: any) => c.id === where.id && c.userId === where.userId) ?? null,
    },
    bankAccount: {
      findFirst: async ({ where }: any) => db.contas.find((c: any) => c.id === where.id && c.userId === where.userId) ?? null,
      update: async ({ where, data }: any) => {
        const c = db.contas.find((x: any) => x.id === where.id);
        const m = data.currentBalance;
        c.currentBalance = Math.round((c.currentBalance + (m.increment ?? 0) - (m.decrement ?? 0)) * 100) / 100;
        return c;
      },
    },
    creditCardInvoice: {
      findMany: async ({ where }: any) =>
        db.faturas.filter((f: any) => f.creditCardId === where.creditCardId).map(comPagamentos),
      create: async ({ data }: any) => {
        const f = { id: randomUUID(), paidAt: null, ...data };
        db.faturas.push(f);
        return f;
      },
      update: async ({ where, data }: any) => Object.assign(db.faturas.find((f: any) => f.id === where.id), data),
    },
    invoicePayment: {
      create: async ({ data }: any) => {
        const p = { id: randomUUID(), ...data };
        db.pagamentos.push(p);
        return p;
      },
      findFirst: async ({ where }: any) => {
        const p = db.pagamentos.find((x: any) => x.id === where.id);
        const f = p && db.faturas.find((x: any) => x.id === p.invoiceId);
        return p && f && f.creditCardId === where.invoice.creditCardId ? { ...p, invoice: f } : null;
      },
      update: async ({ where, data }: any) => Object.assign(db.pagamentos.find((p: any) => p.id === where.id), data),
      delete: async ({ where }: any) => {
        db.pagamentos = db.pagamentos.filter((p: any) => p.id !== where.id);
      },
    },
    $queryRaw: async (partes: TemplateStringsArray, ...valores: any[]) => {
      db.travas.push(String(partes.join('?')) + ' ' + valores.join(','));
      return [];
    },
    $transaction: async (cb: any) => cb(prisma),
  };
  return { db, prisma };
}

function fatura(db: any, mes: string, total: number) {
  const f = {
    id: 'inv-' + mes,
    creditCardId: 'card-1',
    referenceMonth: d(mes + '-01'),
    closingDate: d(mes + '-10'),
    dueDate: d(mes + '-17'),
    totalAmount: total,
    status: 'OPEN',
    paidAt: null,
  };
  db.faturas.push(f);
  return f;
}

describe('InvoicePaymentsService', () => {
  let db: any;
  let service: InvoicePaymentsService;
  const saldo = (id = 'acc-1') => db.contas.find((c: any) => c.id === id).currentBalance;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-09-13T15:00:00Z')); // meio-dia em São Paulo
    const b = bancoEmMemoria();
    db = b.db;
    service = new InvoicePaymentsService(b.prisma);
    fatura(db, '2026-09', 845.3);
  });
  afterEach(() => jest.useRealTimers());

  const pagar = (valor: number, conta = 'acc-1', mes = '2026-09') =>
    service.pagar('u1', 'card-1', mes, { bankAccountId: conta, amount: valor });

  describe('pagar', () => {
    it('debita a conta e registra o pagamento na fatura', async () => {
      const p = await pagar(300);
      expect(saldo()).toBe(4700);
      expect(p).toMatchObject({ amount: 300, bankAccountId: 'acc-1', paidAt: '2026-09-13' });
    });

    it('aceita vários pagamentos na mesma fatura até quitar', async () => {
      await pagar(300);
      await pagar(200);
      await pagar(345.3);
      expect(saldo()).toBe(4154.7);
      const set = (await service.extrato('u1', 'card-1')).find((f) => f.referenceMonth === '2026-09')!;
      expect(set).toMatchObject({ status: 'PAID', paid: 845.3, payable: 0 });
      // O status gravado acompanha (para consultas em massa).
      expect(db.faturas[0].status).toBe('PAID');
      expect(db.faturas[0].paidAt).not.toBeNull();
    });

    it('recusa pagar mais do que está em aberto — e não mexe na conta', async () => {
      await pagar(800);
      await expect(pagar(45.31)).rejects.toThrow(/passa do que está em aberto/);
      expect(saldo()).toBe(4200);
    });

    it('recusa pagar fatura já quitada', async () => {
      await pagar(845.3);
      await expect(pagar(1)).rejects.toThrow(/não tem valor em aberto/);
    });

    it('recusa conta arquivada, conta de outro usuário e cartão de outro usuário', async () => {
      await expect(pagar(10, 'acc-arq')).rejects.toBeInstanceOf(BadRequestException);
      await expect(pagar(10, 'acc-outro')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.pagar('u2', 'card-1', '2026-09', { bankAccountId: 'acc-1', amount: 10 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(saldo()).toBe(5000);
    });

    it('trava o cartão antes de conferir o valor (dois pagamentos simultâneos não passam juntos)', async () => {
      await pagar(10);
      expect(db.travas.some((t: string) => /FOR UPDATE/.test(t) && t.includes('card-1'))).toBe(true);
    });

    it('recusa mês em formato errado', async () => {
      await expect(pagar(10, 'acc-1', '09-2026')).rejects.toThrow(/AAAA-MM/);
    });
  });

  describe('rotativo', () => {
    beforeEach(async () => {
      await pagar(400); // parcial antes do vencimento
      jest.setSystemTime(new Date('2026-09-18T15:00:00Z')); // venceu dia 17
    });

    it('depois do vencimento a fatura parcial não aceita pagamento: aponta para a seguinte', async () => {
      await expect(pagar(100)).rejects.toThrow(/transportado para a fatura de 2026-10/);
    });

    it('pagar a fatura que só existe pelo transporte cria a linha dela no banco', async () => {
      await pagar(445.3, 'acc-1', '2026-10');
      const out = db.faturas.find((f: any) => f.referenceMonth.toISOString().startsWith('2026-10'));
      expect(out).toBeDefined();
      const ext = await service.extrato('u1', 'card-1');
      expect(ext.find((f) => f.referenceMonth === '2026-09')!.status).toBe('CARRIED');
      expect(ext.find((f) => f.referenceMonth === '2026-10')).toMatchObject({ carriedIn: 445.3, status: 'PAID' });
    });

    it('desfazer o pagamento parcial desfaz o rotativo: a dívida volta inteira para setembro', async () => {
      const id = db.pagamentos[0].id;
      await service.desfazer('u1', 'card-1', id);
      expect(saldo()).toBe(5000);
      const ext = await service.extrato('u1', 'card-1');
      expect(ext.find((f) => f.referenceMonth === '2026-09')).toMatchObject({ status: 'OVERDUE', payable: 845.3 });
      expect(ext.find((f) => f.referenceMonth === '2026-10')).toBeUndefined();
    });

    // Regressão achada no teste com a API: desfazer o parcial DEPOIS de pagar o
    // transporte na fatura seguinte fazia outubro ficar com 445,30 pagos sem
    // dever nada e setembro voltar a cobrar tudo — pagamento em dobro.
    it('não deixa desfazer o parcial se o transporte já foi pago na fatura seguinte', async () => {
      await pagar(445.3, 'acc-1', '2026-10');
      const parcial = db.pagamentos[0].id;
      await expect(service.desfazer('u1', 'card-1', parcial)).rejects.toThrow(/Desfaça primeiro o pagamento de 2026-10/);
      // Aumentar o parcial encolhe o transporte que outubro já pagou: também não.
      await expect(service.editar('u1', 'card-1', parcial, { amount: 845.3 })).rejects.toThrow(/2026-10/);
      expect(saldo()).toBe(5000 - 400 - 445.3); // nada mudou
    });

    it('reduzir o parcial é permitido mesmo com outubro pago: o transporte cresce e outubro passa a dever a diferença', async () => {
      await pagar(445.3, 'acc-1', '2026-10');
      await service.editar('u1', 'card-1', db.pagamentos[0].id, { amount: 300 });
      const out = (await service.extrato('u1', 'card-1')).find((f) => f.referenceMonth === '2026-10')!;
      expect(out).toMatchObject({ carriedIn: 545.3, paid: 445.3, payable: 100 });
    });

    it('na ordem certa funciona: desfaz outubro, depois setembro', async () => {
      const outubro = await pagar(445.3, 'acc-1', '2026-10');
      await service.desfazer('u1', 'card-1', outubro.id);
      await service.desfazer('u1', 'card-1', db.pagamentos[0].id);
      expect(saldo()).toBe(5000);
    });

    it('aumentar o parcial continua permitido (reduz o transporte, sem excesso se outubro não pagou)', async () => {
      await expect(service.editar('u1', 'card-1', db.pagamentos[0].id, { amount: 845.3 })).resolves.toBeDefined();
    });

    it('corrigir o valor de um pagamento de fatura já transportada é permitido e recalcula o transporte', async () => {
      const id = db.pagamentos[0].id;
      await service.editar('u1', 'card-1', id, { amount: 500 });
      expect(saldo()).toBe(4500);
      const ext = await service.extrato('u1', 'card-1');
      expect(ext.find((f) => f.referenceMonth === '2026-10')).toMatchObject({ carriedIn: 345.3 });
    });
  });

  describe('datas gravadas erradas', () => {
    it('ao consolidar, corrige o vencimento gravado pelo código antigo (fecha 28, vence 5)', async () => {
      db.cartoes.push({ id: 'card-28', userId: 'u1', closingDay: 28, dueDay: 5 });
      db.faturas.push({
        id: 'inv-28',
        creditCardId: 'card-28',
        referenceMonth: d('2026-09-01'),
        closingDate: d('2026-09-28'),
        dueDate: d('2026-09-05'), // mês errado
        totalAmount: 500,
        status: 'OVERDUE',
        paidAt: null,
      });
      await service.pagar('u1', 'card-28', '2026-09', { bankAccountId: 'acc-1', amount: 100 });
      const f = db.faturas.find((x: any) => x.id === 'inv-28');
      expect(f.dueDate.toISOString().slice(0, 10)).toBe('2026-10-05');
      // Hoje é 13/09: a fatura nem fechou ainda — o OVERDUE gravado estava errado.
      expect(f.status).toBe('OPEN');
    });
  });

  describe('editar e desfazer', () => {
    it('editar o valor ajusta só a diferença na conta', async () => {
      const p = await pagar(300);
      await service.editar('u1', 'card-1', p.id, { amount: 350 });
      expect(saldo()).toBe(4650);
    });

    it('trocar a conta devolve à antiga e cobra da nova', async () => {
      const p = await pagar(300);
      await service.editar('u1', 'card-1', p.id, { bankAccountId: 'acc-2' });
      expect(saldo('acc-1')).toBe(5000);
      expect(saldo('acc-2')).toBe(700);
    });

    it('na edição o teto é o devido menos os OUTROS pagamentos', async () => {
      await pagar(500);
      const p = await pagar(300);
      await expect(service.editar('u1', 'card-1', p.id, { amount: 345.31 })).rejects.toThrow(/passa do que está em aberto/);
      await expect(service.editar('u1', 'card-1', p.id, { amount: 345.3 })).resolves.toMatchObject({ amount: 345.3 });
    });

    it('desfazer devolve o dinheiro e reabre a fatura', async () => {
      const p = await pagar(845.3);
      await service.desfazer('u1', 'card-1', p.id);
      expect(saldo()).toBe(5000);
      expect(db.faturas[0].status).toBe('CLOSED');
      expect(db.faturas[0].paidAt).toBeNull();
    });

    it('pagamento de outro cartão não é encontrado', async () => {
      const p = await pagar(100);
      db.cartoes.push({ id: 'card-2', userId: 'u1', closingDay: 5, dueDay: 12 });
      await expect(service.desfazer('u1', 'card-2', p.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(saldo()).toBe(4900);
    });
  });
});
