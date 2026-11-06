// ============================================================
// relatorio.spec.ts
// ============================================================
// Duas coisas, e a primeira é a que importa:
//
//   1. o `relatorio.js` versionado é o recorte do `web/home.html` DE AGORA.
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

const maiores = (
  d: unknown,
  mes = '2026-11',
  tipo = 'EXPENSE',
  regime = 'fatura',
  hoje = HOJE,
  quantas?: number,
) => relatorio.maioresDoMes(d, mes, hoje, tipo, regime, quantas);

describe('relatorio.js — a mesma conta da tela, fora dela', () => {
  /* A quebra de linha sai da comparação, e não é detalhe de gosto.
   *
   * O `home.html` é lido do disco, e no Windows o git entrega o arquivo com
   * CRLF (`core.autocrlf`); o recorte então carrega esses `\r` para dentro do
   * texto gerado, enquanto o arquivo versionado volta do commit com LF. O
   * teste ficava vermelho mostrando 425 linhas "diferentes" que eram iguais
   * letra por letra — e o que ele existe para pegar é a REGRA que mudou no
   * app, não o sistema operacional de quem roda `npm test`. */
  const semCR = (s: string) => s.replace(/\r\n/g, '\n');

  it('o arquivo versionado bate com o app de agora', () => {
    const noDisco = fs.readFileSync(DESTINO, 'utf8');
    // Falhou? A conta do mês mudou no app. Rode `npm run sync:relatorio` e
    // confira o diff: é a sua própria mudança chegando ao WhatsApp.
    expect(semCR(noDisco)).toBe(semCR(gerar()));
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

  describe('as maiores categorias do mês', () => {
    // Duas compras no cartão em outubro (fecha 10, vence 17 → fatura de
    // outubro vence em 17/10... então elas caem na fatura de NOVEMBRO) e uma
    // despesa na conta em novembro.
    const comCategorias = () =>
      dados({
        lancamentos: [
          lancamento({ amount: '300.00', categoryId: 'c1', creditCardId: 'k1', bankAccountId: null, transactionDate: '2026-10-20T00:00:00.000Z' }),
          lancamento({ amount: '200.00', categoryId: 'c2', creditCardId: 'k1', bankAccountId: null, transactionDate: '2026-10-22T00:00:00.000Z' }),
          lancamento({ amount: '50.00', categoryId: 'c1', transactionDate: '2026-11-05T00:00:00.000Z' }),
        ],
        categorias: [
          { id: 'c1', name: 'Alimentação', type: 'EXPENSE' },
          { id: 'c2', name: 'Transporte', type: 'EXPENSE' },
        ],
      });

    it('agrupa por categoria, da maior para a menor, com a fatia do grupo', () => {
      const r = maiores(comCategorias());
      expect(r.itens).toEqual([
        { categoria: 'Alimentação', valor: 350, lancamentos: 2, parte: (350 / 550) * 100 },
        { categoria: 'Transporte', valor: 200, lancamentos: 1, parte: (200 / 550) * 100 },
      ]);
      expect(r.total).toBe(550);
      expect(r.restantes).toBe(0);
    });

    it('o REGIME muda o mês inteiro, e não só o total', () => {
      // Pela compra, as duas do cartão voltam para outubro e novembro fica
      // só com a despesa da conta.
      const porCompra = maiores(comCategorias(), '2026-11', 'EXPENSE', 'compra');
      expect(porCompra.itens).toEqual([
        { categoria: 'Alimentação', valor: 50, lancamentos: 1, parte: 100 },
      ]);

      const outubro = maiores(comCategorias(), '2026-10', 'EXPENSE', 'compra');
      expect(outubro.itens.map((i: any) => [i.categoria, i.valor])).toEqual([
        ['Alimentação', 300],
        ['Transporte', 200],
      ]);
      // E pelo vencimento, outubro não tem nada: as compras pesam em novembro.
      expect(maiores(comCategorias(), '2026-10').itens).toEqual([]);
    });

    it('receita e despesa não se misturam', () => {
      const r = maiores(comCategorias(), '2026-11', 'INCOME');
      expect(r.itens).toEqual([]);
      expect(r.total).toBe(0);
    });

    it('corta no teto e diz quantas ficaram de fora', () => {
      const r = maiores(comCategorias(), '2026-11', 'EXPENSE', 'fatura', HOJE, 1);
      expect(r.itens.map((i: any) => i.categoria)).toEqual(['Alimentação']);
      expect(r.restantes).toBe(1);
      // O total continua sendo o do GRUPO, e não a soma do que coube.
      expect(r.total).toBe(550);
    });

    it('lançamento sem categoria não inventa uma', () => {
      const r = maiores(
        dados({
          lancamentos: [lancamento({ amount: '80.00', categoryId: null })],
          categorias: [],
        }),
      );
      expect(r.itens).toEqual([]);
    });
  });

  describe('o planejamento do mês', () => {
    /* Novembro planejado: teto de 3.000, com 800 em Alimentação (que tem uma
     * filha, Mercado) e 300 em Transporte. Os gastos:
     *
     *   - 300 em Alimentação, na conta, confirmado;
     *   - 150 em Mercado, na conta, PREVISTO — é o que a pergunta "quanto
     *     ainda posso gastar" precisa ver, e o padrão da tela conta;
     *   - 200 em Alimentação no CARTÃO, comprado em 20/10: por fatura pesa em
     *     novembro, por compra em outubro. É o caso que separa os regimes;
     *   - 420 em Transporte, estourando a meta de 300;
     *   - 80 em Lazer, que não tem meta nenhuma e cai em "outras categorias".
     */
    const comPlano = (over: Record<string, unknown> = {}) =>
      dados({
        lancamentos: [
          lancamento({ amount: '300.00', categoryId: 'c1', transactionDate: '2026-11-02T00:00:00.000Z' }),
          lancamento({ amount: '150.00', categoryId: 'c1a', transactionDate: '2026-11-20T00:00:00.000Z', isConfirmed: false }),
          lancamento({ amount: '200.00', categoryId: 'c1', creditCardId: 'k1', bankAccountId: null, transactionDate: '2026-10-20T00:00:00.000Z' }),
          lancamento({ amount: '420.00', categoryId: 'c2', transactionDate: '2026-11-03T00:00:00.000Z' }),
          lancamento({ amount: '80.00', categoryId: 'c3', transactionDate: '2026-11-01T00:00:00.000Z' }),
          lancamento({ type: 'INCOME', amount: '5000.00', categoryId: 'r1', transactionDate: '2026-11-05T00:00:00.000Z' }),
        ],
        categorias: [
          { id: 'c1', name: 'Alimentação', type: 'EXPENSE', parentId: null },
          { id: 'c1a', name: 'Mercado', type: 'EXPENSE', parentId: 'c1' },
          { id: 'c2', name: 'Transporte', type: 'EXPENSE', parentId: null },
          { id: 'c3', name: 'Lazer', type: 'EXPENSE', parentId: null },
          { id: 'r1', name: 'Salário', type: 'INCOME', parentId: null },
        ],
        planejamentos: [
          {
            month: '2026-11',
            income: '6000',
            total: '3000',
            items: [
              { categoryId: 'c1', amount: '800' },
              { categoryId: 'c2', amount: '300' },
            ],
          },
          { month: '2026-10', income: '6000', total: '2500', items: [] },
        ],
        ...over,
      });

    const plano = (d: unknown, mes = '2026-11', regime = 'fatura', catId?: string) =>
      relatorio.planoDoMes(d, mes, HOJE, regime, catId ?? null);

    it('o teto, o usado e o que ainda cabe — com o previsto dentro', () => {
      const r = plano(comPlano());
      expect(r.temPlano).toBe(true);
      expect(r.teto).toBe(3000);
      // 300 + 150 previsto + 200 do cartão + 420 + 80.
      expect(r.gasto).toBe(1150);
      expect(r.resta).toBe(1850);
      expect(r.pct).toBe(38);
      expect(r.filtros).toEqual({ previsto: true, cartao: true, ocultas: false });
      expect(r.receitaEsperada).toBe(6000);
      expect(r.receitaLancada).toBe(5000);
    });

    it('as metas, linha por linha, com "outras categorias" fechando a conta', () => {
      const r = plano(comPlano());
      expect(r.linhas.map((l: any) => [l.nome, l.meta, l.gasto, l.resta, l.nivel])).toEqual([
        // A filha soma no galho da pai: 300 + 150 + 200 = 650.
        ['Alimentação', 800, 650, 150, 'warn'],
        ['Transporte', 300, 420, -120, 'caro'],
        // O resto do teto (3000 − 1100) contra o resto do gasto (Lazer).
        ['Outras categorias', 1900, 80, 1820, 'accent'],
      ]);
    });

    it('o REGIME muda o gasto da meta, e não só o total do mês', () => {
      // Por compra, os 200 do cartão voltam para outubro: Alimentação sai de
      // 650 para 450, e o que ainda cabe DOBRA.
      const r = plano(comPlano(), '2026-11', 'compra');
      expect(r.gasto).toBe(950);
      const alimentacao = r.linhas[0];
      expect([alimentacao.gasto, alimentacao.resta, alimentacao.nivel]).toEqual([450, 350, 'accent']);
    });

    it('a categoria pedida vem com a meta dela, e sabe quantas filhas somou', () => {
      const r = plano(comPlano(), '2026-11', 'fatura', 'c1');
      expect(r.categoria).toEqual({
        id: 'c1', nome: 'Alimentação', temMeta: true, meta: 800, gasto: 650,
        resta: 150, pct: 81, nivel: 'warn', filhas: 1,
      });
      expect(r.paiComMeta).toBeUndefined();
    });

    it('filha sem meta vem com a meta da PAI, que é a que limita o gasto', () => {
      const r = plano(comPlano(), '2026-11', 'fatura', 'c1a');
      expect(r.categoria.temMeta).toBe(false);
      expect(r.categoria.gasto).toBe(150);
      expect(r.paiComMeta).toEqual({
        id: 'c1', nome: 'Alimentação', meta: 800, gasto: 650, resta: 150,
        pct: 81, nivel: 'warn',
      });
    });

    it('categoria sem meta e sem pai não ganha pai nenhum', () => {
      const r = plano(comPlano(), '2026-11', 'fatura', 'c3');
      expect(r.categoria.temMeta).toBe(false);
      expect(r.categoria.gasto).toBe(80);
      expect(r.paiComMeta).toBeUndefined();
    });

    /* A herança para a frente. HOJE é 1º/11/2026, e o plano decidido é de
     * novembro: dezembro não tem linha própria e usa a de novembro.
     *
     * É para isto que ela existe: por vencimento de fatura, a compra que a
     * pessoa faz hoje já pesa em dezembro, e sem herança a resposta seria
     * "não tenho com o que comparar" para dinheiro já comprometido. */
    it('mês à frente sem decisão própria herda a mais recente', () => {
      const r = plano(comPlano(), '2026-12');
      expect(r.temPlano).toBe(true);
      expect(r.herdadoDe).toBe('2026-11');
      expect(r.teto).toBe(3000);
      // As metas vêm junto, e o gasto é o de dezembro — que é zero aqui.
      expect(r.linhas.map((l: any) => [l.nome, l.meta, l.gasto])).toEqual([
        ['Alimentação', 800, 0],
        ['Transporte', 300, 0],
        ['Outras categorias', 1900, 0],
      ]);
    });

    it('o mês decidido não é herdado de ninguém', () => {
      expect(plano(comPlano()).herdadoDe).toBeNull();
    });

    it('mês passado sem decisão continua sem teto, e diz o que há para copiar', () => {
      // Setembro já acabou sem planejamento, e herdar para trás faria o app
      // emitir hoje um "passou do teto" sobre um mês encerrado, contra uma
      // meta que ninguém definiu para ele. O piso da herança é o mês de hoje.
      const r = plano(comPlano(), '2026-09');
      expect(r.temPlano).toBe(false);
      expect(r.planejados).toEqual(['2026-11', '2026-10']);
      expect(r.linhas).toEqual([]);
      expect(r.teto).toBeUndefined();
    });

    /* Sobre o pagamento de fatura, que o recorte exclui do gasto
     * (`gastoEntraNoPlano` recusa `t.pagamentoFaturaCartaoId`): aqui não há
     * teste dele porque ele NÃO PODE CHEGAR por este caminho. Medido: no
     * servidor, pagar uma fatura cria uma linha em `invoice_payments`, não um
     * lançamento — e `lancamentoDaApi` não tem esse campo, então ele só
     * existe no modo próprio do app, onde a tela o cria. Um teste que
     * inventasse o campo na entrada da API estaria defendendo uma crença
     * minha sobre o formato, que é o engano que este arquivo todo evita. */

    it('sem planejamento nenhum, não há plano e não há meses', () => {
      const r = plano(comPlano({ planejamentos: [] }));
      expect(r.temPlano).toBe(false);
      expect(r.planejados).toEqual([]);
    });
  });

  describe('o que está guardado nos objetivos', () => {
    /* Uma conta visível e uma OCULTA, porque é a conta oculta que separa os
     * dois números que mais se parecem: o guardado (tudo o que está no
     * objetivo) e o aplicado das contas (o que continua sendo saldo). */
    const comObjetivos = (over: Record<string, unknown> = {}) =>
      dados({
        contas: [conta(), conta({ id: 'a2', institutionName: 'Cofre', isHidden: true })],
        objetivos: [
          {
            id: 'g1', name: 'Viagem', startDate: '2026-01-01', targetDate: '2027-06-30',
            targetAmount: '12000', initialBalance: '2000', accountId: 'a1', completedAt: null,
            movements: [
              { id: 'm1', type: 'DEPOSIT', amount: '500', bankAccountId: 'a1', movementDate: '2026-10-05' },
              { id: 'm2', type: 'DEPOSIT', amount: '300', bankAccountId: 'a1', movementDate: '2026-11-01' },
              // Da conta OCULTA: entra no guardado, não entra no aplicado.
              { id: 'm3', type: 'DEPOSIT', amount: '100', bankAccountId: 'a2', movementDate: '2026-11-01' },
            ],
          },
          {
            id: 'g2', name: 'Notebook', startDate: '2026-06-01', targetDate: '2026-10-31',
            targetAmount: '5000', initialBalance: '0', accountId: 'a1', completedAt: null,
            movements: [
              { id: 'm4', type: 'DEPOSIT', amount: '1000', bankAccountId: 'a1', movementDate: '2026-09-10' },
            ],
          },
          {
            id: 'g3', name: 'Cadeira', startDate: '2026-01-01', targetDate: '2026-08-31',
            targetAmount: '1500', initialBalance: '0', accountId: 'a1', completedAt: '2026-08-20',
            movements: [
              { id: 'm5', type: 'DEPOSIT', amount: '1500', bankAccountId: 'a1', movementDate: '2026-08-01' },
            ],
          },
        ],
        ...over,
      });

    const objetivos = (d: unknown, hoje = HOJE) => relatorio.objetivosDeHoje(d, hoje);

    it('os três números do topo da tela, cada um sobre o seu conjunto', () => {
      const r = objetivos(comObjetivos());
      // Em andamento: 2.900 (Viagem, com os 2.000 de saldo inicial) + 1.000.
      expect(r.guardado).toBe(3900);
      // Aplicado das contas VISÍVEIS, sobre TODOS — concluído incluído, como
      // na tela: 800 + 1.000 + 1.500. Os 100 da conta oculta ficam de fora.
      expect(r.dasContas).toBe(3300);
      // O que não veio de conta nenhuma: o saldo inicial que ainda está lá.
      expect(r.inicial).toBe(2000);
      expect(r.quantos).toBe(3);
    });

    it('o concluído sai dos ativos e continua guardando o que tem', () => {
      const r = objetivos(comObjetivos());
      expect(r.ativos.map((o: any) => o.nome)).toEqual(['Viagem', 'Notebook']);
      expect(r.concluidos.map((o: any) => [o.nome, o.guardado])).toEqual([['Cadeira', 1500]]);
    });

    it('cada objetivo diz onde está e quanto falta por mês', () => {
      const r = objetivos(comObjetivos());
      const viagem = r.ativos[0];
      expect([viagem.guardado, viagem.meta, viagem.pct, viagem.falta]).toEqual([2900, 12000, 24, 9100]);
      // De 11/2026 a 06/2027, contando o mês corrente: 8 meses.
      expect([viagem.meses, viagem.mensal, viagem.atrasado]).toEqual([8, 1137.5, false]);
      // E a parte dele que saiu das contas visíveis — 800 dos 2.900.
      expect(viagem.dasContas).toBe(800);
    });

    it('prazo vencido com dinheiro faltando é atraso, e não um plano novo', () => {
      // HOJE é 1º/11/2026 e o prazo era 31/10. `mesesAteOPrazo` nunca desce de
      // 1, então o "por mês" viraria "tudo neste mês" — por isso a marca.
      const r = objetivos(comObjetivos());
      const note = r.ativos[1];
      expect([note.falta, note.meses, note.atrasado]).toEqual([4000, 1, true]);
    });

    it('resgatar mais do que aplicou come o saldo inicial, e não vira negativo', () => {
      const d = comObjetivos({
        objetivos: [
          {
            id: 'g1', name: 'Viagem', startDate: '2026-01-01', targetDate: '2027-06-30',
            targetAmount: '12000', initialBalance: '2000', accountId: 'a1', completedAt: null,
            movements: [
              { id: 'm1', type: 'DEPOSIT', amount: '300', bankAccountId: 'a1', movementDate: '2026-10-05' },
              { id: 'm2', type: 'WITHDRAW', amount: '800', bankAccountId: 'a1', movementDate: '2026-10-20' },
            ],
          },
        ],
      });
      const r = objetivos(d);
      // Guardado: 2.000 + 300 − 800 = 1.500.
      expect(r.guardado).toBe(1500);
      // Aplicado: −500 vira 0, porque esse dinheiro saiu do saldo inicial e
      // já virou saldo de conta. Sem o piso, o total do app ficaria parado.
      expect(r.dasContas).toBe(0);
      expect(r.inicial).toBe(1500);
    });

    it('sem objetivo nenhum, tudo zero e nada quebra', () => {
      const r = objetivos(comObjetivos({ objetivos: [] }));
      expect([r.guardado, r.dasContas, r.inicial, r.quantos]).toEqual([0, 0, 0, 0]);
      expect(r.ativos).toEqual([]);
    });

    it('sem `hoje` não há prazo possível, e a porta recusa', () => {
      // O fallback do app é `dataDeHoje()`, que aqui não existe: seria o
      // relógio do servidor contando o prazo de quem perguntou.
      expect(() => relatorio.objetivosDeHoje(comObjetivos(), null)).toThrow(/hoje/);
    });
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
