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
  /** Os planejamentos como a consulta os traz: a linha do mês com as metas
   * dentro, dinheiro em Decimal — é por isso que o round-trip de JSON existe
   * no serviço. */
  let planejamentos: {
    month: string;
    income: Prisma.Decimal;
    total: Prisma.Decimal;
    items: { categoryId: string; amount: Prisma.Decimal; fromChildren: boolean }[];
  }[];

  /** Os objetivos como a consulta os traz: dinheiro em Decimal, data em
   * coluna Date, movimentos dentro. */
  let objetivos: any[];

  beforeEach(() => {
    viradas = [];
    planejamentos = [];
    objetivos = [];
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
      // Os planejamentos, com as metas dentro — a mesma forma da rota
      // /budgets, que é de onde o app os lê.
      budget: { findMany: jest.fn(async () => planejamentos) },
      // Os objetivos, com os movimentos dentro, como a rota /goals os entrega.
      goal: { findMany: jest.fn(async () => objetivos) },
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

  /* O planejamento sai do banco com dinheiro em Decimal e volta como número,
   * pelo mesmo round-trip de JSON do resto. Um Decimal chegando cru na conta
   * do app viraria `NaN` na primeira subtração — e a resposta diria "ainda
   * cabem R$ NaN". */
  it('o planejamento do banco vira teto, meta e o que ainda cabe', async () => {
    planejamentos = [
      {
        month: '2026-11',
        income: dec(6000),
        total: dec(3000),
        items: [{ categoryId: 'cat-1', amount: dec(800), fromChildren: false }],
      },
    ];
    lancamentos = [
      lancamento({ amount: dec(650), categoryId: 'cat-1', transactionDate: data('2026-11-05') } as any),
    ];
    const r = await service.planoDoMes('u1', '2026-11', 'fatura', 'cat-1');
    expect(r.temPlano).toBe(true);
    expect([r.teto, r.gasto, r.resta]).toEqual([3000, 650, 2350]);
    expect(r.categoria).toMatchObject({ nome: 'Alimentação', meta: 800, gasto: 650, resta: 150 });
    // E a consulta é a do usuário que perguntou, não a de todos.
    expect((service as any).prisma.budget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  /* O objetivo sai do banco com dinheiro em Decimal e DATA EM COLUNA Date, e
   * volta como número e 'AAAA-MM-DD'. O prazo é o que mais sofre: um Date
   * cru faria `new Date(o.prazo + 'T00:00:00')` virar Invalid Date, e os
   * meses até o prazo sairiam NaN — "R$ NaN por mês". */
  it('o objetivo do banco vira guardado, falta e quanto por mês', async () => {
    objetivos = [
      {
        id: 'g1',
        name: 'Viagem',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        targetDate: new Date('2027-06-30T00:00:00.000Z'),
        targetAmount: dec(12000),
        initialBalance: dec(2000),
        accountId: 'a1',
        completedAt: null,
        movements: [
          {
            id: 'm1',
            type: 'DEPOSIT',
            amount: dec(900),
            bankAccountId: 'a1',
            movementDate: new Date('2026-10-05T00:00:00.000Z'),
          },
        ],
      },
    ];
    const r = await service.objetivos('u1');
    expect([r.guardado, r.dasContas, r.inicial, r.quantos]).toEqual([2900, 900, 2000, 1]);
    expect(r.ativos[0]).toMatchObject({ nome: 'Viagem', meta: 12000, falta: 9100, prazo: '2027-06-30' });
    expect(Number.isFinite(r.ativos[0].mensal)).toBe(true);
    // E a consulta é a de quem perguntou.
    expect((service as any).prisma.goal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('a pergunta dos objetivos não carrega os lançamentos', async () => {
    // Objetivo não depende de lançamento, fatura nem regime. Carregar a
    // lista inteira aqui seria pagar a conta mais cara do serviço à toa.
    await service.objetivos('u1');
    expect((service as any).prisma.transaction.findMany).not.toHaveBeenCalled();
    expect((service as any).prisma.creditCard.findMany).not.toHaveBeenCalled();
  });

  it('mês sem planejamento não inventa teto nenhum', async () => {
    const r = await service.planoDoMes('u1', '2026-11', 'fatura');
    expect(r.temPlano).toBe(false);
    expect(r.teto).toBeUndefined();
    expect(r.planejados).toEqual([]);
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
