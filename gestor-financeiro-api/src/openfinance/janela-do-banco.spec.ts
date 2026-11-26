// ============================================================
// janela-do-banco.spec.ts
// ============================================================
// A regra inteira vive nas bordas: último dia do mês, fevereiro, virada de
// ano, e o limiar exato do piso de 10 dias. Um erro de um dia aqui é uma
// cobrança a mais no provedor, por conexão, para sempre.
// ============================================================

import {
  DIAS_MINIMOS_DE_BANCO,
  diaDoDesligamento,
  diaDoAvisoDeDesligamento,
  diasDoMes,
  somarDias,
} from './janela-do-banco';

describe('o banco do teste nunca chega vivo ao dia 1º', () => {
  it('conectou com folga: desliga no último dia DESTE mês', () => {
    expect(diaDoDesligamento('2026-11-05')).toBe('2026-11-30');
    expect(diaDoDesligamento('2026-12-01')).toBe('2026-12-31');
  });

  it('o limiar do piso é ter 10 dias inteiros pela frente', () => {
    // Novembro tem 30 dias. No dia 20 sobram 10 → fica.
    expect(diaDoDesligamento('2026-11-20')).toBe('2026-11-30');
    // No dia 21 sobram 9 → vai para dezembro.
    expect(diaDoDesligamento('2026-11-21')).toBe('2026-12-31');
  });

  it('o mês de 31 dias desloca o limiar junto', () => {
    expect(diaDoDesligamento('2026-12-21')).toBe('2026-12-31');
    expect(diaDoDesligamento('2026-12-22')).toBe('2027-01-31');
  });

  it('fevereiro curto encurta a janela, não a regra', () => {
    expect(diaDoDesligamento('2027-02-18')).toBe('2027-02-28');
    expect(diaDoDesligamento('2027-02-19')).toBe('2027-03-31');
  });

  it('fevereiro bissexto tem 29', () => {
    expect(diasDoMes(2028, 2)).toBe(29);
    expect(diaDoDesligamento('2028-02-19')).toBe('2028-02-29');
  });

  it('o último dia do ano empurra para janeiro do ano seguinte', () => {
    expect(diaDoDesligamento('2026-12-31')).toBe('2027-01-31');
  });

  it('quem conecta no último dia ainda ganha o mês inteiro seguinte', () => {
    // O piso existe para isto: um teste de zero dia não converte ninguém.
    const fim = diaDoDesligamento('2026-11-30');
    expect(fim).toBe('2026-12-31');
    expect(Number(fim.slice(8))).toBeGreaterThanOrEqual(DIAS_MINIMOS_DE_BANCO);
  });

  it('nunca devolve um dia anterior ao da autorização', () => {
    for (let mes = 1; mes <= 12; mes++) {
      for (let d = 1; d <= diasDoMes(2027, mes); d++) {
        const dia = `2027-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        expect(diaDoDesligamento(dia) > dia).toBe(true);
      }
    }
  });

  it('a janela tem sempre pelo menos 10 dias', () => {
    for (let mes = 1; mes <= 12; mes++) {
      for (let d = 1; d <= diasDoMes(2027, mes); d++) {
        const dia = `2027-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const fim = new Date(diaDoDesligamento(dia) + 'T00:00:00Z').getTime();
        const ini = new Date(dia + 'T00:00:00Z').getTime();
        expect((fim - ini) / 86400000).toBeGreaterThanOrEqual(DIAS_MINIMOS_DE_BANCO);
      }
    }
  });

  it('o desligamento cai sempre no último dia de um mês', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const dia = `2027-${String(mes).padStart(2, '0')}-07`;
      const fim = diaDoDesligamento(dia);
      const [a, m, d] = fim.split('-').map(Number);
      expect(d).toBe(diasDoMes(a, m));
    }
  });
});

describe('o aviso de três dias', () => {
  it('cai três dias antes, atravessando o mês quando precisa', () => {
    expect(diaDoAvisoDeDesligamento('2026-11-05')).toBe('2026-11-27');
    expect(diaDoAvisoDeDesligamento('2027-02-01')).toBe('2027-02-25');
  });

  it('somarDias atravessa virada de ano e ano bissexto', () => {
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2028-03-01', -1)).toBe('2028-02-29');
  });
});
