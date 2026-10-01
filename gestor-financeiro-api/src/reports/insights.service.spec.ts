import { Prisma } from '@prisma/client';
import { InsightsService, type EntradaDosInsights } from './insights.service';
import {
  ZERO,
  fluxoPorMes,
  indicadores,
  type CategoriaDoRelatorio,
  type LancamentoDoRelatorio,
} from './report.utils';

const d = (n: number | string) => new Prisma.Decimal(n);
const servico = new InsightsService();

const lanc = (
  mes: string,
  tipo: 'INCOME' | 'EXPENSE',
  valor: number,
  extra: Partial<LancamentoDoRelatorio> = {},
): LancamentoDoRelatorio => ({ mes, tipo, valor: d(valor), categoriaId: 'c1', descricao: 'x', confirmado: true, recorrente: false, ...extra });

const cat = (name: string, amount: number, delta = 0): CategoriaDoRelatorio => ({
  categoryId: name, name, amount: d(amount), share: 0, deltaQuarter: delta,
});

/** Um ano plausível: nove meses realizados e três previstos. */
function entrada(over: Partial<EntradaDosInsights> = {}): EntradaDosInsights {
  const lancamentos: LancamentoDoRelatorio[] = [];
  for (let m = 1; m <= 9; m++) {
    const mes = `2026-${String(m).padStart(2, '0')}`;
    lancamentos.push(lanc(mes, 'INCOME', 1000), lanc(mes, 'EXPENSE', 800));
  }
  // Julho mais apertado de propósito: é o "fora da curva".
  lancamentos.push(lanc('2026-07', 'EXPENSE', 100));
  for (let m = 10; m <= 12; m++) {
    const mes = `2026-${String(m).padStart(2, '0')}`;
    lancamentos.push(lanc(mes, 'INCOME', 1000, { confirmado: false }), lanc(mes, 'EXPENSE', 700, { confirmado: false }));
  }
  const months = fluxoPorMes(lancamentos, 2026, '2026-09', ZERO);
  const kpis = indicadores(months, d(5000));
  return {
    months,
    categories: [cat('Moradia', 3000, 0), cat('Alimentação', 2000, 0.08), cat('Saúde', 1000, -0.1)],
    kpis,
    mesCorrente: '2026-09',
    receitaPrincipal: d(8000),
    receitaExtra: d(1000),
    despesaFixa: d(3000),
    categoriasFixas: [cat('Moradia', 3000), cat('Assinaturas', 300)],
    agendadoNoMesApertado: new Map([['2026-10', d(500)], ['2026-11', d(500)], ['2026-12', d(500)]]),
    ...over,
  };
}

const porChave = (e: EntradaDosInsights, chave: string) => servico.gerar(e).find((i) => i.key === chave);

describe('InsightsService', () => {
  it('devolve as seis regras quando há dado para todas', () => {
    expect(servico.gerar(entrada()).map((i) => i.key)).toEqual([
      'savings-rate', 'extra-income', 'fixed-weight', 'quarter-shift', 'tightest-month', 'year-end',
    ]);
  });

  it('todo insight sai em português e com os campos do contrato', () => {
    for (const i of servico.gerar(entrada())) {
      expect(i).toMatchObject({
        key: expect.any(String), metric: expect.any(String),
        tone: expect.stringMatching(/^(positive|attention)$/),
        title: expect.any(String), text: expect.any(String),
      });
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.text).not.toMatch(/undefined|NaN|Infinity/);
    }
  });

  // ---------- 1. poupança e mês fora da curva ----------
  describe('taxa de poupança', () => {
    it('aponta o pior e o melhor mês', () => {
      const i = porChave(entrada(), 'savings-rate')!;
      // 9 meses de sobra 200, menos os 100 extras de julho: 1.700 sobre 9.000.
      expect(i.metric).toBe('18,9%');
      expect(i.text).toContain('Julho'); // o mês com a despesa extra
      expect(i.tone).toBe('positive');
    });

    it('com poupança baixa o tom vira atenção', () => {
      const e = entrada();
      e.kpis = { ...e.kpis, savingsRate: 0.02 };
      expect(porChave(e, 'savings-rate')!.tone).toBe('attention');
    });

    it('com menos de dois meses não há curva, e a regra se cala', () => {
      const months = fluxoPorMes([lanc('2026-01', 'INCOME', 100)], 2026, '2026-01', ZERO);
      expect(porChave(entrada({ months, mesCorrente: '2026-01' }), 'savings-rate')).toBeUndefined();
    });

    it('ano sem receita nenhuma não gera a regra', () => {
      const months = fluxoPorMes([], 2026, '2026-09', ZERO);
      expect(porChave(entrada({ months }), 'savings-rate')).toBeUndefined();
    });
  });

  // ---------- 2. renda extra ----------
  describe('dependência de renda extra', () => {
    it('diz quanto a poupança cairia sem ela', () => {
      const i = porChave(entrada(), 'extra-income')!;
      expect(i.text).toContain('R$ 1.000');
      expect(i.text).toMatch(/cairia de .* para /);
    });

    it('sem renda extra a regra não aparece', () => {
      expect(porChave(entrada({ receitaExtra: ZERO }), 'extra-income')).toBeUndefined();
    });

    it('sem receita nenhuma não divide por zero', () => {
      const e = entrada();
      e.kpis = { ...e.kpis, realizedIncome: ZERO };
      expect(porChave(e, 'extra-income')).toBeUndefined();
    });
  });

  // ---------- 3. gastos fixos ----------
  describe('peso dos gastos fixos', () => {
    it('nomeia as fixas e aponta a mais simples de revisar', () => {
      const i = porChave(entrada(), 'fixed-weight')!;
      expect(i.text).toContain('Moradia');
      expect(i.text).toContain('Assinaturas'); // a menor delas
      expect(i.text).toMatch(/mais simples de revisar/);
    });

    it('acima de metade das despesas o tom vira atenção', () => {
      const e = entrada({ despesaFixa: d(6000) });
      const i = porChave(e, 'fixed-weight')!;
      expect(i.tone).toBe('attention');
      expect(i.title).toMatch(/Mais da metade/);
    });

    it('sem despesa fixa a regra se cala', () => {
      expect(porChave(entrada({ despesaFixa: ZERO }), 'fixed-weight')).toBeUndefined();
    });

    it('sem categoria fixa identificada também se cala', () => {
      expect(porChave(entrada({ categoriasFixas: [] }), 'fixed-weight')).toBeUndefined();
    });

    it('despesa total zero não divide por zero', () => {
      const e = entrada();
      e.kpis = { ...e.kpis, realizedExpense: ZERO };
      expect(porChave(e, 'fixed-weight')).toBeUndefined();
    });
  });

  // ---------- 4. trimestre ----------
  describe('variação do trimestre', () => {
    it('separa o que subiu do que caiu', () => {
      const i = porChave(entrada(), 'quarter-shift')!;
      expect(i.metric).toBe('+8%');
      expect(i.text).toContain('Alimentação');
      expect(i.text).toContain('Saúde'); // compensou
      expect(i.tone).toBe('attention');
    });

    it('sem nenhuma categoria em alta a regra se cala', () => {
      const e = entrada({ categories: [cat('Moradia', 10, -0.2), cat('Saúde', 5, -0.1)] });
      expect(porChave(e, 'quarter-shift')).toBeUndefined();
    });

    it('com menos de duas categorias variando se cala', () => {
      expect(porChave(entrada({ categories: [cat('Moradia', 10, 0.5)] }), 'quarter-shift')).toBeUndefined();
    });

    it('todas estáveis (delta 0) não geram texto', () => {
      const e = entrada({ categories: [cat('A', 10, 0), cat('B', 5, 0)] });
      expect(porChave(e, 'quarter-shift')).toBeUndefined();
    });
  });

  // ---------- 5. mês previsto mais apertado ----------
  describe('mês previsto mais apertado', () => {
    it('escolhe pela sobra relativa e diz quanto já está agendado', () => {
      const lancamentos = [
        lanc('2026-10', 'INCOME', 1000, { confirmado: false }), lanc('2026-10', 'EXPENSE', 950, { confirmado: false }),
        lanc('2026-11', 'INCOME', 5000, { confirmado: false }), lanc('2026-11', 'EXPENSE', 1000, { confirmado: false }),
      ];
      const months = fluxoPorMes(lancamentos, 2026, '2026-09', ZERO);
      const i = porChave(entrada({ months }), 'tightest-month')!;
      expect(i.title).toContain('Outubro');
      expect(i.text).toContain('R$ 500'); // o agendado informado
      expect(i.tone).toBe('attention'); // 5% de sobra
    });

    it('sem mês previsto com receita a regra se cala', () => {
      const months = fluxoPorMes([lanc('2026-01', 'INCOME', 100)], 2026, '2026-12', ZERO);
      expect(porChave(entrada({ months, mesCorrente: '2026-12' }), 'tightest-month')).toBeUndefined();
    });

    it('mês previsto sem receita não vira "o mais apertado" por divisão por zero', () => {
      const months = fluxoPorMes([lanc('2026-10', 'EXPENSE', 500, { confirmado: false })], 2026, '2026-09', ZERO);
      expect(porChave(entrada({ months }), 'tightest-month')).toBeUndefined();
    });
  });

  // ---------- 6. fechamento do ano ----------
  describe('projeção de fechamento', () => {
    it('soma a sobra prevista e fecha o ano', () => {
      const i = porChave(entrada(), 'year-end')!;
      expect(i.metric).toMatch(/^R\$ /);
      expect(i.text).toContain('outubro a dezembro');
      expect(i.tone).toBe('positive');
    });

    it('ano que fecha no vermelho vira atenção', () => {
      const lancamentos = [lanc('2026-01', 'EXPENSE', 9000), lanc('2026-10', 'EXPENSE', 500, { confirmado: false })];
      const months = fluxoPorMes(lancamentos, 2026, '2026-09', ZERO);
      expect(porChave(entrada({ months }), 'year-end')!.tone).toBe('attention');
    });

    it('em dezembro não há mês previsto e a regra se cala', () => {
      const months = fluxoPorMes([], 2026, '2026-12', ZERO);
      expect(porChave(entrada({ months, mesCorrente: '2026-12' }), 'year-end')).toBeUndefined();
    });
  });

  // ---------- borda geral ----------
  it('ano completamente vazio não gera insight nenhum, e não quebra', () => {
    const months = fluxoPorMes([], 2026, '2026-09', ZERO);
    const vazio = entrada({
      months,
      categories: [],
      kpis: indicadores(months, ZERO),
      receitaPrincipal: ZERO,
      receitaExtra: ZERO,
      despesaFixa: ZERO,
      categoriasFixas: [],
      agendadoNoMesApertado: new Map(),
    });
    expect(servico.gerar(vazio)).toEqual([]);
  });
});
