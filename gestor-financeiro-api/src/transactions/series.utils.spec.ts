import { SeriesFrequency } from '@prisma/client';
import { dataDaOcorrencia, dataParaMes, mesParaData } from './series.utils';

const utc = (s: string) => new Date(s + 'T00:00:00.000Z');
const dias = (inicio: string, f: SeriesFrequency, n: number) =>
  Array.from({ length: n }, (_, i) => dataDaOcorrencia(utc(inicio), f, i).toISOString().slice(0, 10));

describe('dataDaOcorrencia', () => {
  it('mensal a partir do dia 31 não "gruda" no 28', () => {
    expect(dias('2026-01-31', SeriesFrequency.MONTHLY, 5)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('mensal atravessa a virada do ano', () => {
    expect(dias('2026-11-15', SeriesFrequency.MONTHLY, 3)).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
  });

  it('quinzenal soma 15 dias', () => {
    expect(dias('2026-09-20', SeriesFrequency.BIWEEKLY, 3)).toEqual(['2026-09-20', '2026-10-05', '2026-10-20']);
  });

  it('trimestral e anual (29/02 vira 28/02 fora do bissexto)', () => {
    expect(dias('2026-11-30', SeriesFrequency.QUARTERLY, 2)).toEqual(['2026-11-30', '2027-02-28']);
    expect(dias('2028-02-29', SeriesFrequency.YEARLY, 2)).toEqual(['2028-02-29', '2029-02-28']);
  });
});

describe('mesParaData / dataParaMes', () => {
  it('ida e volta', () => {
    expect(mesParaData('2026-12')).toEqual(utc('2026-12-01'));
    expect(dataParaMes(mesParaData('2027-01'))).toBe('2027-01');
  });
});
