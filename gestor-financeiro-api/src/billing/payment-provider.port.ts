// ============================================================
// payment-provider.port.ts
// ============================================================
// Contrato que todo gateway de pagamento precisa cumprir para servir a este
// sistema. O resto do backend fala só com esta interface — trocar de gateway
// vira escrever um adaptador novo, não reescrever o domínio.
//
// Duas coisas que esta interface deliberadamente NÃO expõe:
//
// 1. Nenhum método recebe número de cartão. A tokenização acontece no
//    navegador, contra o gateway, e o backend só vê o token resultante. Se
//    algum dia um método aqui aceitar PAN, o sistema inteiro entra no escopo
//    pesado do PCI-DSS.
//
// 2. Nenhum método "marca como pago". Quem decide se a cobrança aconteceu é
//    o gateway, e a notícia chega por webhook. Um método assim viraria porta
//    para liberar assinatura sem pagamento.
// ============================================================

export interface CriarClienteInput {
  userId: string;
  nome: string;
  email: string;
}

export interface AssinarInput {
  providerCustomerId: string;
  providerPlanCode: string;
  /** Token do cartão devolvido pelo SDK do gateway no navegador. */
  paymentToken: string;
}

export interface AssinaturaRemota {
  providerSubscriptionId: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';
  currentPeriodEnd?: Date;
}

/** Só o que é seguro guardar: o token e o suficiente para o usuário
 * reconhecer o cartão na tela. */
export interface CartaoTokenizado {
  providerToken: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export interface EventoWebhook {
  providerEventId: string;
  type: string;
  payload: unknown;
  providerSubscriptionId?: string;
  providerInvoiceId?: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProviderPort {
  readonly nome: 'STRIPE' | 'ASAAS' | 'MERCADO_PAGO' | 'FAKE';

  criarCliente(input: CriarClienteInput): Promise<string>;

  /** Vincula um token já gerado no navegador ao cliente do gateway. */
  registrarCartao(providerCustomerId: string, paymentToken: string): Promise<CartaoTokenizado>;

  criarAssinatura(input: AssinarInput): Promise<AssinaturaRemota>;

  cancelarAssinatura(providerSubscriptionId: string, aoFimDoPeriodo: boolean): Promise<AssinaturaRemota>;

  /**
   * Valida a assinatura criptográfica do webhook e devolve o evento.
   * Deve lançar se a assinatura não bater: sem isso, qualquer POST anônimo
   * liberaria uma conta inadimplente.
   */
  lerWebhook(corpoBruto: Buffer, cabecalhoAssinatura: string): EventoWebhook;
}
