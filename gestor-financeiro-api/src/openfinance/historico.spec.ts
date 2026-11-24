// ============================================================
// historico.spec.ts
// ============================================================
// O corte de meses por plano. O que importa:
//
// 1. o cartão agrupa pela FATURA que o banco previu, e não pela data da
//    compra — senão a fatura de dezembro se parte em duas;
// 2. buraco no meio não gasta cota: "os três últimos meses COM MOVIMENTO";
// 3. zero corta tudo, nulo não corta nada.
// ============================================================

import { cortarPorHistorico, mesDoLancamento } from './historico';

const l = (data: string, faturaPrevista?: string) => ({ data, faturaPrevista });

describe('o mês que agrupa', () => {
  it('no cartão é a fatura que o banco previu', () => {
    expect(mesDoLancamento(l('2026-11-28', '2026-12'), true)).toBe('2026-12');
  });

  it('sem fatura prevista, cai na data', () => {
    expect(mesDoLancamento(l('2026-11-28'), true)).toBe('2026-11');
  });

  /* Na conta não existe fatura: a previsão do banco, se vier, não manda. */
  it('na conta é sempre a data', () => {
    expect(mesDoLancamento(l('2026-11-28', '2026-12'), false)).toBe('2026-11');
  });
});

describe('corte por histórico', () => {
  const doCartao = [
    l('2026-09-10', '2026-10'),
    l('2026-10-11', '2026-11'),
    l('2026-11-12', '2026-12'),
    l('2026-11-13', '2026-12'),
  ];

  it('nulo não corta nada', () => {
    const r = cortarPorHistorico(doCartao, null, true);
    expect(r.ficaram).toHaveLength(4);
    expect(r.mesesCortados).toEqual([]);
  });

  it('um mês deixa só a fatura mais recente, inteira', () => {
    const r = cortarPorHistorico(doCartao, 1, true);
    expect(r.ficaram).toHaveLength(2);
    expect(r.mesesCortados).toEqual(['2026-10', '2026-11']);
  });

  it('dois meses deixam as duas faturas mais recentes', () => {
    const r = cortarPorHistorico(doCartao, 2, true);
    expect(r.ficaram).toHaveLength(3);
    expect(r.mesesCortados).toEqual(['2026-10']);
  });

  it('mais meses do que existem não corta nada', () => {
    expect(cortarPorHistorico(doCartao, 12, true).mesesCortados).toEqual([]);
  });

  /* O grátis não tem Open Finance: com uma conexão de pé por queda de plano,
   * a busca para de oferecer novidade — e não toca em nada do que já entrou. */
  it('zero corta tudo', () => {
    const r = cortarPorHistorico(doCartao, 0, true);
    expect(r.ficaram).toEqual([]);
    expect(r.mesesCortados).toEqual(['2026-10', '2026-11', '2026-12']);
  });

  /* Três meses com nada em outubro dão setembro, novembro e dezembro — e não
   * "os três últimos do calendário", que entregaria dois. */
  it('buraco no meio não gasta cota', () => {
    const comBuraco = [l('2026-09-01', '2026-09'), l('2026-11-01', '2026-11'), l('2026-12-01', '2026-12')];
    const r = cortarPorHistorico(comBuraco, 3, true);
    expect(r.ficaram).toHaveLength(3);
    expect(r.mesesCortados).toEqual([]);
  });

  it('na conta o corte usa a data', () => {
    const daConta = [l('2026-09-10'), l('2026-10-10'), l('2026-11-10')];
    const r = cortarPorHistorico(daConta, 1, false);
    expect(r.ficaram).toEqual([l('2026-11-10')]);
    expect(r.mesesCortados).toEqual(['2026-09', '2026-10']);
  });

  it('lista vazia não quebra', () => {
    expect(cortarPorHistorico([], 1, true)).toEqual({ ficaram: [], mesesCortados: [] });
  });
});
