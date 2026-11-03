import { cicloDaData, cicloDaDataVirada, cicloDoDia, datasDoCiclo, datasDoMesChave, diasNoMes } from './billing-cycle';

const utc = (s: string) => new Date(s + 'T00:00:00.000Z');
const dia = (d: Date) => d.toISOString().slice(0, 10);
/** O cartão como o ciclo o enxerga: os dias de agora e, quando o teste
 * precisa, a linha do tempo. */
const k = (closingDay: number, dueDay: number, cycles?: any[]) => ({ closingDay, dueDay, cycles });
const ciclo = (c: { referenceMonth: Date; closingDate: Date; dueDate: Date }) => ({
  ref: dia(c.referenceMonth),
  fecha: dia(c.closingDate),
  vence: dia(c.dueDate),
});

describe('billing-cycle — vencimento antes do fechamento no calendário (fecha 28, vence 5)', () => {
  it('a fatura de setembro fecha 28/09 e vence 05/10, no mês seguinte', () => {
    expect(ciclo(datasDoCiclo(2026, 8, 28, 5))).toEqual({ ref: '2026-09-01', fecha: '2026-09-28', vence: '2026-10-05' });
  });

  it('compra até o dia 28 cai em setembro; no dia 29, em outubro (que vence em novembro)', () => {
    expect(ciclo(cicloDaData(utc('2026-09-28'), k(28, 5)))).toEqual({ ref: '2026-09-01', fecha: '2026-09-28', vence: '2026-10-05' });
    expect(ciclo(cicloDaData(utc('2026-09-29'), k(28, 5)))).toEqual({ ref: '2026-10-01', fecha: '2026-10-28', vence: '2026-11-05' });
  });

  it('fecha 29 e vence 30 em fevereiro: os dois virariam 28/02, então vence em 30/03', () => {
    expect(ciclo(datasDoCiclo(2026, 1, 29, 30))).toEqual({ ref: '2026-02-01', fecha: '2026-02-28', vence: '2026-03-30' });
  });

  it('vencimento no mesmo dia do fechamento também é no mês seguinte', () => {
    expect(ciclo(datasDoCiclo(2026, 8, 10, 10))).toMatchObject({ fecha: '2026-09-10', vence: '2026-10-10' });
  });

  it('o vencimento nunca cai antes do fechamento, para qualquer par de dias', () => {
    for (let fecha = 1; fecha <= 31; fecha++) {
      for (let vence = 1; vence <= 31; vence++) {
        for (let mes0 = 0; mes0 < 12; mes0++) {
          const c = datasDoCiclo(2026, mes0, fecha, vence);
          expect(c.dueDate.getTime()).toBeGreaterThan(c.closingDate.getTime());
        }
      }
    }
  });
});

describe('billing-cycle — dia que não existe no mês vai para o último dia válido (fecha 10, vence 31)', () => {
  it('fevereiro de 2026: vence 28/02, não 03/03', () => {
    expect(ciclo(datasDoCiclo(2026, 1, 10, 31))).toEqual({ ref: '2026-02-01', fecha: '2026-02-10', vence: '2026-02-28' });
  });

  it('fevereiro de 2028 (bissexto): vence 29/02', () => {
    expect(ciclo(datasDoCiclo(2028, 1, 10, 31))).toMatchObject({ vence: '2028-02-29' });
  });

  it('abril (30 dias): vence 30/04', () => {
    expect(ciclo(datasDoCiclo(2026, 3, 10, 31))).toMatchObject({ vence: '2026-04-30' });
  });

  it('meses de 31 dias continuam no dia 31', () => {
    expect(ciclo(datasDoCiclo(2026, 0, 10, 31))).toMatchObject({ vence: '2026-01-31' });
    expect(ciclo(datasDoCiclo(2026, 11, 10, 31))).toMatchObject({ vence: '2026-12-31' });
  });

  it('fechamento dia 31 em fevereiro é dia 28; a compra do dia 28 ainda entra em fevereiro', () => {
    expect(ciclo(cicloDaData(utc('2026-02-28'), k(31, 7)))).toEqual({ ref: '2026-02-01', fecha: '2026-02-28', vence: '2026-03-07' });
    expect(ciclo(cicloDaData(utc('2026-03-01'), k(31, 7)))).toEqual({ ref: '2026-03-01', fecha: '2026-03-31', vence: '2026-04-07' });
  });

  it('fechamento dia 30 em ano bissexto: 29/02 entra em fevereiro', () => {
    expect(ciclo(cicloDaData(utc('2028-02-29'), k(30, 8)))).toMatchObject({ ref: '2028-02-01', fecha: '2028-02-29' });
  });

  it('fechamento dia 31 em abril é 30; a compra de 30/04 fica em abril', () => {
    expect(ciclo(cicloDaData(utc('2026-04-30'), k(31, 7)))).toMatchObject({ ref: '2026-04-01', fecha: '2026-04-30' });
  });

  it('diasNoMes', () => {
    expect([diasNoMes(2026, 1), diasNoMes(2028, 1), diasNoMes(2026, 3), diasNoMes(2026, 11)]).toEqual([28, 29, 30, 31]);
  });
});

describe('billing-cycle — virada de ano', () => {
  it('fecha em dezembro e vence em janeiro do ano seguinte', () => {
    expect(ciclo(datasDoCiclo(2026, 11, 28, 5))).toEqual({ ref: '2026-12-01', fecha: '2026-12-28', vence: '2027-01-05' });
  });

  it('compra depois do fechamento de dezembro vai para janeiro, que vence em fevereiro', () => {
    expect(ciclo(cicloDaData(utc('2026-12-29'), k(28, 5)))).toEqual({ ref: '2027-01-01', fecha: '2027-01-28', vence: '2027-02-05' });
  });

  it('fecha 10 e vence 17: compra de 20/12 cai em janeiro com as duas datas em janeiro', () => {
    expect(ciclo(cicloDaData(utc('2026-12-20'), k(10, 17)))).toEqual({ ref: '2027-01-01', fecha: '2027-01-10', vence: '2027-01-17' });
  });
});

describe('billing-cycle — entradas', () => {
  it('cicloDoDia usa o dia do calendário dado, sem fuso', () => {
    expect(ciclo(cicloDoDia('2026-09-11', k(10, 17)))).toMatchObject({ ref: '2026-10-01' });
  });

  it('datasDoMesChave recebe AAAA-MM', () => {
    expect(ciclo(datasDoMesChave('2026-02', k(10, 31)))).toEqual({ ref: '2026-02-01', fecha: '2026-02-10', vence: '2026-02-28' });
  });

  it('tudo sai em meia-noite UTC (convenção das colunas @db.Date)', () => {
    const c = datasDoCiclo(2026, 8, 28, 5);
    [c.referenceMonth, c.closingDate, c.dueDate].forEach((d) => expect(d.toISOString().endsWith('T00:00:00.000Z')).toBe(true));
  });
});

describe('billing-cycle — fatura VIRADA (fechada antes do dia, como no Itaú/Iti)', () => {
  // Fecha dia 1: a fatura 12/2026 junta as compras de 02/11 a 01/12 e vence
  // em 10/12. É o cartão do caso que trouxe isso.
  const FECHA = 1;
  const VENCE = 10;

  it('sem virada nenhuma, a conta é a de sempre', () => {
    expect(ciclo(cicloDaDataVirada(utc('2026-11-25'), k(FECHA, VENCE), {}))).toEqual(
      ciclo(cicloDaData(utc('2026-11-25'), k(FECHA, VENCE))),
    );
  });

  it('virada em 23/11: a compra de 25/11 pula para a fatura de janeiro', () => {
    const viradas = { '2026-12': '2026-11-23' };
    expect(ciclo(cicloDaDataVirada(utc('2026-11-25'), k(FECHA, VENCE), viradas))).toEqual({
      ref: '2027-01-01',
      fecha: '2027-01-01',
      vence: '2027-01-10',
    });
  });

  it('a compra do PRÓPRIO dia da virada já vai para a seguinte', () => {
    const viradas = { '2026-12': '2026-11-23' };
    expect(ciclo(cicloDaDataVirada(utc('2026-11-23'), k(FECHA, VENCE), viradas))).toMatchObject({ ref: '2027-01-01' });
  });

  it('a compra de ANTES da virada continua na fatura que fechou', () => {
    const viradas = { '2026-12': '2026-11-23' };
    expect(ciclo(cicloDaDataVirada(utc('2026-11-22'), k(FECHA, VENCE), viradas))).toMatchObject({ ref: '2026-12-01' });
  });

  it('virada de outro mês não mexe em compra que nem cairia nela', () => {
    const viradas = { '2026-10': '2026-09-20' };
    expect(ciclo(cicloDaDataVirada(utc('2026-11-25'), k(FECHA, VENCE), viradas))).toMatchObject({ ref: '2026-12-01' });
  });

  it('virar duas vezes seguidas empurra duas faturas', () => {
    // Virou dezembro dia 23/11 e, dia 05/12, virou janeiro também.
    const viradas = { '2026-12': '2026-11-23', '2027-01': '2026-12-05' };
    expect(ciclo(cicloDaDataVirada(utc('2026-12-10'), k(FECHA, VENCE), viradas))).toMatchObject({ ref: '2027-02-01' });
  });

  it('O VENCIMENTO NÃO SE MEXE — fecha 25 e vence 20, virada dia 17', () => {
    // Era a armadilha: tratar a virada como fechamento novo. A fatura 12/2026
    // fecha 25/12 e vence 20/01, porque dia 20 vem ANTES do fechamento. Com a
    // virada de 17/12 no lugar do fechamento, dia 20 passaria a vir DEPOIS e o
    // vencimento cairia em 20/12 — um mês antes, com a fatura quase vencida ao
    // nascer.
    const viradas = { '2026-12': '2026-12-17' };
    expect(ciclo(datasDoCiclo(2026, 11, 25, 20))).toEqual({ ref: '2026-12-01', fecha: '2026-12-25', vence: '2027-01-20' });
    // A compra de 18/12 vai para a fatura de janeiro, com as datas de janeiro.
    expect(ciclo(cicloDaDataVirada(utc('2026-12-18'), k(25, 20), viradas))).toEqual({
      ref: '2027-01-01',
      fecha: '2027-01-25',
      vence: '2027-02-20',
    });
  });

  it('a virada atravessa a virada do ano', () => {
    const viradas = { '2027-01': '2026-12-20' };
    expect(ciclo(cicloDaDataVirada(utc('2026-12-28'), k(FECHA, VENCE), viradas))).toMatchObject({ ref: '2027-02-01' });
  });
});

describe('billing-cycle — o ciclo como LINHA DO TEMPO', () => {
  // O caso do Itaú: o vencimento muda de seis em seis meses, e o fechamento
  // vai junto. Fecha 1 / vence 10 até a fatura de janeiro; de fevereiro em
  // diante, fecha 10 / vence 20.
  const periodo = (validFrom: string, closingDay: number, dueDay: number) => ({
    validFrom: utc(validFrom),
    closingDay,
    dueDay,
  });
  const itau = {
    closingDay: 10, // o período de AGORA, como fica na coluna do cartão
    dueDay: 20,
    cycles: [periodo('1900-01-01', 1, 10), periodo('2027-02-01', 10, 20)],
  };

  it('a fatura ANTERIOR à troca mantém as datas que sempre teve', () => {
    expect(ciclo(datasDoMesChave('2027-01', itau))).toEqual({
      ref: '2027-01-01',
      fecha: '2027-01-01',
      vence: '2027-01-10',
    });
  });

  it('a fatura da troca em diante usa os dias novos', () => {
    expect(ciclo(datasDoMesChave('2027-02', itau))).toEqual({
      ref: '2027-02-01',
      fecha: '2027-02-10',
      vence: '2027-02-20',
    });
    expect(ciclo(datasDoMesChave('2027-03', itau))).toMatchObject({ fecha: '2027-03-10', vence: '2027-03-20' });
  });

  it('a fatura da virada fica MAIS LONGA, como no banco', () => {
    // Ela junta de 02/01 a 10/02: a compra de 05/01 já é dela (5 > 1, o
    // fechamento de janeiro), e a de 05/02 também (5 <= 10).
    expect(ciclo(cicloDaData(utc('2027-01-05'), itau))).toMatchObject({ ref: '2027-02-01' });
    expect(ciclo(cicloDaData(utc('2027-02-05'), itau))).toMatchObject({ ref: '2027-02-01' });
    // E a primeira depois dela fecha em março.
    expect(ciclo(cicloDaData(utc('2027-02-15'), itau))).toMatchObject({ ref: '2027-03-01' });
  });

  it('a compra ANTES da troca continua caindo onde caía', () => {
    expect(ciclo(cicloDaData(utc('2026-12-20'), itau))).toMatchObject({ ref: '2027-01-01', fecha: '2027-01-01' });
    expect(ciclo(cicloDaData(utc('2027-01-01'), itau))).toMatchObject({ ref: '2027-01-01' });
  });

  it('puxando o fechamento para TRÁS, a fatura da virada fica mais curta', () => {
    // O contrário: fecha 10 até janeiro, fecha 1 de fevereiro em diante.
    const invertido = {
      closingDay: 1,
      dueDay: 10,
      cycles: [periodo('1900-01-01', 10, 17), periodo('2027-02-01', 1, 10)],
    };
    // Fevereiro junta de 11/01 a 01/02 — vinte dias.
    expect(ciclo(cicloDaData(utc('2027-01-15'), invertido))).toMatchObject({ ref: '2027-02-01', fecha: '2027-02-01' });
    expect(ciclo(cicloDaData(utc('2027-02-01'), invertido))).toMatchObject({ ref: '2027-02-01' });
    // E nada fica sem fatura nem em duas: 02/02 já é março.
    expect(ciclo(cicloDaData(utc('2027-02-02'), invertido))).toMatchObject({ ref: '2027-03-01' });
  });

  it('não há buraco nem sobreposição em nenhum dia do ano da troca', () => {
    // Todo dia de 2027 cai em exatamente uma fatura, e as faturas saem em
    // ordem. É a prova de que a troca não perde nem duplica compra.
    let anterior = '';
    for (let mes = 0; mes < 12; mes++) {
      for (let dia = 1; dia <= diasNoMes(2027, mes); dia++) {
        const ref = ciclo(cicloDaData(new Date(Date.UTC(2027, mes, dia)), itau)).ref;
        expect(ref >= anterior).toBe(true);
        anterior = ref;
      }
    }
  });

  it('sem linha do tempo, valem as colunas do cartão — o caminho de sempre', () => {
    const semHistorico = { closingDay: 10, dueDay: 17 };
    expect(ciclo(datasDoMesChave('2027-02', semHistorico))).toEqual(ciclo(datasDoCiclo(2027, 1, 10, 17)));
  });

  it('fatura anterior ao primeiro período usa o período mais antigo', () => {
    // Fatura importada de antes do cadastro do cartão: sem isto ela ficaria
    // sem dias e a conta estouraria.
    const tardio = { closingDay: 10, dueDay: 20, cycles: [periodo('2027-02-01', 10, 20)] };
    expect(ciclo(datasDoMesChave('2026-05', tardio))).toMatchObject({ fecha: '2026-05-10', vence: '2026-05-20' });
  });

  it('a ordem em que os períodos chegam não muda o resultado', () => {
    const baralhado = { closingDay: 10, dueDay: 20, cycles: [periodo('2027-02-01', 10, 20), periodo('1900-01-01', 1, 10)] };
    expect(ciclo(datasDoMesChave('2027-01', baralhado))).toEqual(ciclo(datasDoMesChave('2027-01', itau)));
    expect(ciclo(datasDoMesChave('2027-02', baralhado))).toEqual(ciclo(datasDoMesChave('2027-02', itau)));
  });
});
