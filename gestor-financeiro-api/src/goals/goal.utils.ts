// ============================================================
// goal.utils.ts
// ============================================================
// As contas de um objetivo, puras: dado o que foi guardado e o prazo, quanto
// falta e quanto precisa entrar por mês. Ficam separadas do serviço porque é
// aqui que mora a regra que o usuário lê na tela — e regra que se lê na tela
// é regra que precisa de teste.
// ============================================================

import { Prisma } from '@prisma/client';

export type Dinheiro = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);

export const dec = (v: unknown): Dinheiro =>
  v instanceof Prisma.Decimal ? v : new Prisma.Decimal((v as string | number) ?? 0);

export const emReais = (v: Dinheiro): string => v.toFixed(2);

/** Para a mensalidade sugerida, o centavo arredonda para CIMA. Guardar
 * 1.333,33 por três meses fecha em 3.999,99 e deixa a meta um centavo para
 * trás: o número que o app sugere precisa ser um número que, seguido à
 * risca, chega. */
const arredondandoParaCima = (v: Dinheiro): string => v.toFixed(2, Prisma.Decimal.ROUND_UP);

export interface MovimentoDoObjetivo {
  type: 'DEPOSIT' | 'WITHDRAW';
  amount: Dinheiro;
}

/**
 * O que o objetivo tem guardado: o saldo inicial mais o que entrou, menos o
 * que saiu.
 *
 * O saldo inicial entra AQUI e em nenhum total do app: ele é dinheiro que já
 * era do usuário antes do objetivo existir e que nunca passou pelas contas.
 * Somá-lo ao saldo geral criaria dinheiro do nada; ignorá-lo no progresso
 * mentiria sobre o quanto falta.
 */
export function saldoDoObjetivo(inicial: Dinheiro, movimentos: MovimentoDoObjetivo[]): Dinheiro {
  return movimentos.reduce(
    (s, m) => (m.type === 'DEPOSIT' ? s.plus(m.amount) : s.minus(m.amount)),
    dec(inicial),
  );
}

/**
 * Quanto do que foi guardado veio das CONTAS — é esta parte que continua
 * contando no saldo geral, porque saiu de um lugar que o app conhece.
 *
 * Nunca negativo, e o piso em zero é o que mantém o total honesto. Quem
 * resgata mais do que aplicou está tirando do saldo inicial — dinheiro que
 * existia fora das contas e que o total não contava. Ao cair numa conta, ele
 * passa a contar, e o total sobe exatamente nesse excedente: é dinheiro que
 * virou conhecido, não dinheiro que nasceu. Sem o piso, o excedente entraria
 * como dívida do objetivo e o total ficaria parado, escondendo a entrada.
 */
export function aplicadoDasContas(movimentos: MovimentoDoObjetivo[]): Dinheiro {
  return Prisma.Decimal.max(
    ZERO,
    movimentos.reduce(
      (s, m) => (m.type === 'DEPOSIT' ? s.plus(m.amount) : s.minus(m.amount)),
      ZERO,
    ),
  );
}

/** Meses inteiros de `de` até `ate`, contando o mês corrente como um mês que
 * ainda dá para usar. Nunca menos de 1: um prazo que termina hoje ainda pede
 * o valor todo, e dividir por zero não é resposta. */
export function mesesAte(de: Date, ate: Date): number {
  const meses =
    (ate.getUTCFullYear() - de.getUTCFullYear()) * 12 + (ate.getUTCMonth() - de.getUTCMonth());
  return Math.max(1, meses + 1);
}

export interface ProgressoDoObjetivo {
  saved: string;        // o que tem guardado (inclui o saldo inicial)
  remaining: string;    // quanto falta para a meta
  percent: number;      // 0..1
  monthsLeft: number;   // meses até o prazo, o corrente incluído
  monthlyTarget: string; // quanto precisa entrar por mês daqui para a frente
  onTrack: boolean;     // a meta ainda cabe no prazo pelo ritmo pedido
}

/**
 * A estimativa é DINÂMICA por construção: ela não guarda o valor calculado no
 * cadastro, recalcula `falta ÷ meses que restam` toda vez. Quem depositou
 * menos do que o sugerido vê o número do mês seguinte subir, no mesmo prazo —
 * que é exatamente o pedido. Quem depositou mais vê descer.
 *
 * Alcançada a meta, a mensalidade é zero: continuar pedindo dinheiro de quem
 * já chegou seria o app não saber ler o próprio número.
 */
export function progressoDoObjetivo(
  meta: Dinheiro,
  saldo: Dinheiro,
  hoje: Date,
  prazo: Date,
): ProgressoDoObjetivo {
  const falta = Prisma.Decimal.max(ZERO, dec(meta).minus(saldo));
  const meses = mesesAte(hoje, prazo);
  const percent = dec(meta).lessThanOrEqualTo(0)
    ? 0
    : Math.min(1, Math.max(0, Number(saldo.dividedBy(meta).toFixed(4))));
  return {
    saved: emReais(saldo),
    remaining: emReais(falta),
    percent,
    monthsLeft: meses,
    monthlyTarget: arredondandoParaCima(falta.dividedBy(meses)),
    // Fora do prazo e ainda faltando: o objetivo não cabe mais no que sobrou.
    onTrack: falta.lessThanOrEqualTo(0) || prazo >= hoje,
  };
}
