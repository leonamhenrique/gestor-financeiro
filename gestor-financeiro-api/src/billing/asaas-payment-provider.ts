// ============================================================
// asaas-payment-provider.ts
// ============================================================
// O gateway da cobrança pela WEB. (A cobrança dentro do app Android é outra:
// lá a política do Google Play exige o faturamento do Play, e quem atende é
// outro caminho — ver o comentário de ASSINATURA_VISIVEL no app.)
//
// Três decisões que explicam o formato deste arquivo:
//
// 1. TELA HOSPEDADA, não formulário nosso. O Asaas exige CPF/CNPJ para criar
//    cliente, e este app não coleta CPF. Na tela do Asaas quem pede o CPF é o
//    próprio Asaas, direto ao pagador: o dado não entra no nosso banco, não
//    entra na declaração de Data Safety da Play e não vira mais um campo para
//    vazar. De quebra, nenhum número de cartão passa por aqui.
//
// 2. O WEBHOOK É GATILHO, NÃO VERDADE. A credencial do Asaas é um token FIXO
//    no cabeçalho `asaas-access-token` — não é assinatura do corpo. Ele prova
//    quem mandou, não que o conteúdo chegou intacto. Então nenhum valor do
//    corpo libera assinatura: o evento só diz "algo mudou no checkout X", e o
//    estado vem de uma consulta ao Asaas (`consultarCheckout`).
//
// 3. O NOME DO EVENTO É TRADUZIDO AQUI. O domínio fala `invoice.paid`,
//    `invoice.payment_failed` e `subscription.canceled`; o Asaas fala
//    `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE` e por aí. A tradução mora no
//    adaptador porque é ela que torna o BillingService independente de quem
//    cobra — trocar de gateway não pode mexer na regra de negócio.
// ============================================================

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import {
  AssinarInput,
  AssinaturaRemota,
  CartaoTokenizado,
  CheckoutRemoto,
  CobrancaRemota,
  CriarCheckoutInput,
  CriarClienteInput,
  EventoWebhook,
  PaymentProviderPort,
} from './payment-provider.port';

/** Ciclo da recorrência, no vocabulário do Asaas. */
const CICLO: Record<string, string> = { MONTHLY: 'MONTHLY', YEARLY: 'YEARLY' };

/**
 * De evento do Asaas para evento do domínio.
 *
 * `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` são coisas diferentes para o
 * Asaas — confirmado é "pagou", recebido é "o dinheiro caiu na conta Asaas" —
 * e a mesma para nós: em ambos o usuário pagou, e é isso que libera o acesso.
 * Esperar o repasse para liberar seria cobrar hoje e entregar depois de
 * amanhã.
 *
 * Estorno vira `subscription.canceled` e não uma fatura estornada a mais: o
 * dinheiro voltou, então o acesso acaba. Estorno PARCIAL entra junto de
 * propósito — parte do dinheiro voltou e não há meio-acesso para dar.
 */
export const EVENTO_DO_ASAAS: Record<string, string> = {
  PAYMENT_CONFIRMED: 'invoice.paid',
  PAYMENT_RECEIVED: 'invoice.paid',
  PAYMENT_OVERDUE: 'invoice.payment_failed',
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: 'invoice.payment_failed',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'invoice.payment_failed',
  PAYMENT_REFUNDED: 'subscription.canceled',
  PAYMENT_PARTIALLY_REFUNDED: 'subscription.canceled',
  SUBSCRIPTION_INACTIVATED: 'subscription.canceled',
  SUBSCRIPTION_DELETED: 'subscription.canceled',
  CHECKOUT_PAID: 'checkout.paid',
  CHECKOUT_CANCELED: 'checkout.canceled',
  CHECKOUT_EXPIRED: 'checkout.canceled',
};

/** O corpo do webhook, no mínimo que este adaptador usa. Campo desconhecido é
 * ignorado de propósito: o Asaas avisa que acrescenta atributos sem aviso, e
 * um parser estrito quebraria a fila inteira por causa de um campo novo. */
interface CorpoAsaas {
  id?: string;
  event?: string;
  payment?: {
    id?: string;
    subscription?: string;
    customer?: string;
    value?: number;
    dueDate?: string;
    /** O checkout que gerou esta cobrança. Medido no sandbox: é o único
     * campo que liga o pagamento à tela que o usuário abriu no nosso app. */
    checkoutSession?: string;
  };
  subscription?: { id?: string; customer?: string };
  checkout?: { id?: string; status?: string };
}

@Injectable()
export class AsaasPaymentProvider implements PaymentProviderPort {
  readonly nome = 'ASAAS' as const;
  readonly cabecalhoDeAutenticacao = 'asaas-access-token';

  constructor(
    private readonly apiKey = process.env.ASAAS_API_KEY ?? '',
    private readonly webhookToken = process.env.ASAAS_WEBHOOK_TOKEN ?? '',
    private readonly baseUrl = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3',
    private readonly buscar: typeof fetch = fetch,
    /** A documentação do Asaas marca `imageBase64` como obrigatório no item
     * da tela. Fica em variável de ambiente porque é arte, não regra: o
     * adaptador não deve carregar um PNG embutido no código. */
    private readonly itemImagemBase64 = process.env.ASAAS_ITEM_IMAGE_BASE64 ?? '',
  ) {}

  // ----------------------------------------------------------
  // Checkout hospedado
  // ----------------------------------------------------------

  /**
   * Abre a tela de pagamento. Repare no que NÃO vai no corpo: nem `customer`
   * nem `customerData`. Sem os dois, o Asaas pede os dados do pagador na
   * própria tela — que é exatamente o que se quer, porque o dado que falta é
   * o CPF e ele não deve passar por aqui.
   *
   * O preço vem do nosso catálogo e não de um plano cadastrado no Asaas: o
   * valor que o usuário vê na tela do app e o que ele paga saem da mesma
   * fonte, então não há como divergirem.
   */
  async criarCheckout(input: CriarCheckoutInput): Promise<CheckoutRemoto> {
    const corpo = {
      // CARTÃO e só. Não é escolha nossa: o Asaas recusa o checkout com
      // qualquer outro método quando o tipo é RECURRENT — "o método de
      // pagamento CREDIT_CARD é o único método de pagamento permitido para
      // operações RECURRENT". Pix exige tipo DETACHED, que é cobrança
      // avulsa: daria uma venda, não uma assinatura que se renova sozinha.
      billingTypes: ['CREDIT_CARD'],
      chargeTypes: ['RECURRENT'],
      minutesToExpire: 60,
      callback: { successUrl: input.urlSucesso, cancelUrl: input.urlCancelamento },
      items: [
        {
          name: input.planoNome,
          description: `Assinatura ${input.planoNome} — saldonline`,
          quantity: 1,
          value: input.valor,
          ...(this.itemImagemBase64 ? { imageBase64: this.itemImagemBase64 } : {}),
        },
      ],
      subscription: {
        cycle: CICLO[input.intervalo] ?? 'MONTHLY',
        nextDueDate: hojeISO(),
      },
      // Nossa etiqueta na compra. O Asaas pode não devolvê-la no webhook de
      // checkout, por isso ela é a SEGUNDA via: a primeira é o id do checkout,
      // que guardamos antes de o usuário sair do app.
      externalReference: input.userId,
    };

    const r = await this.chamar('POST', '/checkouts', corpo);
    if (!r.id || !r.link) {
      throw new Error('Asaas devolveu um checkout sem id ou sem link.');
    }
    return { providerCheckoutId: String(r.id), url: String(r.link) };
  }

  /**
   * A fonte da verdade sobre um pagamento.
   *
   * Não existe leitura de checkout no Asaas — `GET /checkouts/{id}` responde
   * 404, e a lista também. Medido no sandbox. O que dá para ler é a COBRANÇA,
   * e ela traz tudo que interessa, inclusive o `checkoutSession`: o id da
   * tela que a originou, que é o que liga a primeira cobrança ao usuário.
   *
   * `CONFIRMED` e `RECEIVED` contam como pago. São estados diferentes para o
   * Asaas — confirmado é "pagou", recebido é "o dinheiro caiu na conta
   * dele" — e o mesmo para nós: em ambos o usuário pagou.
   */
  async consultarCobranca(providerInvoiceId: string): Promise<CobrancaRemota> {
    const r = await this.chamar('GET', `/payments/${encodeURIComponent(providerInvoiceId)}`);
    return {
      pago: r.status === 'CONFIRMED' || r.status === 'RECEIVED',
      valor: Number(r.value ?? 0),
      providerSubscriptionId: textoOuNada(r.subscription),
      providerCustomerId: textoOuNada(r.customer),
      providerCheckoutId: textoOuNada(r.checkoutSession),
    };
  }

  // ----------------------------------------------------------
  // Cliente e assinatura pela API (sem tela hospedada)
  // ----------------------------------------------------------

  async criarCliente(input: CriarClienteInput): Promise<string> {
    // O Asaas recusa cliente sem CPF/CNPJ. Quem chegar aqui sem ele está no
    // caminho errado: a tela hospedada existe justamente para não precisarmos
    // pedir esse dado. A mensagem aponta a saída em vez de só reclamar.
    if (!input.cpfCnpj) {
      throw new Error(
        'O Asaas exige CPF/CNPJ para criar cliente, e este app não coleta CPF. Use `criarCheckout`, onde quem pede o dado é a tela do Asaas.',
      );
    }
    const r = await this.chamar('POST', '/customers', {
      name: input.nome,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
      externalReference: input.userId,
    });
    if (!r.id) throw new Error('Asaas devolveu um cliente sem id.');
    return String(r.id);
  }

  async registrarCartao(): Promise<CartaoTokenizado> {
    throw new Error(
      'Cartão não é tokenizado por aqui: o pagamento acontece na tela hospedada do Asaas, e nenhum dado de cartão passa por este servidor.',
    );
  }

  async criarAssinatura(input: AssinarInput): Promise<AssinaturaRemota> {
    const r = await this.chamar('POST', '/subscriptions', {
      customer: input.providerCustomerId,
      billingType: 'CREDIT_CARD',
      cycle: 'MONTHLY',
      externalReference: input.providerPlanCode,
    });
    if (!r.id) throw new Error('Asaas devolveu uma assinatura sem id.');
    return { providerSubscriptionId: String(r.id), status: 'INCOMPLETE' };
  }

  /**
   * O Asaas não tem "cancelar ao fim do período": ou a assinatura é removida,
   * ou segue gerando cobrança. Para honrar o período já pago, quem segura o
   * acesso até `currentPeriodEnd` é o nosso lado — por isso aqui a assinatura
   * é sempre removida, e `aoFimDoPeriodo` não muda a chamada.
   */
  async cancelarAssinatura(providerSubscriptionId: string): Promise<AssinaturaRemota> {
    await this.chamar('DELETE', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
    return { providerSubscriptionId, status: 'CANCELED' };
  }

  // ----------------------------------------------------------
  // Webhook
  // ----------------------------------------------------------

  /**
   * `cabecalhoAssinatura` aqui é o token fixo do `asaas-access-token`, e não
   * uma assinatura do corpo — ver o cabeçalho deste arquivo.
   *
   * A comparação é em tempo constante. Com `===`, o tempo de resposta vazia
   * quantos caracteres bateram, e um token se descobre byte a byte.
   */
  lerWebhook(corpoBruto: Buffer, cabecalhoAssinatura: string): EventoWebhook {
    if (!this.webhookToken) {
      throw new Error('ASAAS_WEBHOOK_TOKEN não configurado: sem ele o webhook aceitaria qualquer POST.');
    }
    if (!iguaisEmTempoConstante(cabecalhoAssinatura, this.webhookToken)) {
      throw new UnauthorizedException('Token do webhook inválido.');
    }

    let corpo: CorpoAsaas;
    try {
      corpo = JSON.parse(corpoBruto.toString('utf8')) as CorpoAsaas;
    } catch {
      throw new UnauthorizedException('Corpo do webhook não é JSON.');
    }

    const tipoAsaas = corpo.event ?? '';
    return {
      // Sem o id do evento não há idempotência, e o Asaas reenvia até receber
      // 2xx: o mesmo pagamento entraria duas vezes.
      providerEventId: corpo.id ?? `${tipoAsaas}:${corpo.payment?.id ?? corpo.checkout?.id ?? ''}`,
      type: EVENTO_DO_ASAAS[tipoAsaas] ?? tipoAsaas,
      payload: corpo,
      providerSubscriptionId: corpo.payment?.subscription ?? corpo.subscription?.id,
      providerInvoiceId: corpo.payment?.id,
      // Do pagamento vem o checkout que o originou — é ele que liga a
      // primeira cobrança ao usuário. No evento de checkout vem o id direto,
      // mas esse evento não serve para liberar nada: ele não cita a cobrança,
      // e sem cobrança não há o que conferir contra a API.
      providerCheckoutId: corpo.payment?.checkoutSession ?? corpo.checkout?.id,
    };
  }

  // ----------------------------------------------------------
  // HTTP
  // ----------------------------------------------------------

  /**
   * Chave de sandbox tem prefixo próprio (`$aact_hmlg_`); a de produção, não.
   * Trocar uma pela outra por engano dá 401 — chato, mas inofensivo — ou
   * algo bem pior: um teste rodando contra a conta de verdade, cobrando
   * gente de verdade. É barato recusar antes de a chamada sair.
   */
  private conferirAmbiente() {
    const ehSandbox = this.baseUrl.includes('sandbox');
    const chaveDeSandbox = this.apiKey.startsWith('$aact_hmlg_');
    if (ehSandbox && !chaveDeSandbox) {
      throw new Error(
        'ASAAS_BASE_URL aponta para o sandbox, mas a ASAAS_API_KEY não é de sandbox (ela começaria com $aact_hmlg_).',
      );
    }
    if (!ehSandbox && chaveDeSandbox) {
      throw new Error(
        'ASAAS_API_KEY é de sandbox, mas a ASAAS_BASE_URL aponta para produção. Teste contra https://api-sandbox.asaas.com/v3.',
      );
    }
  }

  private async chamar(metodo: string, caminho: string, corpo?: unknown): Promise<Record<string, any>> {
    if (!this.apiKey) throw new Error('ASAAS_API_KEY não configurada.');
    this.conferirAmbiente();
    const resposta = await this.buscar(this.baseUrl + caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        access_token: this.apiKey,
        // O Asaas pede que a aplicação se identifique. Serve para o suporte
        // deles achar as nossas chamadas quando algo der errado.
        'User-Agent': 'saldonline',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

    const texto = await resposta.text();
    const dados = texto ? (JSON.parse(texto) as Record<string, any>) : {};
    if (!resposta.ok) {
      // O Asaas devolve { errors: [{ code, description }] }. A descrição é
      // escrita para humano e é o que ajuda a resolver — repassá-la é melhor
      // do que um "400" seco no log.
      const motivo =
        (dados.errors as { description?: string }[] | undefined)?.map((e) => e.description).join('; ') ||
        `HTTP ${resposta.status}`;
      throw new Error(`Asaas recusou ${metodo} ${caminho}: ${motivo}`);
    }
    return dados;
  }
}

/** Hoje em AAAA-MM-DD, que é o formato de data do Asaas. */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function textoOuNada(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/** Comparação que não vaza o tamanho nem o prefixo que bateu. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(b, 'utf8');
  // `timingSafeEqual` exige tamanhos iguais, e o próprio throw vazaria o
  // tamanho. Compara-se então contra um buffer do tamanho certo, sempre.
  const z = Buffer.alloc(y.length);
  x.copy(z, 0, 0, Math.min(x.length, y.length));
  return timingSafeEqual(z, y) && x.length === y.length;
}
