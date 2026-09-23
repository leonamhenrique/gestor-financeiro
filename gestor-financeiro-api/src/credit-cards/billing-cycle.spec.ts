import { cicloDaData, cicloDoDia, datasDoCiclo, datasDoMesChave, diasNoMes } from './billing-cycle';

const utc = (s: string) => new Date(s + 'T00:00:00.000Z');
const dia = (d: Date) => d.toISOString().slice(0, 10);
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
    expect(ciclo(cicloDaData(utc('2026-09-28'), 28, 5))).toEqual({ ref: '2026-09-01', fecha: '2026-09-28', vence: '2026-10-05' });
    expect(ciclo(cicloDaData(utc('2026-09-29'), 28, 5))).toEqual({ ref: '2026-10-01', fecha: '2026-10-28', vence: '2026-11-05' });
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
    expect(ciclo(cicloDaData(utc('2026-02-28'), 31, 7))).toEqual({ ref: '2026-02-01', fecha: '2026-02-28', vence: '2026-03-07' });
    expect(ciclo(cicloDaData(utc('2026-03-01'), 31, 7))).toEqual({ ref: '2026-03-01', fecha: '2026-03-31', vence: '2026-04-07' });
  });

  it('fechamento dia 30 em ano bissexto: 29/02 entra em fevereiro', () => {
    expect(ciclo(cicloDaData(utc('2028-02-29'), 30, 8))).toMatchObject({ ref: '2028-02-01', fecha: '2028-02-29' });
  });

  it('fechamento dia 31 em abril é 30; a compra de 30/04 fica em abril', () => {
    expect(ciclo(cicloDaData(utc('2026-04-30'), 31, 7))).toMatchObject({ ref: '2026-04-01', fecha: '2026-04-30' });
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
    expect(ciclo(cicloDaData(utc('2026-12-29'), 28, 5))).toEqual({ ref: '2027-01-01', fecha: '2027-01-28', vence: '2027-02-05' });
  });

  it('fecha 10 e vence 17: compra de 20/12 cai em janeiro com as duas datas em janeiro', () => {
    expect(ciclo(cicloDaData(utc('2026-12-20'), 10, 17))).toEqual({ ref: '2027-01-01', fecha: '2027-01-10', vence: '2027-01-17' });
  });
});

describe('billing-cycle — entradas', () => {
  it('cicloDoDia usa o dia do calendário dado, sem fuso', () => {
    expect(ciclo(cicloDoDia('2026-09-11', 10, 17))).toMatchObject({ ref: '2026-10-01' });
  });

  it('datasDoMesChave recebe AAAA-MM', () => {
    expect(ciclo(datasDoMesChave('2026-02', 10, 31))).toEqual({ ref: '2026-02-01', fecha: '2026-02-10', vence: '2026-02-28' });
  });

  it('tudo sai em meia-noite UTC (convenção das colunas @db.Date)', () => {
    const c = datasDoCiclo(2026, 8, 28, 5);
    [c.referenceMonth, c.closingDate, c.dueDate].forEach((d) => expect(d.toISOString().endsWith('T00:00:00.000Z')).toBe(true));
  });
});
