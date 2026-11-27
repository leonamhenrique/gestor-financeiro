// ============================================================
// dia-do-instante.spec.ts
// ============================================================
// A lista de bancos mostrou "sincronizado em 27/11/2026" num dia 26.
//
// A causa: `lastSyncedAt` é um INSTANTE gravado em UTC, e a tela cortava os
// dez primeiros caracteres do texto ISO — o que devolve o dia EM UTC. Das
// 21h de Brasília em diante, o dia em UTC já é o seguinte. Nada estava
// errado no banco nem no servidor; só na leitura.
//
// O mesmo corte estava em sete lugares, e um deles é a DÉCIMA CONDIÇÃO, que
// decide gravar dinheiro sozinha: uma conexão autorizada às 22h passava a
// valer "a partir de amanhã", e as compras do próprio dia ficavam de fora.
//
// A armadilha do conserto é converter DEMAIS: coluna `@db.Date` chega como
// meia-noite UTC, e passá-la pela mesma conversão roubaria um dia dela. Por
// isso o último teste daqui existe.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

function recortar(): (v: unknown) => string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    [
      'var FUSO_DO_APP = "America/Sao_Paulo";',
      funcao(src, 'isoDate'),
      funcao(src, 'diaDoInstante'),
      'return diaDoInstante;',
    ].join(String.fromCharCode(10)),
  )();
}

const diaDoInstante = recortar();

describe('o dia de calendário de um instante', () => {
  /* O caso medido, com o print na mão: 26/11 às 22:30 em Brasília. */
  it('22h30 de Brasília ainda é o dia 26, não o 27', () => {
    expect(diaDoInstante('2026-11-27T01:30:00.000Z')).toBe('2026-11-26');
  });

  it('e o corte de texto, que era o que existia, erraria', () => {
    expect('2026-11-27T01:30:00.000Z'.slice(0, 10)).toBe('2026-11-27');
  });

  it('de manhã os dois concordam — por isso o defeito passou despercebido', () => {
    expect(diaDoInstante('2026-11-26T12:00:00.000Z')).toBe('2026-11-26');
  });

  it('a virada acontece às 21h daqui, que é a meia-noite de lá', () => {
    // 23:59:59 em Brasília, dia 26.
    expect(diaDoInstante('2026-11-27T02:59:59.000Z')).toBe('2026-11-26');
    // 00:00:00 em Brasília, dia 27.
    expect(diaDoInstante('2026-11-27T03:00:00.000Z')).toBe('2026-11-27');
  });

  it('atravessa a virada do ano sem tropeçar', () => {
    expect(diaDoInstante('2027-01-01T02:00:00.000Z')).toBe('2026-12-31');
  });

  it('aceita Date, e não só texto', () => {
    expect(diaDoInstante(new Date('2026-11-27T01:30:00.000Z') as any)).toBe('2026-11-26');
  });

  it('vazio e lixo não viram data inventada', () => {
    expect(diaDoInstante(null)).toBe('');
    expect(diaDoInstante('')).toBe('');
    // Texto que não é data volta como veio, cortado em 10: melhor na tela
    // do que "Invalid Date", e é o que a versão anterior já fazia.
    expect(diaDoInstante('isto nao e uma data')).toBe('isto nao e');
  });

  /* A OUTRA METADE DA REGRA. `transaction_date`, `transfer_date`,
   * `due_date`, `settled_at` e os outros `@db.Date` chegam como meia-noite
   * UTC: passá-los por aqui devolveria o dia ANTERIOR. Eles continuam
   * sendo cortados como texto, por `soData`. */
  it('data pura passada por engano perderia um dia — por isso ela não passa', () => {
    expect(diaDoInstante('2026-11-27T00:00:00.000Z')).toBe('2026-11-26');
    const soData = new Function('return (' + funcao(src, 'soData') + ');')();
    expect(soData('2026-11-27T00:00:00.000Z')).toBe('2026-11-27');
  });

  /* Um instante por campo errado é um dia errado na tela; um `@db.Date`
   * convertido é um dia errado em TODA data do app. Este teste conta
   * quantos cortes de texto sobraram, para a troca ser deliberada. */
  it('nenhum campo de INSTANTE conhecido sobrou sendo cortado como texto', () => {
    const instantes = [
      'sincronizadaEm',
      'autorizadaEm',
      'completedAt',
      'currentPeriodEnd',
      'lastViewedAt',
    ];
    for (const campo of instantes) {
      const re = new RegExp('String\\\\(\\\\w*\\\\.?' + campo + '\\\\)\\\\.slice\\\\(0, 10\\\\)');
      expect(src).not.toMatch(re);
    }
  });
});
