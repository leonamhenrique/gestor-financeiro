// ============================================================
// series.utils.ts
// ============================================================
// Datas das ocorrências de uma série. Funções puras, em UTC (mesma
// convenção das colunas @db.Date — ver credit-cards/billing-cycle.ts).
//
// Cada ocorrência é calculada a partir da data ORIGINAL, nunca da anterior.
// Andar de uma em uma faz o dia 31 "grudar" no 28: 31/01 → 28/02 → 28/03.
// A partir da original: 31/01 → 28/02 → 31/03 → 30/04 → 31/05.
// ============================================================

import { SeriesFrequency } from '@prisma/client';
import { diasNoMes } from '../credit-cards/billing-cycle';

export const MIN_OCORRENCIAS = 2;
export const MAX_OCORRENCIAS = 60;

function somarMeses(inicio: Date, meses: number): Date {
  const alvoMes = inicio.getUTCMonth() + meses;
  const ano = inicio.getUTCFullYear() + Math.floor(alvoMes / 12);
  const mes0 = ((alvoMes % 12) + 12) % 12;
  return new Date(Date.UTC(ano, mes0, Math.min(inicio.getUTCDate(), diasNoMes(ano, mes0))));
}

/** Data da ocorrência `i` (0 = a primeira, que é a própria data inicial). */
export function dataDaOcorrencia(inicio: Date, frequencia: SeriesFrequency, i: number): Date {
  switch (frequencia) {
    case SeriesFrequency.BIWEEKLY:
      return new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate() + 15 * i));
    case SeriesFrequency.QUARTERLY:
      return somarMeses(inicio, 3 * i);
    case SeriesFrequency.YEARLY:
      return somarMeses(inicio, 12 * i);
    case SeriesFrequency.MONTHLY:
    default:
      return somarMeses(inicio, i);
  }
}

/**
 * A mesma data, no mês `mes` ('AAAA-MM'). O DIA é mantido — é o que faz a
 * parcela antecipada cair no mesmo dia do mês das outras, em vez de no dia 1.
 *
 * Dia que não existe no mês de destino cai no último válido, pela mesma
 * regra do resto da série: 31/03 antecipada para fevereiro vira 28/02.
 */
export function moverParaOMes(data: Date, mes: string): Date {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m - 1, Math.min(data.getUTCDate(), diasNoMes(ano, m - 1))));
}

/**
 * O mês 'AAAA-MM' deslocado de `meses`, como data do dia 1 em UTC.
 *
 * Mês não tem dia para escorregar, então a conta é só de calendário: o
 * `Date.UTC` normaliza 2026-13 para 2027-01 sozinho.
 */
export function somarMesesNoMes(mes: string, meses: number): Date {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + meses, 1));
}

/** 'AAAA-MM' → dia 1 desse mês em UTC (como fica gravado o mês da fatura). */
export function mesParaData(mes: string): Date {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, 1));
}

export function dataParaMes(d: Date): string {
  return d.toISOString().slice(0, 7);
}
