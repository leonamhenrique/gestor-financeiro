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

/**
 * Estados em que a conta cria registro sem mais perguntas.
 *
 * `INCOMPLETE` está aqui, e é o que corrige um tranco: ele quer dizer
 * "abriu a tela de pagamento e nunca concluiu". Quem desiste no checkout
 * tem de voltar exatamente para onde estava — antes de clicar não havia
 * assinatura nenhuma, e ninguém perde acesso por ter olhado o preço.
 *
 * O bloqueio é para quem assinou e PAROU de pagar (`PAST_DUE`), não para
 * quem nunca pagou.
 */
const LIBERADOS: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.INCOMPLETE,
];

/**
 * Estados que DÃO os direitos do plano.
 *
 * `INCOMPLETE` não entra, e é toda a diferença entre esta lista e
 * `LIBERADOS`. As duas respondem a perguntas diferentes:
 *
 *   LIBERADOS     "esta assinatura BLOQUEIA criar registro?" — abrir o
 *                 checkout não pode bloquear nada, então INCOMPLETE libera.
 *   DAO_DIREITOS  "esta assinatura DÁ o plano?" — abrir o checkout e fechar
 *                 a aba não pode dar o Pro de graça.
 *
 * Usar uma lista para as duas perguntas foi um buraco de verdade, medido em
 * produção: bastava tocar em Assinar e voltar para a conta virar Pro aos
 * olhos do servidor — ganhando 5 bancos e 12 meses de histórico, perdendo o
 * contador de teste da tela, e nunca mais tendo o banco desligado no fim do
 * mês, que é custo recorrente nosso por alguém que não pagou.
 */
const DAO_DIREITOS: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
];

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
 * foi paga, então não há ciclo pago a honrar. É o único estado que bloqueia
 * — e bloqueia porque a pessoa já teve o serviço e deixou de pagar por ele.
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
 * Esta assinatura dá os direitos do plano?
 *
 * Sem assinatura, NÃO — ao contrário de `acessoLiberado`, onde "sem
 * assinatura" é liberado. Lá a pergunta é sobre bloqueio; aqui é sobre
 * conceder, e quem nunca passou pelo checkout não tem plano para conceder.
 *
 * Cancelada com ciclo pago correndo ainda dá: o dinheiro daquele ciclo
 * entrou, e tirar o acesso antes do fim seria ficar com o pagamento e o
 * serviço.
 */
export function assinaturaDaDireitos(
  assinatura: AssinaturaParaAcesso | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!assinatura) return false;
  if (DAO_DIREITOS.includes(assinatura.status)) return true;
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
