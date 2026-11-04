// ============================================================
// relatorio.service.spec.ts
// ============================================================
// A ponte entre o banco e a conta do app.
//
// A conta em si está provada em `relatorio.spec.ts`, com dados já no formato
// do app. O que se prova aqui é o pedaço que costuma errar em silêncio: a
// TRADUÇÃO. Uma coluna com outro nome, uma data que chega como objeto em vez
// de texto, um Decimal que vira "[object Object]" — nada disso estoura. O
// número só sai diferente, e ninguém sabe explicar por quê.
//
// Por isso as linhas de mentira são tipadas com os tipos do Prisma: um mock
// solto concorda com a crença errada de quem o escreveu (foi o que aconteceu
// com `institutionName`, e o teste ficou verde enquanto produção não achava
// conta nenhuma).
// ============================================================

import { Prisma } from '@prisma/client';
import type { BankAccount, CreditCard, Transaction, User } from '@prisma/client';
import { RelatorioService, instanteDoUsuario } from './relatorio.service';

const dec = (n: number) => new Prisma.Decimal(n);
/** Coluna @db.Date chega como meia-noite UTC. */
const data = (iso: string) => new Date(iso + 'T00:00:00.000Z');

type ContaLinha = Pick<
  BankAccount,
  'id' | 'institutionName' | 'accountType' | 'currentBalance' | 'initialBalance' | 'isActive' | 'isHidden'
>;
type CartaoLinha = Pick<
  CreditCard,
  'id' | 'name' | 'limitAmount' | 'closingDay' | 'dueDay' | 'bankAccountId' | 'isActive'
>;
type LancamentoLinha = Pick<
  Transaction,
  | 'id'
  | 'type'
  | 'amount'
  | 'transactionDate'
  | 'bankAccountId'
  | 'creditCardId'
  | 'isConfirmed'
  | 'isRefund'
  | 'invoiceMonthOverride'
>;

describe('RelatorioService — do banco para a conta da tela', () => {
  let service: RelatorioService;
  let contas: ContaLinha[];
  let cartoes: CartaoLinha[];
  let lancamentos: LancamentoLinha[];
  let pagamentos: any[];
  let regime: Pick<User, 'reportRegime'>;
  /** Faturas VIRADAS: vazio no caminho normal. */
  let viradas: { creditCardId: string; referenceMonth: Date; earlyClosedAt: Date }[];
  let categorias: { id: string; name: string; type: string }[];

  beforeEach(() => {
    viradas = [];
    categorias = [{ id: 'cat-1', name: 'Alimentação', type: 'EXPENSE' }];
    contas = [
      {
        id: 'a1',
        institutionName: 'Nubank',
        accountType: 'CHECKING',
        currentBalance: dec(1000),
        initialBalance: dec(0),
        isActive: true,
        isHidden: false,
      },
    ];
    cartoes = [
      {
        id: 'k1',
        name: 'Nubank Roxinho',
        limitAmount: dec(3000),
        closingDay: 10,
        dueDay: 17,
        bankAccountId: 'a1',
        isActive: true,
      },
    ];
    lancamentos = [];
    pagamentos = [];
    regime = { reportRegime: 'FATURA' };

    const prisma: any = {
      user: { findUnique: jest.fn(async () => regime), update: jest.fn(async () => regime) },
      bankAccount: { findMany: jest.fn(async () => contas) },
      creditCard: { findMany: jest.fn(async () => cartoes) },
      transaction: { findMany: jest.fn(async () => lancamentos) },
      // As categorias do usuário e as padrão — é por elas que o ranking do
      // mês agrupa.
      category: { findMany: jest.fn(async () => categorias) },
      invoicePayment: { findMany: jest.fn(async () => pagamentos) },
      // As faturas viradas do usuário, na forma da consulta do service
      // (apenas `creditCardId`, `referenceMonth` e `earlyClosedAt`).
      creditCardInvoice: { findMany: jest.fn(async () => viradas) },
    };
    service = new RelatorioService(prisma);
  });

  const lancamento = (over: Partial<LancamentoLinha> = {}): LancamentoLinha => ({
    id: 't' + Math.random().toString(36).slice(2),
    type: 'EXPENSE',
    amount: dec(100),
    transactionDate: data('2026-11-05'),
    bankAccountId: 'a1',
    creditCardId: null,
    isConfirmed: true,
    isRefund: false,
    invoiceMonthOverride: null,
    ...over,
  });

  it('soma o mês com o que o banco devolve, do jeito que o banco devolve', async () => {
    lancamentos = [
      lancamento({ type: 'INCOME', amount: dec(5000) }),
      lancamento({ amount: dec(200.5) }),
    ];
    const r = await service.doMes('u1', '2026-11');
    expect(r).toMatchObject({ entradas: 5000, saidas: 200.5, resultado: 4799.5, regime: 'fatura' });
  });

  it('a data vem de coluna Date e ainda cai no mês certo', async () => {
    // `soData` corta os dez primeiros caracteres: num objeto Date isso daria
    // "Thu Nov 05" e o lançamento sumiria do mês. Este teste é a prova de que
    // o estado chega serializado como o app o recebe.
    lancamentos = [lancamento({ amount: dec(80), transactionDate: data('2026-11-30') })];
    expect((await service.doMes('u1', '2026-11')).saidas).toBe(80);
    expect((await service.doMes('u1', '2026-12')).vazio).toBe(true);
  });

  it('a compra no cartão pesa no vencimento da fatura, e a fatura vem nomeada', async () => {
    lancamentos = [
      lancamento({ amount: dec(30), bankAccountId: null, creditCardId: 'k1', transactionDate: data('2026-11-20') }),
    ];
    const r = await service.doMes('u1', '2026-12');
    expect(r.saidas).toBe(30);
    expect(r.faturas).toEqual([
      { cartaoId: 'k1', cartao: 'Nubank Roxinho', referencia: '2026-12', vencimento: '2026-12-17', valor: 30, status: 'OPEN', situacao: 'Aberta' },
    ]);
  });

  it('o pagamento de fatura entra pelo mês de referência da fatura', async () => {
    lancamentos = [
      lancamento({ amount: dec(100), bankAccountId: null, creditCardId: 'k1', transactionDate: data('2026-11-02') }),
    ];
    pagamentos = [
      {
        id: 'p1',
        amount: dec(100),
        paidAt: data('2026-11-15'),
        bankAccountId: 'a1',
        invoice: { creditCardId: 'k1', referenceMonth: data('2026-11-01') },
      },
    ];
    const r = await service.doMes('u1', '2026-11');
    expect(r.faturas).toEqual([
      { cartaoId: 'k1', cartao: 'Nubank Roxinho', referencia: '2026-11', vencimento: '2026-11-17', valor: 100, status: 'PAID', situacao: 'Paga' },
    ]);
  });

  it('a fatura VIRADA aparece como Fechada, com o vencimento do calendário', async () => {
    // A pergunta "qual o valor das minhas faturas" lê o status pelo mesmo
    // recorte da tela. Sem a virada chegando até aqui, ela diria Aberta para
    // uma fatura que a tela já mostra Fechada.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-11-23T15:00:00Z'));
    try {
      lancamentos = [
        lancamento({ amount: dec(30), bankAccountId: null, creditCardId: 'k1', transactionDate: data('2026-11-20') }),
      ];
      const aberta = await service.faturasDoMes('u1', '2026-12');
      expect(aberta.faturas[0]).toMatchObject({ status: 'OPEN', situacao: 'Aberta' });

      viradas = [{ creditCardId: 'k1', referenceMonth: data('2026-12-01'), earlyClosedAt: data('2026-11-23') }];
      const virada = await service.faturasDoMes('u1', '2026-12');
      expect(virada.faturas[0]).toMatchObject({
        status: 'CLOSED',
        situacao: 'Fechada',
        vencimento: '2026-12-17',
        valor: 30,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('o regime do usuário manda, e não o padrão', async () => {
    lancamentos = [
      lancamento({ amount: dec(30), bankAccountId: null, creditCardId: 'k1', transactionDate: data('2026-11-20') }),
    ];
    regime = { reportRegime: 'COMPRA' };
    const r = await service.doMes('u1', '2026-11');
    expect(r).toMatchObject({ regime: 'compra', saidas: 30 });
  });

  it('quem passa o regime não paga outra consulta por ele', async () => {
    const r = await service.doMes('u1', '2026-11', 'compra');
    expect(r.regime).toBe('compra');
  });
});

describe('instanteDoUsuario', () => {
  it('devolve o relógio do fuso do app, com hora', () => {
    // 1º de novembro de 2026, 00h40 UTC = 31 de outubro, 21h40 em São Paulo.
    const d = instanteDoUsuario(new Date('2026-11-01T00:40:00.000Z'), 'America/Sao_Paulo');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 31, 21]);
  });

  it('a hora importa: é ela que diz se a fatura de hoje já venceu', () => {
    const meiaNoite = instanteDoUsuario(new Date('2026-11-01T03:00:00.000Z'), 'America/Sao_Paulo');
    expect(meiaNoite.getHours()).toBe(0);
    const tarde = instanteDoUsuario(new Date('2026-11-01T17:00:00.000Z'), 'America/Sao_Paulo');
    expect(tarde.getHours()).toBe(14);
  });
});
