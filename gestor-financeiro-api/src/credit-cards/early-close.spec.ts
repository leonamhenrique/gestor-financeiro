// ============================================================
// early-close.spec.ts
// ============================================================
// Virar a fatura: quando dá, quando não dá, e o que acontece com o que já foi
// lançado. Banco em memória com a forma das tabelas, como no spec de
// pagamentos — o que precisa ser provado aqui são as TRAVAS, e elas dependem
// do estado inteiro do cartão (qual fatura está aberta, se tem pagamento).
//
// Cartão que fecha dia 1 e vence dia 10 — o do caso que trouxe isso. A fatura
// 12/2026 junta as compras de 02/11 a 01/12 e vence em 10/12.
// ============================================================

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreditCardInvoicesService } from './credit-card-invoices.service';

const d = (s: string) => new Date(s + 'T00:00:00.000Z');

function bancoEmMemoria() {
  const db: any = {
    cartoes: [{ id: 'card-1', userId: 'u1', closingDay: 1, dueDay: 10 }],
    faturas: [] as any[],
    pagamentos: [] as any[],
  };
  const comPagamentos = (f: any) => ({ ...f, payments: db.pagamentos.filter((p: any) => p.invoiceId === f.id) });

  const prisma: any = {
    creditCard: {
      findFirst: async ({ where }: any) =>
        db.cartoes.find((c: any) => c.id === where.id && c.userId === where.userId) ?? null,
    },
    creditCardInvoice: {
      findMany: async ({ where }: any) =>
        db.faturas
          .filter((f: any) => f.creditCardId === where.creditCardId)
          .sort((a: any, b: any) => a.referenceMonth - b.referenceMonth)
          .map(comPagamentos),
      upsert: async ({ where, create, update }: any) => {
        const ref = where.creditCardId_referenceMonth.referenceMonth.getTime();
        const atual = db.faturas.find(
          (f: any) =>
            f.creditCardId === where.creditCardId_referenceMonth.creditCardId &&
            f.referenceMonth.getTime() === ref,
        );
        if (atual) return Object.assign(atual, update);
        const nova = { id: randomUUID(), paidAt: null, earlyClosedAt: null, ...create };
        db.faturas.push(nova);
        return nova;
      },
      update: async ({ where, data }: any) => Object.assign(db.faturas.find((f: any) => f.id === where.id), data),
    },
  };
  return { db, prisma };
}

/** Uma fatura já gravada, com o total e, se for o caso, a virada. */
function gravar(db: any, mes: string, total = 0, extra: any = {}) {
  const f = {
    id: 'inv-' + mes,
    creditCardId: 'card-1',
    referenceMonth: d(mes + '-01'),
    closingDate: d(mes + '-01'),
    dueDate: d(mes + '-10'),
    totalAmount: total,
    status: 'OPEN',
    paidAt: null,
    earlyClosedAt: null,
    ...extra,
  };
  db.faturas.push(f);
  return f;
}

describe('virar fatura', () => {
  let db: any;
  let service: CreditCardInvoicesService;

  beforeEach(() => {
    const m = bancoEmMemoria();
    db = m.db;
    service = new CreditCardInvoicesService(m.prisma);
    // 23/11/2026: oito dias antes de a fatura 12/2026 fechar, que é quando o
    // botão do banco aparece.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // Meio-dia UTC: "hoje" é o dia do calendário NO FUSO DO APP, e meia-noite
    // UTC no Brasil ainda é o dia anterior (21h). Com a hora cheia o dia é o
    // mesmo nos dois, e o teste não depende de onde roda.
    jest.setSystemTime(new Date('2026-11-23T12:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('grava o dia da virada e fecha a fatura', async () => {
    gravar(db, '2026-12', 182.94);
    const f = await service.virar('u1', 'card-1', '2026-12');
    expect(f).toMatchObject({ referenceMonth: '2026-12', status: 'CLOSED', earlyClosedAt: '2026-11-23' });
    // E as datas do calendário continuam as mesmas.
    expect(f).toMatchObject({ closingDate: '2026-12-01', dueDate: '2026-12-10' });
  });

  it('vira um mês sem compra nenhuma, criando a linha da fatura', async () => {
    const f = await service.virar('u1', 'card-1', '2026-12');
    expect(f).toMatchObject({ earlyClosedAt: '2026-11-23', purchases: 0 });
    expect(db.faturas).toHaveLength(1);
  });

  it('fatura FUTURA não se vira — não é ela que recebe a compra de hoje', async () => {
    gravar(db, '2026-12', 100);
    await expect(service.virar('u1', 'card-1', '2027-01')).rejects.toThrow(BadRequestException);
    await expect(service.virar('u1', 'card-1', '2027-01')).rejects.toThrow('(2026-12)');
  });

  it('fatura que já fechou no calendário não se vira', async () => {
    gravar(db, '2026-11', 100);
    await expect(service.virar('u1', 'card-1', '2026-11')).rejects.toThrow('aberta agora');
  });

  it('virar DUAS vezes no mesmo mês: a segunda pega a fatura seguinte', async () => {
    gravar(db, '2026-12', 100);
    await service.virar('u1', 'card-1', '2026-12');
    // Virada a de dezembro, a compra de hoje cai na de janeiro — e é ela que
    // passa a ser virável.
    await expect(service.virar('u1', 'card-1', '2026-12')).rejects.toThrow('(2027-01)');
    const segunda = await service.virar('u1', 'card-1', '2027-01');
    expect(segunda).toMatchObject({ earlyClosedAt: '2026-11-23' });
  });

  it('cartão de outro usuário não existe', async () => {
    await expect(service.virar('u2', 'card-1', '2026-12')).rejects.toThrow(NotFoundException);
  });
});

describe('desfazer a virada', () => {
  let db: any;
  let service: CreditCardInvoicesService;

  beforeEach(() => {
    const m = bancoEmMemoria();
    db = m.db;
    service = new CreditCardInvoicesService(m.prisma);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // Meio-dia UTC: "hoje" é o dia do calendário NO FUSO DO APP, e meia-noite
    // UTC no Brasil ainda é o dia anterior (21h). Com a hora cheia o dia é o
    // mesmo nos dois, e o teste não depende de onde roda.
    jest.setSystemTime(new Date('2026-11-23T12:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('volta a fatura para aberta', async () => {
    gravar(db, '2026-12', 100, { earlyClosedAt: d('2026-11-23'), status: 'CLOSED' });
    const f = await service.desfazerVirada('u1', 'card-1', '2026-12');
    expect(f).toMatchObject({ status: 'OPEN', earlyClosedAt: null });
  });

  it('fatura que não foi virada não tem o que desfazer', async () => {
    gravar(db, '2026-12', 100);
    await expect(service.desfazerVirada('u1', 'card-1', '2026-12')).rejects.toThrow(NotFoundException);
  });

  it('com pagamento registrado, a virada não volta atrás', async () => {
    const f = gravar(db, '2026-12', 100, { earlyClosedAt: d('2026-11-23'), status: 'CLOSED' });
    db.pagamentos.push({ id: 'pg-1', invoiceId: f.id, amount: 50, paidAt: d('2026-11-24'), bankAccountId: 'acc-1' });
    await expect(service.desfazerVirada('u1', 'card-1', '2026-12')).rejects.toThrow('pagamento registrado');
  });

  it('só a virada MAIS RECENTE se desfaz', async () => {
    gravar(db, '2026-12', 100, { earlyClosedAt: d('2026-11-23'), status: 'CLOSED' });
    gravar(db, '2027-01', 50, { earlyClosedAt: d('2026-11-25'), status: 'CLOSED' });
    await expect(service.desfazerVirada('u1', 'card-1', '2026-12')).rejects.toThrow('(2027-01)');
    await service.desfazerVirada('u1', 'card-1', '2027-01');
    // Desfeita a de janeiro, a de dezembro volta a ser a mais recente.
    await service.desfazerVirada('u1', 'card-1', '2026-12');
    expect(db.faturas.every((f: any) => f.earlyClosedAt === null)).toBe(true);
  });
});
