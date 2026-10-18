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
const CHAVE = 'chave-de-api';

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
    const sem = new AsaasPaymentProvider(CHAVE, '', 'https://x', fetch as any);
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
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);

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
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);
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
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);
    await g.criarCheckout({
      userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
      valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
    });
    expect(chamadas[0].init.headers.access_token).toBe(CHAVE);
    expect(chamadas[0].url).not.toContain(CHAVE);
  });

  it('resposta sem link é erro, e não um checkout mudo', async () => {
    const { f } = fetchFalso({ id: 'chk_1' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);
    await expect(
      g.criarCheckout({
        userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
        valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
      }),
    ).rejects.toThrow(/sem id ou sem link/);
  });

  it('erro do Asaas chega com a descrição dele, não só o código', async () => {
    const { f } = fetchFalso({ errors: [{ code: 'invalid_value', description: 'Valor inválido' }] }, false, 400);
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);
    await expect(
      g.criarCheckout({
        userId: 'u1', nome: 'H', email: 'h@x.com', planoCode: 'p', planoNome: 'P',
        valor: 10, intervalo: 'MONTHLY', urlSucesso: 'https://a', urlCancelamento: 'https://b',
      }),
    ).rejects.toThrow(/Valor inválido/);
  });

  it('consulta o estado no Asaas, que é de onde vem a verdade', async () => {
    const { f, chamadas } = fetchFalso({ status: 'PAID', customer: 'cus_1', subscription: 'sub_2' });
    const g = new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', f);
    const r = await g.consultarCheckout('chk_1');
    expect(chamadas[0].init.method).toBe('GET');
    expect(chamadas[0].url).toContain('/checkouts/chk_1');
    expect(r).toEqual({ status: 'PAID', providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_2' });
  });
});

describe('AsaasPaymentProvider — o que ele se recusa a fazer', () => {
  const g = () => new AsaasPaymentProvider(CHAVE, TOKEN, 'https://api/v3', fetch as any);

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
    const sem = new AsaasPaymentProvider('', TOKEN, 'https://api/v3', fetch as any);
    await expect(sem.consultarCheckout('chk_1')).rejects.toThrow(/ASAAS_API_KEY/);
  });
});
