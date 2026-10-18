// ============================================================
// fake-payment-provider.ts
// ============================================================
// Adaptador de desenvolvimento e teste. Não faz chamada externa e não move
// dinheiro — existe para o domínio de cobrança poder ser exercitado inteiro
// (inclusive o caminho do webhook) antes de haver contrato com um gateway.
//
// A verificação de assinatura aqui compara um segredo compartilhado. É fraca
// de propósito: serve para o fluxo ser testável, e para que o adaptador real
// tenha um lugar óbvio onde colocar a verificação de verdade (HMAC do corpo
// bruto, no formato de cada gateway).
// ============================================================

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AssinarInput,
  AssinaturaRemota,
  CartaoTokenizado,
  CobrancaRemota,
  CriarClienteInput,
  EventoWebhook,
  PaymentProviderPort,
} from './payment-provider.port';

@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  readonly nome = 'FAKE' as const;
  readonly cabecalhoDeAutenticacao = 'x-webhook-signature';

  async criarCliente(input: CriarClienteInput): Promise<string> {
    return `fake_cus_${input.userId.slice(0, 8)}`;
  }

  /**
   * O gateway de mentira também precisa saber responder "esta cobrança foi
   * paga?", senão o caminho que libera acesso — o único que confere contra o
   * gateway antes de agir — não poderia ser exercitado sem gateway real.
   *
   * Aqui tudo é dado por pago: no FAKE não existe cobrança de verdade para
   * desmentir. Quem quiser testar o caminho do "não pago" usa um dublê no
   * teste, que é o que o próprio BillingService faz.
   */
  async consultarCobranca(providerInvoiceId: string): Promise<CobrancaRemota> {
    return { pago: true, valor: 0, providerSubscriptionId: undefined, providerCheckoutId: providerInvoiceId };
  }

  async registrarCartao(_providerCustomerId: string, paymentToken: string): Promise<CartaoTokenizado> {
    // Um gateway real devolve bandeira e últimos 4 a partir do token.
    // O token de teste carrega isso no próprio nome: "fake_tok_visa_4242".
    const partes = paymentToken.split('_');
    return {
      providerToken: paymentToken,
      brand: partes[2] ?? 'visa',
      last4: partes[3] ?? '4242',
      expMonth: 12,
      expYear: new Date().getFullYear() + 3,
    };
  }

  async criarAssinatura(input: AssinarInput): Promise<AssinaturaRemota> {
    const fim = new Date();
    fim.setMonth(fim.getMonth() + 1);
    return {
      providerSubscriptionId: `fake_sub_${randomUUID().slice(0, 8)}`,
      status: 'ACTIVE',
      currentPeriodEnd: fim,
    };
  }

  async cancelarAssinatura(
    providerSubscriptionId: string,
    aoFimDoPeriodo: boolean,
  ): Promise<AssinaturaRemota> {
    return {
      providerSubscriptionId,
      status: aoFimDoPeriodo ? 'ACTIVE' : 'CANCELED',
    };
  }

  lerWebhook(corpoBruto: Buffer, cabecalhoAssinatura: string): EventoWebhook {
    const esperado = process.env.BILLING_WEBHOOK_SECRET;
    if (!esperado || cabecalhoAssinatura !== esperado) {
      throw new UnauthorizedException('Assinatura de webhook inválida.');
    }
    const corpo = JSON.parse(corpoBruto.toString('utf8'));
    return {
      providerEventId: corpo.id,
      type: corpo.type,
      payload: corpo,
      providerSubscriptionId: corpo.data?.subscriptionId,
      providerInvoiceId: corpo.data?.invoiceId,
    };
  }
}
