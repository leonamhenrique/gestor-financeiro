import { Prisma } from '@prisma/client';
import {
  ZERO,
  dec,
  despesasPorCategoria,
  emReais,
  estimarGastoVariavel,
  fluxoPorMes,
  indicadores,
  participacao,
  taxaDePoupanca,
  trimestreDoMes,
  ultimosMesesRealizados,
  trimestresComparaveis,
  previstosDoMes,
  TETO_DE_PREVISTOS,
  variacaoTrimestre,
  type LancamentoDoRelatorio,
} from './report.utils';

const d = (n: number | string) => new Prisma.Decimal(n);

const lanc = (
  mes: string,
  tipo: 'INCOME' | 'EXPENSE',
  valor: number,
  extra: Partial<LancamentoDoRelatorio> = {},
): LancamentoDoRelatorio => ({
  mes,
  tipo,
  valor: d(valor),
  categoriaId: 'c1',
  descricao: 'Lançamento',
  confirmado: true,
  recorrente: false,
  ...extra,
});

describe('dinheiro', () => {
  it('soma em Decimal fecha no centavo onde Float erra', () => {
    // 0,1 somado doze vezes dá 1,2000000000000002 em Float.
    const doze = Array.from({ length: 12 }, () => d('0.10'));
    expect(emReais(doze.reduce((s, v) => s.plus(v), ZERO))).toBe('1.20');
  });

  it('serializa sempre com duas casas', () => {
    expect(emReais(d(7))).toBe('7.00');
    expect(emReais(d('1234.5'))).toBe('1234.50');
  });

  it('aceita Decimal, string e número vindos do banco', () => {
    expect(emReais(dec(d('10.50')))).toBe('10.50');
    expect(emReais(dec('10.50'))).toBe('10.50');
    expect(emReais(dec(10.5))).toBe('10.50');
    expect(emReais(dec(null))).toBe('0.00');
  });
});

describe('fluxoPorMes', () => {
  it('sempre devolve os doze meses, mesmo sem lançamento nenhum', () => {
    const meses = fluxoPorMes([], 2026, '2026-09', d(100));
    expect(meses).toHaveLength(12);
    expect(meses[0].month).toBe('2026-01');
    expect(meses[11].month).toBe('2026-12');
    expect(emReais(meses[11].balance)).toBe('100.00'); // só o saldo inicial
  });

  it('corta realizado × previsto pelo mês corrente, que ainda é realizado', () => {
    const meses = fluxoPorMes([], 2026, '2026-09', ZERO);
    expect(meses.find((m) => m.month === '2026-09')!.isForecast).toBe(false);
    expect(meses.find((m) => m.month === '2026-10')!.isForecast).toBe(true);
  });

  it('em mês realizado conta só o confirmado', () => {
    const meses = fluxoPorMes(
      [lanc('2026-03', 'EXPENSE', 100), lanc('2026-03', 'EXPENSE', 40, { confirmado: false })],
      2026,
      '2026-09',
      ZERO,
    );
    expect(emReais(meses[2].expense)).toBe('100.00');
  });

  it('em mês previsto conta o agendado, que por definição não está confirmado', () => {
    const meses = fluxoPorMes(
      [lanc('2026-11', 'EXPENSE', 80, { confirmado: false }), lanc('2026-11', 'INCOME', 200, { confirmado: false })],
      2026,
      '2026-09',
      ZERO,
    );
    const nov = meses.find((m) => m.month === '2026-11')!;
    expect(emReais(nov.expense)).toBe('80.00');
    expect(emReais(nov.income)).toBe('200.00');
  });

  it('a estimativa de variável entra só no mês previsto', () => {
    const est = new Map([['2026-11', d(300)], ['2026-03', d(999)]]);
    const meses = fluxoPorMes([lanc('2026-03', 'EXPENSE', 100)], 2026, '2026-09', ZERO, est);
    expect(emReais(meses[2].expense)).toBe('100.00'); // março ignora a estimativa
    expect(emReais(meses.find((m) => m.month === '2026-11')!.expense)).toBe('300.00');
  });

  it('acumula o saldo a partir do inicial, mês a mês', () => {
    const meses = fluxoPorMes(
      [lanc('2026-01', 'INCOME', 1000), lanc('2026-02', 'EXPENSE', 300)],
      2026,
      '2026-09',
      d(500),
    );
    expect(emReais(meses[0].balance)).toBe('1500.00');
    expect(emReais(meses[1].balance)).toBe('1200.00');
    expect(emReais(meses[11].balance)).toBe('1200.00');
  });

  it('ignora lançamento de outro ano', () => {
    const meses = fluxoPorMes([lanc('2025-12', 'EXPENSE', 999)], 2026, '2026-09', ZERO);
    expect(emReais(meses[11].balance)).toBe('0.00');
  });
});

describe('estimarGastoVariavel', () => {
  it('sem histórico não inventa número', () => {
    expect(emReais(estimarGastoVariavel([], d(0)))).toBe('0.00');
  });

  it('é a média do histórico menos o que já está agendado', () => {
    expect(emReais(estimarGastoVariavel([d(300), d(600), d(300)], d(100)))).toBe('300.00');
  });

  it('nunca é negativa: agendado acima da média zera a estimativa', () => {
    expect(emReais(estimarGastoVariavel([d(300), d(300), d(300)], d(500)))).toBe('0.00');
  });

  it('agendado igual à média zera', () => {
    expect(emReais(estimarGastoVariavel([d(400)], d(400)))).toBe('0.00');
  });
});

describe('ultimosMesesRealizados', () => {
  it('pega os N últimos até o mês corrente', () => {
    expect(ultimosMesesRealizados(2026, '2026-09', 3)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('no começo do ano devolve só o que existe', () => {
    expect(ultimosMesesRealizados(2026, '2026-02', 3)).toEqual(['2026-01', '2026-02']);
  });
});

describe('variacaoTrimestre', () => {
  it('mede o crescimento contra a base', () => {
    expect(variacaoTrimestre(d(121), d(100))).toBeCloseTo(0.21, 4);
    expect(variacaoTrimestre(d(94), d(100))).toBeCloseTo(-0.06, 4);
  });

  it('sem base devolve 0, não infinito', () => {
    expect(variacaoTrimestre(d(500), d(0))).toBe(0);
    expect(Number.isFinite(variacaoTrimestre(d(500), d(0)))).toBe(true);
  });

  it('base negativa também não explode', () => {
    expect(variacaoTrimestre(d(10), d(-5))).toBe(0);
  });
});

describe('participacao e taxaDePoupanca', () => {
  it('participação com total zero é 0', () => {
    expect(participacao(d(10), d(0))).toBe(0);
  });

  it('taxa de poupança com receita zero é 0 — não se guarda fração de nada', () => {
    expect(taxaDePoupanca(d(0), d(500))).toBe(0);
  });

  it('taxa de poupança pode ser negativa: gastar mais do que entrou é um fato', () => {
    expect(taxaDePoupanca(d(1000), d(1200))).toBeCloseTo(-0.2, 4);
  });
});

describe('trimestreDoMes', () => {
  it('mapeia os quatro trimestres', () => {
    expect([
      trimestreDoMes('2026-01'),
      trimestreDoMes('2026-04'),
      trimestreDoMes('2026-09'),
      trimestreDoMes('2026-12'),
    ]).toEqual([1, 2, 3, 4]);
  });
});

describe('trimestresComparaveis', () => {
  it('no último mês do trimestre, compara o corrente com o anterior', () => {
    expect(trimestresComparaveis('2026-09')).toEqual({ atual: { ano: 2026, tri: 3 }, anterior: { ano: 2026, tri: 2 } });
  });

  it('com o trimestre pela metade, recua: nunca compara parcial com inteiro', () => {
    // 1º de outubro: o 4º tri tem um mês e o 3º tem três. Comparar os dois
    // faria toda categoria "cair 66%".
    expect(trimestresComparaveis('2026-10')).toEqual({ atual: { ano: 2026, tri: 3 }, anterior: { ano: 2026, tri: 2 } });
    expect(trimestresComparaveis('2026-11')).toEqual({ atual: { ano: 2026, tri: 3 }, anterior: { ano: 2026, tri: 2 } });
  });

  it('vira o ano para trás quando precisa', () => {
    expect(trimestresComparaveis('2026-01')).toEqual({ atual: { ano: 2025, tri: 4 }, anterior: { ano: 2025, tri: 3 } });
    expect(trimestresComparaveis('2026-03')).toEqual({ atual: { ano: 2026, tri: 1 }, anterior: { ano: 2025, tri: 4 } });
  });
});

describe('despesasPorCategoria', () => {
  const nomes = new Map([['c1', 'Moradia'], ['c2', 'Alimentação']]);

  it('soma só despesa confirmada até o mês corrente, da maior para a menor', () => {
    const r = despesasPorCategoria(
      [
        lanc('2026-01', 'EXPENSE', 300, { categoriaId: 'c1' }),
        lanc('2026-02', 'EXPENSE', 500, { categoriaId: 'c2' }),
        lanc('2026-02', 'EXPENSE', 90, { categoriaId: 'c2', confirmado: false }),
        lanc('2026-11', 'EXPENSE', 999, { categoriaId: 'c1' }),
        lanc('2026-01', 'INCOME', 1000, { categoriaId: 'c1' }),
      ],
      nomes,
      '2026-09',
    );
    expect(r.map((c) => [c.name, emReais(c.amount)])).toEqual([
      ['Alimentação', '500.00'],
      ['Moradia', '300.00'],
    ]);
    expect(r[0].share).toBeCloseTo(0.625, 4);
  });

  it('compara o trimestre corrente com o anterior', () => {
    const r = despesasPorCategoria(
      [
        lanc('2026-05', 'EXPENSE', 100, { categoriaId: 'c1' }), // 2º tri
        lanc('2026-08', 'EXPENSE', 121, { categoriaId: 'c1' }), // 3º tri
      ],
      nomes,
      '2026-09',
    );
    expect(r[0].deltaQuarter).toBeCloseTo(0.21, 4);
  });

  it('no 1º trimestre, ainda incompleto, compara os dois últimos fechados do ano anterior', () => {
    // Fevereiro: o 1º tri não fechou, então vale 2025-Q4 contra 2025-Q3.
    const r = despesasPorCategoria(
      [
        lanc('2025-08', 'EXPENSE', 200, { categoriaId: 'c1' }), // 3º tri de 2025
        lanc('2025-11', 'EXPENSE', 300, { categoriaId: 'c1' }), // 4º tri de 2025
        lanc('2026-02', 'EXPENSE', 100, { categoriaId: 'c1' }),
      ],
      nomes,
      '2026-02',
    );
    expect(r[0].deltaQuarter).toBeCloseTo(0.5, 4);
  });

  it('ano sem despesa devolve lista vazia, sem divisão por zero', () => {
    expect(despesasPorCategoria([], nomes, '2026-09')).toEqual([]);
  });

  it('lançamento sem categoria não some do total', () => {
    const r = despesasPorCategoria([lanc('2026-01', 'EXPENSE', 50, { categoriaId: null })], nomes, '2026-09');
    expect(r[0].name).toBe('Sem categoria');
    expect(r[0].share).toBe(1);
  });
});

describe('indicadores', () => {
  it('soma só os meses realizados e projeta o saldo do fim do ano', () => {
    const meses = fluxoPorMes(
      [
        lanc('2026-01', 'INCOME', 1000),
        lanc('2026-01', 'EXPENSE', 800),
        lanc('2026-11', 'INCOME', 5000, { confirmado: false }),
      ],
      2026,
      '2026-09',
      ZERO,
    );
    const k = indicadores(meses, d(1234));
    expect(emReais(k.realizedIncome)).toBe('1000.00');
    expect(emReais(k.realizedExpense)).toBe('800.00');
    expect(k.savingsRate).toBeCloseTo(0.2, 4);
    expect(emReais(k.currentBalance)).toBe('1234.00'); // vem das contas, não do fluxo
    expect(emReais(k.projectedYearEndBalance)).toBe('5200.00');
  });

  it('ano sem dado nenhum não quebra', () => {
    const k = indicadores(fluxoPorMes([], 2026, '2026-09', ZERO), ZERO);
    expect(k.savingsRate).toBe(0);
    expect(emReais(k.projectedYearEndBalance)).toBe('0.00');
  });
});

describe('previstosDoMes', () => {
  const nomes = new Map([['c1', 'Moradia'], ['c2', 'Salário']]);
  const prev = (tipo: 'INCOME' | 'EXPENSE', valor: number, desc?: string) =>
    lanc('2026-11', tipo, valor, { confirmado: false, descricao: desc ?? `L${valor}`, categoriaId: tipo === 'INCOME' ? 'c2' : 'c1' });

  it('acumula o saldo a partir do saldo do mês anterior', () => {
    const { upcoming } = previstosDoMes(
      [prev('INCOME', 1000), prev('EXPENSE', 300)], '2026-11', d(500), nomes, ZERO,
    );
    expect(upcoming.map((l) => [l.amount, l.balanceAfter])).toEqual([
      ['1000.00', '1500.00'],
      ['-300.00', '1200.00'],
    ]);
  });

  it('entrada vem antes de saída: o saldo não mergulha por ordem de leitura', () => {
    const { upcoming } = previstosDoMes([prev('EXPENSE', 50), prev('INCOME', 80)], '2026-11', ZERO, nomes, ZERO);
    expect(upcoming.map((l) => l.amount)).toEqual(['80.00', '-50.00']);
  });

  it('sem teto estourado não inventa linha de resto', () => {
    const { upcoming, upcomingTotal } = previstosDoMes([prev('EXPENSE', 10)], '2026-11', ZERO, nomes, ZERO);
    expect(upcoming).toHaveLength(1);
    expect(upcomingTotal).toBe(1);
  });

  it('acima do teto mostra os MAIORES, não os primeiros', () => {
    // Trinta saídas de 1 a 30, em ordem crescente na entrada.
    const muitos = Array.from({ length: 30 }, (_, i) => prev('EXPENSE', i + 1));
    const { upcoming } = previstosDoMes(muitos, '2026-11', ZERO, nomes, ZERO, 3);
    expect(upcoming.slice(0, 3).map((l) => l.amount)).toEqual(['-30.00', '-29.00', '-28.00']);
  });

  it('o que sobra vira uma linha só, com a soma líquida e o total verdadeiro', () => {
    const muitos = [prev('INCOME', 100), ...Array.from({ length: 5 }, (_, i) => prev('EXPENSE', (i + 1) * 10))];
    const { upcoming, upcomingTotal } = previstosDoMes(muitos, '2026-11', ZERO, nomes, ZERO, 2);
    const resto = upcoming[2];
    expect(upcomingTotal).toBe(6);
    expect(resto.description).toBe('mais 4 lançamentos previstos');
    expect(resto.tag).toBe('Resto do mês');
    // mostrados: +100 e -50; resto: -40 -30 -20 -10 = -100
    expect(resto.amount).toBe('-100.00');
  });

  it('cortado ou não, o saldo final é o mesmo — o teto não esconde dinheiro', () => {
    const muitos = [prev('INCOME', 900), ...Array.from({ length: 12 }, (_, i) => prev('EXPENSE', (i + 1) * 7))];
    const inteiro = previstosDoMes(muitos, '2026-11', d(200), nomes, ZERO, 999);
    const cortado = previstosDoMes(muitos, '2026-11', d(200), nomes, ZERO, 3);
    const fim = (r: { upcoming: { balanceAfter: string }[] }) => r.upcoming[r.upcoming.length - 1].balanceAfter;
    expect(fim(cortado)).toBe(fim(inteiro));
  });

  it('a estimativa entra depois do resto e fecha o saldo', () => {
    const muitos = Array.from({ length: 4 }, (_, i) => prev('EXPENSE', (i + 1) * 10));
    const { upcoming } = previstosDoMes(muitos, '2026-11', d(1000), nomes, d(25), 2);
    const ultima = upcoming[upcoming.length - 1];
    expect(ultima.description).toBe('Gastos variáveis (estimativa)');
    expect(ultima.amount).toBe('-25.00');
    // 1000 - 40 - 30 (mostrados) - 30 (resto: 20+10) - 25 = 875
    expect(ultima.balanceAfter).toBe('875.00');
  });

  it('mês sem nada previsto devolve lista vazia', () => {
    expect(previstosDoMes([], '2026-11', d(10), nomes, ZERO)).toEqual({ upcoming: [], upcomingTotal: 0 });
  });

  it('lançamento sem descrição cai no nome da categoria', () => {
    const sem = lanc('2026-11', 'EXPENSE', 40, { confirmado: false, descricao: null as unknown as string, categoriaId: 'c1' });
    const { upcoming } = previstosDoMes([sem], '2026-11', ZERO, nomes, ZERO);
    expect(upcoming[0].description).toBe('Moradia');
    expect(upcoming[0].tag).toBe('Moradia');
  });

  it('o teto padrão é 40', () => {
    expect(TETO_DE_PREVISTOS).toBe(40);
    const muitos = Array.from({ length: 45 }, (_, i) => prev('EXPENSE', i + 1));
    const { upcoming } = previstosDoMes(muitos, '2026-11', ZERO, nomes, ZERO);
    expect(upcoming).toHaveLength(41); // 40 + a linha do resto
  });
});
