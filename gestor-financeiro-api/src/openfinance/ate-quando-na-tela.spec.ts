// ============================================================
// ate-quando-na-tela.spec.ts
// ============================================================
// A data de validade da conexão só serve se a pessoa a VIR antes. O
// servidor a manda em `conectadaAte`; quem a escreve na linha do banco é
// `ofAteQuando`, no `web/home.html`. Este teste recorta a função de verdade
// do arquivo — o mesmo bisturi dos geradores — e a executa.
//
// O que ele defende, em ordem de importância:
//
//   1. ASSINANTE NÃO VÊ PRAZO. O servidor manda nulo para quem paga, e a
//      tela tem de ficar muda. Uma data aparecendo para quem assinou é a
//      promessa de que o banco vai cair — e não vai.
//   2. NOS ÚLTIMOS DIAS A LINHA MUDA DE TINTA. Uma data cinza no meio de
//      outro metadado passa batido justamente na semana em que importa.
//   3. A CONTA DE DIAS É DE CALENDÁRIO, e não de horas: "amanhã" tem de
//      dizer amanhã mesmo que faltem 30 horas.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

type Escrever = (c: { conectadaAte?: string | null }) => string;

/** As duas funções do app, com o que elas usam de fora. */
function recortar(hoje: string): Escrever {
  const esc = (t: string) => String(t);
  const fmtDataBR = (iso: string) => {
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  };
  // `isoDate` é a do app, e aqui devolve o dia que o teste escolheu.
  const isoDate = () => hoje;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'esc',
    'fmtDataBR',
    'isoDate',
    funcao(src, 'diasAte') + '\n' + 'return (' + funcao(src, 'ofAteQuando') + ');',
  )(esc, fmtDataBR, isoDate);
}

describe('até quando o banco fica, na linha da conexão', () => {
  it('quem paga não vê prazo nenhum', () => {
    const escrever = recortar('2026-11-10');
    expect(escrever({ conectadaAte: null })).toBe('');
    expect(escrever({})).toBe('');
  });

  it('com folga, é metadado comum: a data e nada mais', () => {
    const escrever = recortar('2026-11-10');
    const txt = escrever({ conectadaAte: '2026-11-30' });
    expect(txt).toContain('conectado até 30/11/2026');
    expect(txt).not.toContain('meta-alerta');
  });

  it('a três dias, a linha muda de tinta e conta os dias', () => {
    const escrever = recortar('2026-11-27');
    const txt = escrever({ conectadaAte: '2026-11-30' });
    expect(txt).toContain('meta-alerta');
    expect(txt).toContain('faltam 3 dias');
  });

  it('amanhã diz amanhã, e hoje diz hoje', () => {
    expect(recortar('2026-11-29')({ conectadaAte: '2026-11-30' })).toContain('(amanhã)');
    expect(recortar('2026-11-30')({ conectadaAte: '2026-11-30' })).toContain('(hoje)');
  });

  /* Quatro dias ainda é "com folga": o degrau tem de cair exatamente em 3,
   * que é o dia do aviso por push. Dois alarmes em dias diferentes seriam
   * duas versões da mesma regra. */
  it('o degrau cai exatamente em três dias', () => {
    expect(recortar('2026-11-26')({ conectadaAte: '2026-11-30' })).not.toContain('meta-alerta');
    expect(recortar('2026-11-27')({ conectadaAte: '2026-11-30' })).toContain('meta-alerta');
  });

  it('a conta atravessa a virada do mês e do ano', () => {
    expect(recortar('2026-12-30')({ conectadaAte: '2027-01-01' })).toContain('faltam 2 dias');
    expect(recortar('2026-11-28')({ conectadaAte: '2026-12-01' })).toContain('faltam 3 dias');
  });

  /* Dia já vencido não pode virar "faltam -2 dias" na cara da pessoa: o
   * trabalho das 6h pode ter falhado, e a linha ainda estar na tela. E
   * dizer "(hoje)" num prazo de três dias atrás seria errar duas vezes. */
  it('data vencida diz que venceu, sem número negativo', () => {
    const txt = recortar('2026-12-03')({ conectadaAte: '2026-11-30' });
    expect(txt).toContain('(prazo vencido)');
    expect(txt).not.toMatch(/faltam -/);
    expect(txt).toContain('meta-alerta');
  });
});
