// ============================================================
// grupo-de-importacao.spec.ts
// ============================================================
// Importar a mesma fatura em quatro domingos virava quatro linhas iguais em
// "Importações recentes" — mesma conta, mesma fatura, diferentes só pela
// data. A lista de "recentes" passava a ser a lista de tudo.
//
// Agora elas se juntam por DESTINO e FATURA. O que estes testes defendem:
//
//   1. O LOTE CONTINUA INTEIRO DENTRO DO GRUPO. Desfazer é por importação,
//      e é a data mais o valor que a pessoa reconhece. Perder um lote no
//      agrupamento é perder o único caminho de volta dele.
//   2. O CORTE DA LISTA É POR GRUPO, NUNCA DENTRO. Cortar dentro esconderia
//      uma importação e deixaria o desfazer dela inalcançável — o defeito
//      mais caro possível aqui, porque é silencioso.
//   3. Faturas e cartões diferentes não se misturam.
//   4. O período vai do primeiro ao último, e os totais somam.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

interface Lote {
  id: string;
  em: string;
  n: number;
  valor: number;
  cartaoId?: string | null;
  contaId?: string | null;
  fatura?: string | null;
  transferencias?: number;
}

interface Grupo {
  chave: string;
  n: number;
  transferencias: number;
  valor: number;
  lotes: Lote[];
  de: string;
  ate: string;
  fatura?: string | null;
}

const agrupar: (l: Lote[]) => Grupo[] = new Function(
  [funcao(src, 'gruposDeImportacao'), 'return gruposDeImportacao;'].join(String.fromCharCode(10)),
)() as any;

/** O caso do print: a mesma fatura do INTER, importada em cinco vezes. */
const MESMA_FATURA: Lote[] = [
  { id: 'e', em: '2026-11-26T19:00:00.000Z', n: 1, valor: 29.26, cartaoId: 'k1', fatura: '2026-12' },
  { id: 'd', em: '2026-11-26T18:00:00.000Z', n: 1, valor: 61.36, cartaoId: 'k1', fatura: '2026-12' },
  { id: 'c', em: '2026-11-26T16:00:00.000Z', n: 6, valor: 352.28, cartaoId: 'k1', fatura: '2026-12' },
  { id: 'b', em: '2026-11-20T18:00:00.000Z', n: 4, valor: 544.85, cartaoId: 'k1', fatura: '2026-12' },
  { id: 'a', em: '2026-11-20T14:00:00.000Z', n: 16, valor: 1206.49, cartaoId: 'k1', fatura: '2026-12' },
];

describe('as importações da mesma fatura viram uma linha', () => {
  it('cinco importações do print viram um grupo', () => {
    const g = agrupar(MESMA_FATURA);
    expect(g).toHaveLength(1);
    expect(g[0].lotes).toHaveLength(5);
  });

  it('o total é a soma, e a contagem também', () => {
    const [g] = agrupar(MESMA_FATURA);
    expect(g.n).toBe(28);
    expect(g.valor).toBeCloseTo(2194.24, 2);
  });

  /* "importado de 20/11 a 26/11" só existe se os dois extremos estiverem
   * certos — e é a frase que explica por que são cinco e não uma. */
  it('o período vai do primeiro ao último', () => {
    const [g] = agrupar(MESMA_FATURA);
    expect(g.de).toBe('2026-11-20T14:00:00.000Z');
    expect(g.ate).toBe('2026-11-26T19:00:00.000Z');
  });

  /* A razão de tudo: cada importação continua desfazível sozinha. */
  it('nenhum lote se perde no caminho', () => {
    const [g] = agrupar(MESMA_FATURA);
    expect(g.lotes.map((l) => l.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('transferências somam no grupo, sem entrar no valor', () => {
    const g = agrupar([
      { id: 'x', em: '2026-11-01T12:00:00.000Z', n: 3, valor: 10, contaId: 'a1', transferencias: 2 },
      { id: 'y', em: '2026-11-02T12:00:00.000Z', n: 1, valor: 5, contaId: 'a1' },
    ]);
    expect(g[0].n).toBe(4);
    expect(g[0].transferencias).toBe(2);
    expect(g[0].valor).toBe(15);
  });
});

describe('o que NÃO se junta', () => {
  it('fatura diferente, grupo diferente', () => {
    const g = agrupar([
      ...MESMA_FATURA,
      { id: 'z', em: '2026-10-05T12:00:00.000Z', n: 2, valor: 40, cartaoId: 'k1', fatura: '2026-11' },
    ]);
    expect(g).toHaveLength(2);
  });

  it('cartão diferente, grupo diferente', () => {
    const g = agrupar([
      ...MESMA_FATURA,
      { id: 'z', em: '2026-11-21T12:00:00.000Z', n: 2, valor: 40, cartaoId: 'k2', fatura: '2026-12' },
    ]);
    expect(g).toHaveLength(2);
  });

  it('conta e cartão não se misturam', () => {
    const g = agrupar([
      { id: 'x', em: '2026-11-01T12:00:00.000Z', n: 1, valor: 10, cartaoId: 'k1', fatura: '2026-12' },
      { id: 'y', em: '2026-11-01T12:00:00.000Z', n: 1, valor: 10, contaId: 'a1', fatura: null },
    ]);
    expect(g).toHaveLength(2);
  });

  it('a ordem dos grupos segue a importação mais recente, que vem ordenada', () => {
    const g = agrupar([
      { id: 'novo', em: '2026-11-26T12:00:00.000Z', n: 1, valor: 1, cartaoId: 'k2', fatura: '2026-12' },
      ...MESMA_FATURA,
    ]);
    expect(g[0].lotes[0].id).toBe('novo');
  });
});

describe('o corte da lista', () => {
  const muitos: Lote[] = Array.from({ length: 12 }, (_, i) => ({
    id: 'g' + i,
    em: '2026-11-' + String(28 - i).padStart(2, '0') + 'T12:00:00.000Z',
    n: 1,
    valor: 10,
    cartaoId: 'k' + i,
    fatura: '2026-12',
  }));

  it('mostra oito GRUPOS, e não oito importações', () => {
    expect(agrupar(muitos)).toHaveLength(8);
  });

  /* O defeito silencioso que este teste existe para impedir: um lote
   * escondido dentro de um grupo não tem botão, e sem botão não há como
   * desfazer aquela importação nunca mais. */
  it('dentro do grupo não se corta nada, por mais importações que tenha', () => {
    const muitasNaMesma: Lote[] = Array.from({ length: 30 }, (_, i) => ({
      id: 'l' + i,
      em: '2026-11-0' + (i % 9) + 'T12:00:00.000Z',
      n: 1,
      valor: 1,
      cartaoId: 'k1',
      fatura: '2026-12',
    }));
    const g = agrupar(muitasNaMesma);
    expect(g).toHaveLength(1);
    expect(g[0].lotes).toHaveLength(30);
  });

  it('lista vazia não vira grupo nenhum', () => {
    expect(agrupar([])).toEqual([]);
  });
});
