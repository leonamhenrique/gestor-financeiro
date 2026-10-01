// ============================================================
// format.ts
// ============================================================
// Os formatadores que os textos dos insights usam. Ficam separados porque
// a tela precisa dos MESMOS: um relatório que escreve "R$ 1.234" no texto
// e "1.234,00" na tabela ao lado parece dois relatórios.
//
// Não há pacote compartilhado neste repositório (a web é um HTML único),
// então a web copia estas regras em vez de importá-las. Qualquer mudança
// aqui precisa ir junto para lá.
// ============================================================

import { Dinheiro } from './report.utils';

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "R$ 9.100" — sem centavos, como a referência escreve nos textos. */
export function brl(v: Dinheiro): string {
  const inteiro = Math.round(Number(v.toFixed(2)));
  const sinal = inteiro < 0 ? '−' : '';
  return `${sinal}R$ ${Math.abs(inteiro).toLocaleString('pt-BR')}`;
}

/** "18,8%" a partir de uma fração (0,188). */
export function pct(fracao: number, casas = 1): string {
  return `${(fracao * 100).toFixed(casas).replace('.', ',')}%`;
}

/** "+21%" / "−6%" — com sinal explícito, para variação. */
export function pctComSinal(fracao: number, casas = 0): string {
  const n = fracao * 100;
  const sinal = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sinal}${Math.abs(n).toFixed(casas).replace('.', ',')}%`;
}

/** 'YYYY-MM' → "julho". */
export function nomeDoMes(chave: string): string {
  return MESES_PT[Number(chave.slice(5, 7)) - 1] ?? chave;
}

/** 'YYYY-MM' → "Julho". */
export function nomeDoMesMaiusculo(chave: string): string {
  const n = nomeDoMes(chave);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** 3 → "3º trimestre". */
export function nomeDoTrimestre(n: number): string {
  return `${n}º trimestre`;
}
