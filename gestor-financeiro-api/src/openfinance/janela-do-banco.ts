// ============================================================
// janela-do-banco.ts — até quando o banco do teste fica ligado
// ============================================================
// Cada consentimento de Open Finance é cobrado na NOSSA conta do provedor
// quando a conexão dá certo, e um consentimento que atravessa a virada do
// mês pode ser cobrado de novo. Conta que nunca pagou não pode gerar custo
// recorrente — então o banco de quem está no teste nunca chega vivo ao dia
// 1º: ele é desligado na manhã do último dia do mês.
//
// O PISO DE 10 DIAS
// Desligar no dia 31 quem conectou no dia 29 seria pagar a conexão e não
// colher nada: dois dias não mostram o app funcionando. Por isso, quem
// conecta sem ter 10 dias inteiros pela frente vai para o fim do mês
// SEGUINTE. Essa minoria custa duas cobranças, e isso é preço de aquisição.
//
// POR QUE TEXTO 'AAAA-MM-DD', E NÃO `Date`
// A regra é de CALENDÁRIO, no fuso do app. Fazer a conta em `Date` traz
// junto UTC e horário de verão, e o resultado erra por um dia nas bordas —
// que é exatamente onde esta regra vive. Comparar texto 'AAAA-MM-DD' não
// tem borda.
//
// ESTE ARQUIVO NÃO SABE DE PLANO
// Ele responde "até quando", não "para quem". Quem decide que a regra vale
// para esta conexão é quem tem o plano na mão — hoje o agendador.
// ============================================================

/** Dias inteiros que uma conexão nova precisa ter pela frente no mês. */
export const DIAS_MINIMOS_DE_BANCO = 10;

/** Quantos dias tem o mês. `Date.UTC(a, m, 0)` é o último dia do mês `m`. */
export function diasDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** `n` dias depois (ou antes, com `n` negativo) de um dia de calendário. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/**
 * Em que manhã o banco desta conexão é desligado.
 *
 * `dia` é o dia de calendário em que a conexão foi AUTORIZADA — não o da
 * tentativa: o provedor só cobra quando o banco confirma.
 *
 * Devolve o último dia do mês, ou o do mês seguinte quando não sobram 10
 * dias inteiros. É de propósito que o desligamento caia no último dia e não
 * no dia 1º: o trabalho roda às 6h, e no dia 1º a cobrança do mês novo já
 * pode ter sido emitida.
 */
export function diaDoDesligamento(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  const ultimo = diasDoMes(a, m);
  if (ultimo - d >= DIAS_MINIMOS_DE_BANCO) return `${a}-${pad(m)}-${pad(ultimo)}`;
  const aa = m === 12 ? a + 1 : a;
  const mm = m === 12 ? 1 : m + 1;
  return `${aa}-${pad(mm)}-${pad(diasDoMes(aa, mm))}`;
}

/** Três dias antes do desligamento: o dia de avisar. */
export function diaDoAvisoDeDesligamento(dia: string): string {
  return somarDias(diaDoDesligamento(dia), -3);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
