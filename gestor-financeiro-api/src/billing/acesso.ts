// ============================================================
// acesso.ts
// ============================================================
// Quem pode criar registro novo, e até quando.
//
// A regra que importa aqui é a do CANCELAMENTO. Quem cancela no dia 3 um
// plano pago até o dia 30 não pode perder o acesso no dia 3: o mês foi pago.
// Vale igual para o anual — a regra é a DATA, não o tamanho do ciclo. Quem
// pagou doze meses e cancela no segundo segue até o fim dos doze.
//
// Cancelar quer dizer "não me cobre de novo", não "me tire agora".
// ============================================================

import { BillingInterval, SubscriptionStatus } from '@prisma/client';

/** Estados em que a conta cria registro sem mais perguntas. */
const LIBERADOS: SubscriptionStatus[] = [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE];

export interface AssinaturaParaAcesso {
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}

/**
 * Sem assinatura nenhuma, liberado: o bloqueio é para quem assinou e parou
 * de pagar, não para quem ainda não passou pelo checkout.
 *
 * `PAST_DUE` não entra na cortesia do período: ali a cobrança do ciclo NÃO
 * foi paga, então não há ciclo pago a honrar.
 */
export function acessoLiberado(
  assinatura: AssinaturaParaAcesso | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!assinatura) return true;
  if (LIBERADOS.includes(assinatura.status)) return true;

  // Cancelada, mas o ciclo pago ainda corre.
  return (
    assinatura.status === SubscriptionStatus.CANCELED &&
    assinatura.cancelAtPeriodEnd === true &&
    !!assinatura.currentPeriodEnd &&
    assinatura.currentPeriodEnd.getTime() > agora.getTime()
  );
}

/**
 * Até quando vale o que acabou de ser pago: o vencimento desta cobrança
 * mais um ciclo.
 *
 * Vem do vencimento CONFERIDO no gateway, não do corpo do webhook. E é
 * recalculado a cada pagamento, então se o dia da cobrança mudar lá, a data
 * daqui acompanha no ciclo seguinte.
 */
export function fimDoCicloPago(vencimento: Date, intervalo: BillingInterval): Date {
  // Mesma regra do resto do app, e para os dois intervalos: dia que não
  // existe no mês de destino cai no último VÁLIDO, em vez de escorregar para
  // o mês seguinte. 31/01 vira 28/02, e 29/02 mais um ano vira 28/02 — não
  // 03/03 nem 01/03.
  const dia = vencimento.getUTCDate();
  const meses = intervalo === BillingInterval.YEARLY ? 12 : 1;
  const alvo = new Date(Date.UTC(vencimento.getUTCFullYear(), vencimento.getUTCMonth() + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimo));
  return alvo;
}
