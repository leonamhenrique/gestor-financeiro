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
  /** CPF/CNPJ. Obrigatório em alguns gateways (Asaas), ausente em outros.
   * Opcional aqui porque este app NÃO coleta CPF: quem pede é a tela de
   * pagamento do gateway, e o dado nunca passa por nós. Ver `criarCheckout`. */
  cpfCnpj?: string;
}

/** O que precisa para abrir uma tela de pagamento HOSPEDADA pelo gateway. */
export interface CriarCheckoutInput {
  userId: string;
  nome: string;
  email: string;
  /** Código do plano no nosso catálogo — vira o item da tela. */
  planoCode: string;
  planoNome: string;
  valor: number;
  intervalo: 'MONTHLY' | 'YEARLY';
  /** Para onde o gateway devolve o usuário. Não confirmam pagamento: quem
   * confirma é o webhook. */
  urlSucesso: string;
  urlCancelamento: string;
}

export interface CheckoutRemoto {
  /** Id do checkout no gateway. É a PONTE: guardado antes de o usuário sair
   * do app, é como o webhook de volta encontra de quem era a compra. */
  providerCheckoutId: string;
  /** Endereço da tela de pagamento, para onde o navegador vai. */
  url: string;
}

/**
 * O que o gateway diz sobre uma cobrança quando PERGUNTADO — e não o que o
 * corpo do webhook afirma. É daqui que sai a decisão de liberar acesso.
 */
export interface CobrancaRemota {
  pago: boolean;
  valor: number;
  /** Vencimento desta cobrança. É dele que sai até quando vale o ciclo
   * pago — e, por consequência, até quando quem cancelou segue com acesso. */
  vencimento?: Date;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  /** A tela de pagamento que originou a cobrança. É por este id que a
   * PRIMEIRA cobrança encontra de quem ela é: nas seguintes, quem liga é a
   * assinatura, que a essa altura já está gravada do nosso lado. */
  providerCheckoutId?: string;
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
  /** Presente nos eventos de tela hospedada, onde a assinatura ainda não
   * existe: é por ele que o evento encontra de quem era a compra. */
  providerCheckoutId?: string;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentProviderPort {
  readonly nome: 'STRIPE' | 'ASAAS' | 'MERCADO_PAGO' | 'FAKE';

  /** Qual cabeçalho carrega a credencial do webhook. Cada gateway usa o seu
   * (`x-webhook-signature` no Stripe, `asaas-access-token` no Asaas), e quem
   * sabe disso é o adaptador — não o controlador. */
  readonly cabecalhoDeAutenticacao: string;

  /**
   * Abre uma tela de pagamento HOSPEDADA pelo gateway e devolve para onde
   * mandar o navegador. É o caminho que este app usa, e a razão é dupla:
   *
   *   PCI    número de cartão nunca encosta no nosso domínio nem no nosso
   *          servidor. Com tokenização no navegador ele também não encostaria,
   *          mas a tela hospedada tira até o formulário da nossa conta.
   *   CPF    o Asaas exige CPF/CNPJ para criar o cliente, e este app não
   *          coleta CPF. Na tela hospedada quem pede é o gateway, direto ao
   *          pagador — o dado não entra no nosso banco nem na Data Safety.
   *
   * Gateway que não tem tela hospedada simplesmente não implementa.
   */
  criarCheckout?(input: CriarCheckoutInput): Promise<CheckoutRemoto>;

  /**
   * Lê do GATEWAY o estado de uma cobrança, pelo id que o webhook citou.
   *
   * Existe porque o corpo do webhook não é fonte confiável: a credencial do
   * Asaas é um token fixo, que prova quem mandou e não que o conteúdo chegou
   * intacto. Então o webhook diz "olhe a cobrança X" e a verdade vem daqui.
   */
  consultarCobranca?(providerInvoiceId: string): Promise<CobrancaRemota>;

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
