// ============================================================
// relatorio.spec.ts
// ============================================================
// Duas coisas, e a primeira é a que importa:
//
//   1. o `relatorio.js` versionado é o recorte do `web/index.html` DE AGORA.
//      Sem isto, mexer na conta do mês no app deixaria o WhatsApp respondendo
//      pela conta de semanas atrás — e ninguém descobriria, porque as duas
//      continuariam dando um número, cada uma o seu;
//   2. a conta funciona fora do navegador: com o estado vindo do banco, pelo
//      regime que o usuário escolheu, e sem um pedido enxergar o estado do
//      pedido anterior.
// ============================================================

import * as fs from 'fs';
import { gerar, DESTINO } from '../../scripts/gerar-relatorio';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const relatorio = require('./relatorio.js');

/** Um 14h do dia 1º de novembro de 2026 — hora cheia de propósito: é "hoje"
 * que decide fatura aberta, fechada e rotativo. */
const HOJE = new Date(2026, 10, 1, 14, 0);

const conta = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  institutionName: 'Nubank',
  accountType: 'CHECKING',
  currentBalance: '1000.00',
  initialBalance: '0',
  isActive: true,
  isHidden: false,
  ...over,
});

const cartao = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'Nubank Roxinho',
  limitAmount: '3000',
  closingDay: 10,
  dueDay: 17,
  bankAccountId: 'a1',
  ...over,
});

const lancamento = (over: Record<string, unknown> = {}) => ({
  id: 't' + Math.random().toString(36).slice(2),
  type: 'EXPENSE',
  amount: '100.00',
  transactionDate: '2026-11-05T00:00:00.000Z',
  bankAccountId: 'a1',
  creditCardId: null,
  isConfirmed: true,
  isRefund: false,
  invoiceMonthOverride: null,
  ...over,
});

const dados = (over: Record<string, unknown> = {}) => ({
  contas: [conta()],
  cartoes: [cartao()],
  lancamentos: [],
  pagamentos: { k1: [] },
  ...over,
});

const calcular = (d: unknown, mes = '2026-11', regime = 'fatura', hoje = HOJE) =>
  relatorio.calcularMes(d, mes, hoje, regime);

describe('relatorio.js — a mesma conta da tela, fora dela', () => {
  it('o arquivo versionado bate com o app de agora', () => {
    const noDisco = fs.readFileSync(DESTINO, 'utf8');
    // Falhou? A conta do mês mudou no app. Rode `npm run sync:relatorio` e
    // confira o diff: é a sua própria mudança chegando ao WhatsApp.
    expect(noDisco).toBe(gerar());
  });

  it('soma receitas e despesas do mês, previstas incluídas', () => {
    const r = calcular(
      dados({
        lancamentos: [
          lancamento({ type: 'INCOME', amount: '5000' }),
          lancamento({ amount: '200' }),
          // Previsto: ainda não aconteceu, e a tela conta.
          lancamento({ amount: '300', isConfirmed: false, transactionDate: '2026-11-28T00:00:00.000Z' }),
        ],
      }),
    );
    expect(r).toMatchObject({ entradas: 5000, saidas: 500, resultado: 4500, lancamentos: 3 });
  });

  it('mês sem movimento é vazio, e não zero com cara de resposta', () => {
    expect(calcular(dados(), '2026-07')).toMatchObject({ vazio: true, resultado: 0 });
  });

  it('reembolso abate a despesa em vez de somar receita', () => {
    const r = calcular(
      dados({
        lancamentos: [
          lancamento({ amount: '200' }),
          lancamento({ type: 'INCOME', amount: '80', isRefund: true }),
        ],
      }),
    );
    expect(r).toMatchObject({ entradas: 0, saidas: 120 });
  });

  it('conta oculta não entra', () => {
    const r = calcular(
      dados({
        contas: [conta(), conta({ id: 'a2', institutionName: 'Cofre', isHidden: true })],
        lancamentos: [lancamento({ amount: '200' }), lancamento({ amount: '900', bankAccountId: 'a2' })],
      }),
    );
    expect(r.saidas).toBe(200);
  });

  describe('a mesma compra de cartão, nos dois regimes', () => {
    // Compra em 05/11; o cartão fecha 10 e vence 17, então a fatura é a de
    // novembro e vence 17/11 — o mês é o mesmo nos dois regimes aqui, e é por
    // isso que o caso interessante é a compra DEPOIS do fechamento.
    const compraEm = (data: string) =>
      dados({ lancamentos: [lancamento({ amount: '30', bankAccountId: null, creditCardId: 'k1', transactionDate: data })] });

    it('por compra, pesa no mês em que se gastou', () => {
      expect(calcular(compraEm('2026-11-20T00:00:00.000Z'), '2026-11', 'compra')).toMatchObject({
        saidas: 30,
        faturas: [],
      });
      expect(calcular(compraEm('2026-11-20T00:00:00.000Z'), '2026-12', 'compra')).toMatchObject({ vazio: true });
    });

    it('por fatura, pesa no mês em que o dinheiro sai', () => {
      // Comprou dia 20/11, depois do fechamento (10): a fatura é a de
      // dezembro, que vence 17/12.
      expect(calcular(compraEm('2026-11-20T00:00:00.000Z'), '2026-11')).toMatchObject({ vazio: true });
      expect(calcular(compraEm('2026-11-20T00:00:00.000Z'), '2026-12')).toMatchObject({
        saidas: 30,
        faturas: [{ cartaoId: 'k1', cartao: 'Nubank Roxinho', referencia: '2026-12', valor: 30, status: 'OPEN' }],
      });
    });

    it('a fatura é uma linha só, e não as compras dela', () => {
      const r = calcular(
        dados({
          lancamentos: [
            lancamento({ amount: '30', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-02T00:00:00.000Z' }),
            lancamento({ amount: '70', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-03T00:00:00.000Z' }),
          ],
        }),
      );
      expect(r).toMatchObject({ saidas: 100, lancamentos: 1 });
    });

    it('fatura paga conta pelo que foi pago', () => {
      const d = dados({
        lancamentos: [
          lancamento({ amount: '100', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-02T00:00:00.000Z' }),
        ],
        pagamentos: {
          k1: [{ id: 'p1', referenceMonth: '2026-11', amount: '100', paidAt: '2026-11-15T00:00:00.000Z', bankAccountId: 'a1' }],
        },
      });
      expect(calcular(d, '2026-11')).toMatchObject({ saidas: 100, faturas: [{ status: 'PAID', valor: 100 }] });
    });

    it('fatura com estorno maior que as compras entra como receita', () => {
      const d = dados({
        lancamentos: [
          lancamento({ amount: '100', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-02T00:00:00.000Z' }),
          lancamento({ type: 'INCOME', amount: '180', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-03T00:00:00.000Z' }),
        ],
      });
      expect(calcular(d, '2026-11')).toMatchObject({ entradas: 80, saidas: 0 });
    });
  });

  it('a fatura escolhida à mão manda no mês', () => {
    const d = dados({
      lancamentos: [
        lancamento({
          amount: '30',
          bankAccountId: null,
          creditCardId: 'k1',
          transactionDate: '2026-11-02T00:00:00.000Z',
          invoiceMonthOverride: '2026-12-01T00:00:00.000Z',
        }),
      ],
    });
    expect(calcular(d, '2026-11')).toMatchObject({ vazio: true });
    expect(calcular(d, '2026-12')).toMatchObject({ saidas: 30 });
  });

  describe('as faturas que vencem no mês', () => {
    const faturas = (d: unknown, mes = '2026-11', hoje = HOJE) =>
      relatorio.faturasDoMes(d, mes, hoje);

    const noCartao = (over: Record<string, unknown> = {}) =>
      lancamento({ bankAccountId: null, creditCardId: 'k1', ...over });

    it('uma linha por cartão, com o mês da fatura e o dia do vencimento', () => {
      const r = faturas(dados({ lancamentos: [noCartao({ amount: '300', transactionDate: '2026-11-02T00:00:00.000Z' })] }));
      expect(r.faturas).toEqual([
        {
          cartaoId: 'k1',
          cartao: 'Nubank Roxinho',
          referencia: '2026-11',
          vencimento: '2026-11-17',
          valor: 300,
          status: 'OPEN',
          situacao: 'Aberta',
        },
      ]);
      expect(r.total).toBe(300);
    });

    it('fecha 25 e vence 5: a fatura de outubro é cobrada em novembro', () => {
      // O arranjo comuníssimo em que referência e vencimento são meses
      // diferentes — e a razão de a resposta dizer as duas datas.
      const d = dados({
        cartoes: [cartao({ id: 'k1', name: 'Carrefour', closingDay: 25, dueDay: 5 })],
        lancamentos: [noCartao({ amount: '80', transactionDate: '2026-10-20T00:00:00.000Z' })],
      });
      expect(faturas(d, '2026-10').faturas).toEqual([]);
      expect(faturas(d, '2026-11').faturas).toMatchObject([
        { referencia: '2026-10', vencimento: '2026-11-05', valor: 80 },
      ]);
    });

    it('a lista é a MESMA nos dois regimes', () => {
      // O regime decide em que mês uma compra pesa num relatório; não decide
      // quando o cartão cobra. Se esta igualdade cair, a pessoa que conta por
      // compra passa a receber outra resposta para "quanto tenho de fatura".
      const d = dados({ lancamentos: [noCartao({ amount: '300', transactionDate: '2026-11-02T00:00:00.000Z' })] });
      const porFatura = faturas(d);
      // Um cálculo por compra no meio, para provar que o global não vaza.
      calcular(d, '2026-11', 'compra');
      expect(faturas(d)).toEqual(porFatura);
    });

    it('cartão sem fatura no mês não entra na lista', () => {
      const d = dados({
        cartoes: [cartao(), cartao({ id: 'k2', name: 'Itaú Click' })],
        lancamentos: [noCartao({ amount: '300', transactionDate: '2026-11-02T00:00:00.000Z' })],
      });
      const r = faturas(d);
      expect(r.faturas).toHaveLength(1);
      // Mas os cartões continuam contados: é o que separa "nenhuma fatura
      // vence neste mês" de "você não tem cartão".
      expect(r.cartoes).toBe(2);
    });

    it('mês sem fatura nenhuma: lista vazia, e os cartões contados', () => {
      expect(faturas(dados(), '2026-07')).toMatchObject({ faturas: [], total: 0, cartoes: 1 });
    });

    it('sem cartão nenhum, a contagem é zero', () => {
      expect(faturas(dados({ cartoes: [] }))).toMatchObject({ faturas: [], cartoes: 0 });
    });

    it('fatura paga aparece como paga, pelo que foi pago', () => {
      const d = dados({
        lancamentos: [noCartao({ amount: '100', transactionDate: '2026-11-02T00:00:00.000Z' })],
        pagamentos: {
          k1: [{ id: 'p1', referenceMonth: '2026-11', amount: '100', paidAt: '2026-11-15T00:00:00.000Z', bankAccountId: 'a1' }],
        },
      });
      expect(faturas(d).faturas).toMatchObject([{ situacao: 'Paga', valor: 100 }]);
    });

    it('saldo credor entra negativo, e o total soma pelo sinal', () => {
      const d = dados({
        lancamentos: [
          noCartao({ amount: '100', transactionDate: '2026-11-02T00:00:00.000Z' }),
          noCartao({ type: 'INCOME', amount: '180', transactionDate: '2026-11-03T00:00:00.000Z' }),
        ],
      });
      expect(faturas(d)).toMatchObject({ total: -80, faturas: [{ valor: -80 }] });
    });
  });

  describe('o que a porta de entrada cobra', () => {
    it('sem hoje, estoura — conta sem data é conta contra 1970', () => {
      expect(() => relatorio.calcularMes(dados(), '2026-11', null, 'fatura')).toThrow(/hoje/);
    });

    it('mês fora do formato estoura', () => {
      expect(() => relatorio.calcularMes(dados(), 'novembro', HOJE, 'fatura')).toThrow(/mês inválido/);
    });

    it('regime estranho estoura em vez de cair no do pedido anterior', () => {
      expect(() => relatorio.calcularMes(dados(), '2026-11', HOJE, 'competencia')).toThrow(/regime inválido/);
    });

    it('um pedido não vê o estado do outro', () => {
      const primeiro = calcular(dados({ lancamentos: [lancamento({ amount: '200' })] }));
      expect(primeiro.saidas).toBe(200);
      // Outra pessoa, sem lançamento nenhum: se o estado vazasse, ela veria
      // os 200 da anterior.
      expect(calcular(dados())).toMatchObject({ vazio: true, saidas: 0 });
    });

    it('o regime de um pedido não contamina o seguinte', () => {
      const compra = dados({
        lancamentos: [lancamento({ amount: '30', bankAccountId: null, creditCardId: 'k1', transactionDate: '2026-11-20T00:00:00.000Z' })],
      });
      expect(calcular(compra, '2026-11', 'compra').saidas).toBe(30);
      // O mesmo mês, agora por fatura: a compra de 20/11 está na fatura de
      // dezembro e novembro tem de voltar a ficar vazio.
      expect(calcular(compra, '2026-11', 'fatura')).toMatchObject({ vazio: true });
    });

    it('o padrão é o mesmo do app', () => {
      expect(relatorio.REGIME_PADRAO).toBe('fatura');
    });
  });
});
