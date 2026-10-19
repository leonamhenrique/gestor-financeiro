// ============================================================
// asaas-payment-provider.spec.ts
// ============================================================
// O que se prova aqui é o que machuca se estiver errado: dinheiro liberado
// sem pagamento, pagamento recebido e não creditado, e CPF entrando no banco
// sem ninguém pedir.
// ============================================================

import { UnauthorizedException } from '@nestjs/common';
import { AsaasPaymentProvider, EVENTO_DO_ASAAS } from './asaas-payment-provider';

const TOKEN = 'token-de-webhook-com-32-caracteres-ok';
const CHAVE = '$aact_hmlg_chave-de-sandbox';

/** Um `fetch` de mentira que grava o que foi chamado e devolve o combinado. */
function fetchFalso(resposta: unknown, ok = true, status = 200) {
  const chamadas: { url: string; init: any }[] = [];
  const f = (async (url: string, init: any) => {
    chamadas.push({ url, init });
    return {
      ok,
      status,
      text: async () => JSON.stringify(resposta),
    } as any;
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

const corpo = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8');

describe('AsaasPaymentProvider — webhook', () => {
  const gateway = (buscar?: typeof fetch) =>
    new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', buscar ?? (fetch as any));

  it('recusa token errado', () => {
    expect(() => gateway().lerWebhook(corpo({ event: 'PAYMENT_RECEIVED' }), 'outro')).toThrow(
      UnauthorizedException,
    );
  });

  it('recusa token vazio: sem isso, qualquer POST anônimo liberaria conta', () => {
    expect(() => gateway().lerWebhook(corpo({ event: 'PAYMENT_RECEIVED' }), '')).toThrow(
      UnauthorizedException,
    );
  });

  // Um token que começa igual não pode passar, e nem demorar mais para ser
  // recusado — é assim que se descobre um segredo byte a byte.
  it('recusa token com o prefixo certo e o resto errado', () => {
    const quase = TOKEN.slice(0, -1) + 'X';
    expect(() => gateway().lerWebhook(corpo({ event: 'PAYMENT_RECEIVED' }), quase)).toThrow(
      UnauthorizedException,
    );
  });

  it('recusa token mais curto que o verdadeiro', () => {
    expect(() => gateway().lerWebhook(corpo({ event: 'PAYMENT_RECEIVED' }), TOKEN.slice(0, 10))).toThrow(
      UnauthorizedException,
    );
  });

  it('sem ASAAS_WEBHOOK_TOKEN configurado, recusa tudo', () => {
    const sem = new AsaasPaymentProvider(CHAVE, '', 'https://api-sandbox.asaas.com/v3', fetch as any);
    expect(() => sem.lerWebhook(corpo({ event: 'PAYMENT_RECEIVED' }), 'qualquer')).toThrow(
      /não configurado/,
    );
  });

  it('corpo que não é JSON não derruba o processo', () => {
    expect(() => gateway().lerWebhook(Buffer.from('nem json'), TOKEN)).toThrow(UnauthorizedException);
  });

  it('traduz o evento e extrai os ids que ligam ao nosso lado', () => {
    const e = gateway().lerWebhook(
      corpo({
        id: 'evt_123',
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_9', subscription: 'sub_7', customer: 'cus_3', value: 29.9 },
      }),
      TOKEN,
    );
    expect(e.type).toBe('invoice.paid');
    expect(e.providerEventId).toBe('evt_123');
    expect(e.providerSubscriptionId).toBe('sub_7');
    expect(e.providerInvoiceId).toBe('pay_9');
  });

  // Sem id de evento não há idempotência, e o Asaas reenvia até receber 2xx:
  // o mesmo pagamento entraria duas vezes. Na falta dele, monta-se uma chave
  // estável a partir do que veio.
  it('sem id de evento, a chave de idempotência ainda é estável', () => {
    const sem = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9' } };
    const a = gateway().lerWebhook(corpo(sem), TOKEN).providerEventId;
    const b = gateway().lerWebhook(corpo(sem), TOKEN).providerEventId;
    expect(a).toBe(b);
    expect(a).toContain('pay_9');
  });

  it('evento desconhecido passa com o nome original, sem explodir', () => {
    const e = gateway().lerWebhook(corpo({ id: 'evt_1', event: 'ALGO_NOVO_DO_ASAAS' }), TOKEN);
    expect(e.type).toBe('ALGO_NOVO_DO_ASAAS');
  });

  it('campo desconhecido no corpo é ignorado, não quebra', () => {
    const e = gateway().lerWebhook(
      corpo({ id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'p' }, campoNovo: { a: 1 } }),
      TOKEN,
    );
    expect(e.type).toBe('invoice.paid');
  });
});

// Este corpo foi CAPTURADO do sandbox, não inventado: é o que o Asaas mandou
// de verdade quando o pagamento foi confirmado. O campo que importa é o
// `checkoutSession` -- sem ele, um pagamento confirmado não teria dono.
describe('AsaasPaymentProvider — o corpo real do sandbox', () => {
  const REAL = {
    id: 'evt_15e444ff9b9ab9ec29294aa1abe68025&22608140',
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_sko5lepb9lp0diap', value: 29.9, status: 'CONFIRMED',
      customer: 'cus_000009559085', subscription: 'sub_uybena3fkql8mjxa',
      checkoutSession: '88a7718b-037a-4294-ba38-e77081393ac0',
      billingType: 'CREDIT_CARD', externalReference: null,
    },
  };

  it('extrai os três ids que ligam o pagamento à conta', () => {
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', fetch as any);
    const e = g.lerWebhook(corpo(REAL), TOKEN);
    expect(e.type).toBe('invoice.paid');
    expect(e.providerInvoiceId).toBe('pay_sko5lepb9lp0diap');
    expect(e.providerSubscriptionId).toBe('sub_uybena3fkql8mjxa');
    expect(e.providerCheckoutId).toBe('88a7718b-037a-4294-ba38-e77081393ac0');
  });

  // O id do evento do Asaas traz um `&` no meio. Serve de chave de
  // idempotência do mesmo jeito, mas não pode ser mexido no caminho.
  it('o id do evento passa inteiro, com o "&" e tudo', () => {
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', fetch as any);
    expect(g.lerWebhook(corpo(REAL), TOKEN).providerEventId).toBe(REAL.id);
  });

  // O CHECKOUT_PAID chegou no MESMO milissegundo do pagamento e não cita
  // cobrança nenhuma: sem id de cobrança não há o que conferir contra a API.
  // Por isso quem libera acesso é o evento de pagamento, não o de checkout.
  it('o evento de checkout não traz cobrança — e por isso não libera nada', () => {
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', fetch as any);
    const e = g.lerWebhook(
      corpo({ id: 'evt_2', event: 'CHECKOUT_PAID', checkout: { id: 'chk_1', status: 'PAID' } }),
      TOKEN,
    );
    expect(e.type).toBe('checkout.paid');
    expect(e.providerInvoiceId).toBeUndefined();
  });
});

describe('AsaasPaymentProvider — tradução de eventos', () => {
  // Pagar é pagar: o Asaas separa "confirmado" (pagou) de "recebido" (o
  // dinheiro caiu na conta dele), e esperar o repasse para liberar seria
  // cobrar hoje e entregar depois de amanhã.
  it('confirmado e recebido liberam igual', () => {
    expect(EVENTO_DO_ASAAS.PAYMENT_CONFIRMED).toBe('invoice.paid');
    expect(EVENTO_DO_ASAAS.PAYMENT_RECEIVED).toBe('invoice.paid');
  });

  it('vencido e cartão recusado viram falha de pagamento, não cancelamento', () => {
    for (const e of [
      'PAYMENT_OVERDUE',
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
    ]) {
      expect(EVENTO_DO_ASAAS[e]).toBe('invoice.payment_failed');
    }
  });

  // Chargeback é o dinheiro voltando pela mão do banco, sem passar por nós.
  // Ignorar deixaria a assinatura ATIVA com o valor já perdido. PAST_DUE e
  // não CANCELED porque a disputa ainda pode ser ganha — e PAST_DUE é
  // reversível: bloqueia criar registro novo e não apaga nada.
  it('chargeback pedido bloqueia, mas não fecha a assinatura', () => {
    expect(EVENTO_DO_ASAAS.PAYMENT_CHARGEBACK_REQUESTED).toBe('invoice.payment_failed');
  });

  // A disputa em si não muda nada: o bloqueio já veio no pedido, e o
  // desfecho chega como estorno (perdemos) ou reversão (ganhamos).
  it('a disputa e a espera de reversão não mexem no estado', () => {
    expect(EVENTO_DO_ASAAS.PAYMENT_CHARGEBACK_DISPUTE).toBeUndefined();
    expect(EVENTO_DO_ASAAS.PAYMENT_AWAITING_CHARGEBACK_REVERSAL).toBeUndefined();
  });

  // O dinheiro voltou, então o acesso acaba. Parcial entra junto: não há
  // meio-acesso para dar.
  it('estorno total e parcial encerram a assinatura', () => {
    expect(EVENTO_DO_ASAAS.PAYMENT_REFUNDED).toBe('subscription.canceled');
    expect(EVENTO_DO_ASAAS.PAYMENT_PARTIALLY_REFUNDED).toBe('subscription.canceled');
  });

  it('nenhum evento de pagamento vira "pago" por engano', () => {
    const pagam = Object.entries(EVENTO_DO_ASAAS)
      .filter(([, destino]) => destino === 'invoice.paid')
      .map(([origem]) => origem);
    expect(pagam.sort()).toEqual(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
  });
});

describe('AsaasPaymentProvider — checkout hospedado', () => {
  it('não manda dado de cliente: quem pede o CPF é a tela do Asaas', async () => {
    const { f, chamadas } = fetchFalso({ id: 'chk_1', link: 'https://asaas/x' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);

    const r = await g.criarCheckout({
      userId: 'u1', nome: 'Henrique', email: 'h@x.com',
      planoCode: 'pro-mensal', planoNome: 'Pro', valor: 29.9, intervalo: 'MONTHLY',
      urlSucesso: 'https://saldonline.com.br/ok', urlCancelamento: 'https://saldonline.com.br/nao',
    });

    expect(r).toEqual({ providerCheckoutId: 'chk_1', url: 'https://asaas/x' });
    const enviado = JSON.parse(chamadas[0].init.body);
    expect(enviado.customer).toBeUndefined();
    expect(enviado.customerData).toBeUndefined();
    expect(JSON.stringify(enviado)).not.toContain('cpf');
    // A etiqueta que diz de quem é a compra vai junto, como segunda via.
    expect(enviado.externalReference).toBe('u1');
    expect(enviado.chargeTypes).toEqual(['RECURRENT']);
  });

  it('o valor cobrado é o do nosso catálogo, não um plano do gateway', async () => {
    const { f, chamadas } = fetchFalso({ id: 'chk_1', link: 'https://asaas/x' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await g.criarCheckout({
      userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'pro-anual', planoNome: 'Pro anual',
      valor: 299, intervalo: 'YEARLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
    });
    const enviado = JSON.parse(chamadas[0].init.body);
    expect(enviado.items[0].value).toBe(299);
    expect(enviado.subscription.cycle).toBe('YEARLY');
  });

  it('a chave de API vai no cabeçalho, nunca na URL', async () => {
    const { f, chamadas } = fetchFalso({ id: 'chk_1', link: 'https://asaas/x' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await g.criarCheckout({
      userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
      valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
    });
    expect(chamadas[0].init.headers.access_token).toBe(CHAVE);
    expect(chamadas[0].url).not.toContain(CHAVE);
  });

  it('resposta sem link é erro, e não um checkout mudo', async () => {
    const { f } = fetchFalso({ id: 'chk_1' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await expect(
      g.criarCheckout({
        userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
        valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
      }),
    ).rejects.toThrow(/sem id ou sem link/);
  });

  it('erro do Asaas chega com a descrição dele, não só o código', async () => {
    const { f } = fetchFalso({ errors: [{ code: 'invalid_value', description: 'Valor inválido' }] }, false, 400);
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await expect(
      g.criarCheckout({
        userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
        valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
      }),
    ).rejects.toThrow(/Valor inválido/);
  });

  // Não existe leitura de checkout no Asaas — `GET /checkouts/{id}` responde
  // 404, medido no sandbox. Quem dá a verdade é a COBRANÇA, e ela traz o
  // `checkoutSession`, que é o elo com a tela que o usuário abriu aqui.
  it('a verdade vem da COBRANÇA, e ela traz o checkout que a originou', async () => {
    const { f, chamadas } = fetchFalso({
      status: 'CONFIRMED', value: 29.9, subscription: 'sub_2', customer: 'cus_1',
      checkoutSession: 'chk_1',
    });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    const r = await g.consultarCobranca('pay_9');

    expect(chamadas[0].init.method).toBe('GET');
    expect(chamadas[0].url).toContain('/payments/pay_9');
    expect(r).toEqual({
      pago: true, valor: 29.9,
      providerSubscriptionId: 'sub_2', providerCustomerId: 'cus_1', providerCheckoutId: 'chk_1',
    });
  });

  it.each([
    ['CONFIRMED', true],
    ['RECEIVED', true],
    ['PENDING', false],
    ['OVERDUE', false],
    ['REFUNDED', false],
  ])('cobrança %s conta como paga: %s', async (status, pago) => {
    const { f } = fetchFalso({ status, value: 29.9 });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await expect(g.consultarCobranca('pay_9')).resolves.toEqual(expect.objectContaining({ pago }));
  });
});

// Testar contra a conta de verdade cobra gente de verdade. O erro e barato
// de evitar e caro de descobrir depois.
describe('AsaasPaymentProvider — sandbox e produção não se misturam', () => {
  const { f } = fetchFalso({ id: 'chk_1', link: 'https://x' });
  const abrir = (g: AsaasPaymentProvider) =>
    g.criarCheckout({
      userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
      valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
    });

  it('recusa chave de PRODUÇÃO apontada para o sandbox', async () => {
    const g = new AsaasPaymentProvider('$aact_prod_xxx', TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await expect(abrir(g)).rejects.toThrow(/não é de sandbox/);
  });

  it('recusa chave de SANDBOX apontada para produção — o erro caro', async () => {
    const g = new AsaasPaymentProvider('$aact_hmlg_xxx', TOKEN, 'https://api.asaas.com/v3', f);
    await expect(abrir(g)).rejects.toThrow(/aponta para produção/);
  });

  it('deixa passar quando os dois combinam', async () => {
    const g = new AsaasPaymentProvider('$aact_hmlg_xxx', TOKEN, 'https://api-sandbox.asaas.com/v3', f);
    await expect(abrir(g)).resolves.toEqual(expect.objectContaining({ providerCheckoutId: 'chk_1' }));
  });

  it('a aplicação se identifica, como o Asaas pede', async () => {
    const { f: f2, chamadas } = fetchFalso({ id: 'chk_1', link: 'https://x' });
    const g = new AsaasPaymentProvider('$aact_hmlg_xxx', TOKEN, 'https://api-sandbox.asaas.com/v3', f2);
    await abrir(g);
    expect(chamadas[0].init.headers['User-Agent']).toBe('saldonline');
  });
});

describe('AsaasPaymentProvider — o que ele se recusa a fazer', () => {
  const g = () => new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api-sandbox.asaas.com/v3', fetch as any);

  // O app não coleta CPF: quem pede é a tela do Asaas. Chegar aqui sem ele
  // significa estar no caminho errado, e a mensagem diz qual é o certo.
  it('criar cliente sem CPF é recusado, apontando a saída', async () => {
    await expect(g().criarCliente({ userId: 'u1', nome: 'H', email: 'h@x.com' })).rejects.toThrow(
      /criarCheckout/,
    );
  });

  it('tokenizar cartão é recusado: nenhum dado de cartão passa por este servidor', async () => {
    await expect(g().registrarCartao()).rejects.toThrow(/nenhum dado de cartão/i);
  });

  it('sem chave de API, não tenta chamar o Asaas', async () => {
    const sem = new AsaasPaymentProvider('', TOKEN, 'https://api-sandbox.asaas.com/v3', fetch as any);
    await expect(sem.consultarCobranca('pay_1')).rejects.toThrow(/ASAAS_API_KEY/);
  });
});
