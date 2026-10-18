// ============================================================
// billing.service.spec.ts
// ============================================================
// O foco aqui são as três regras que, se quebradas, causam prejuízo real:
// liberar quem não pagou, cobrar duas vezes pelo mesmo evento, e cancelar
// uma assinatura que o gateway ainda ia retentar.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import { FakePaymentProvider } from './fake-payment-provider';
import { SubscriptionStatus, SubscriptionInvoiceStatus } from '@prisma/client';

function erroDeUnicidade() {
  const erro: Error & { code?: string } = new Error('Unique constraint failed');
  erro.code = 'P2002';
  return erro;
}

describe('BillingService', () => {
  let service: BillingService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      plan: { findUnique: jest.fn() },
      subscription: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
      subscriptionInvoice: { upsert: jest.fn() },
      paymentMethod: { updateMany: jest.fn(), upsert: jest.fn() },
      webhookEvent: { create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_PROVIDER, useValue: new FakePaymentProvider() },
      ],
    }).compile();

    service = modulo.get(BillingService);
  });

  describe('bloqueio parcial', () => {
    it('libera quem nunca assinou — o bloqueio é para inadimplente, não para quem não passou pelo checkout', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.podeCriarRegistros('u1')).resolves.toBe(true);
    });

    it.each([
      [SubscriptionStatus.ACTIVE, true],
      [SubscriptionStatus.TRIALING, true],
      [SubscriptionStatus.PAST_DUE, false],
      [SubscriptionStatus.CANCELED, false],
      [SubscriptionStatus.INCOMPLETE, false],
    ])('status %s → pode criar: %s', async (status, esperado) => {
      prisma.subscription.findUnique.mockResolvedValue({ status });
      await expect(service.podeCriarRegistros('u1')).resolves.toBe(esperado);
    });
  });

  describe('webhook', () => {
    const evento = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      providerSubscriptionId: 'fake_sub_1',
      providerInvoiceId: 'inv_1',
      payload: { data: { amount: 29.9, dueDate: '2026-10-05' } },
    };

    it('pagamento confirmado reativa a assinatura e registra a cobrança', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'w1' });
      prisma.subscription.findUnique.mockResolvedValue({ id: 's1' });

      await expect(service.aplicarEvento(evento)).resolves.toBe('aplicado');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.ACTIVE }),
        }),
      );
      expect(prisma.subscriptionInvoice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: SubscriptionInvoiceStatus.PAID }),
        }),
      );
    });

    it('evento repetido não aplica efeito de novo', async () => {
      prisma.webhookEvent.create.mockRejectedValue(erroDeUnicidade());

      await expect(service.aplicarEvento(evento)).resolves.toBe('repetido');

      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.subscriptionInvoice.upsert).not.toHaveBeenCalled();
    });

    it('falha de pagamento deixa PAST_DUE, não CANCELED — o gateway ainda vai retentar', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'w2' });
      prisma.subscription.findUnique.mockResolvedValue({ id: 's1' });

      await service.aplicarEvento({ ...evento, providerEventId: 'evt_2', type: 'invoice.payment_failed' });

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionStatus.PAST_DUE }),
        }),
      );
    });

    it('ignora evento de assinatura que não é nossa', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'w3' });
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.aplicarEvento({ ...evento, providerEventId: 'evt_3' })).resolves.toBe('aplicado');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('grava o motivo e relança quando o processamento falha, para o gateway reenviar', async () => {
      prisma.webhookEvent.create.mockResolvedValue({ id: 'w4' });
      prisma.subscription.findUnique.mockResolvedValue({ id: 's1' });
      prisma.subscription.update.mockRejectedValue(new Error('banco fora'));

      await expect(service.aplicarEvento({ ...evento, providerEventId: 'evt_4' })).rejects.toThrow('banco fora');
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ errorReason: 'banco fora' }) }),
      );
    });
  });

  describe('assinar', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Leonam', email: 'l@ex.com' });
      prisma.plan.findUnique.mockResolvedValue({ id: 'p1', code: 'pro-mensal', amount: 29.9, isActive: true });
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.subscription.upsert.mockResolvedValue({ id: 's1' });
    });

    it('guarda apenas token, bandeira e últimos 4 — nunca dado de cartão', async () => {
      await service.assinar('u1', 'pro-mensal', 'fake_tok_visa_4242');

      const gravado = prisma.paymentMethod.upsert.mock.calls[0][0].create;
      expect(gravado).toEqual(
        expect.objectContaining({ providerToken: 'fake_tok_visa_4242', brand: 'visa', last4: '4242' }),
      );
      const campos = Object.keys(gravado).join(',');
      expect(campos).not.toMatch(/number|pan|cvv|cvc|securityCode/i);
    });

    it('plano gratuito não passa por gateway nem exige cartão', async () => {
      prisma.plan.findUnique.mockResolvedValue({ id: 'p0', code: 'free', amount: 0, isActive: true });

      await service.assinar('u1', 'free', '');

      expect(prisma.paymentMethod.upsert).not.toHaveBeenCalled();
      const gravado = prisma.subscription.upsert.mock.calls[0][0].create;
      expect(gravado).toEqual(
        expect.objectContaining({
          status: SubscriptionStatus.ACTIVE,
          providerSubscriptionId: null,
          currentPeriodEnd: null,
        }),
      );
    });

    it('plano pago sem token é recusado', async () => {
      prisma.plan.findUnique.mockResolvedValue({ id: 'p1', code: 'pro-mensal', amount: 29.9, isActive: true });
      await expect(service.assinar('u1', 'pro-mensal', '')).rejects.toThrow('exige um meio de pagamento');
    });

    it('recusa plano inativo', async () => {
      prisma.plan.findUnique.mockResolvedValue({ id: 'p1', code: 'x', isActive: false });
      await expect(service.assinar('u1', 'x', 'tok')).rejects.toThrow('Plano indisponível.');
    });

    it('recusa assinar de novo quem já está ativo', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ status: SubscriptionStatus.ACTIVE });
      await expect(service.assinar('u1', 'pro-mensal', 'tok')).rejects.toThrow('já tem uma assinatura ativa');
    });
  });
});

// ============================================================
// A cobrança pela WEB, em tela hospedada pelo gateway.
// ============================================================
describe('BillingService — checkout hospedado', () => {
  let service: BillingService;
  let prisma: any;
  let gateway: any;

  const PLANO = { id: 'p1', code: 'pro-mensal', name: 'Pro', amount: 29.9, interval: 'MONTHLY', isActive: true };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', name: 'Henrique', email: 'h@x.com' }) },
      plan: { findUnique: jest.fn().mockResolvedValue(PLANO) },
      subscription: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), upsert: jest.fn() },
      subscriptionInvoice: { upsert: jest.fn() },
      paymentMethod: { updateMany: jest.fn(), upsert: jest.fn() },
      webhookEvent: { create: jest.fn(async () => ({ id: 'w1' })), update: jest.fn() },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    gateway = {
      nome: 'ASAAS',
      cabecalhoDeAutenticacao: 'asaas-access-token',
      criarCheckout: jest.fn(async () => ({ providerCheckoutId: 'chk_1', url: 'https://asaas/pagar' })),
      consultarCheckout: jest.fn(async () => ({ status: 'PAID', providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1' })),
      criarCliente: jest.fn(), registrarCartao: jest.fn(), criarAssinatura: jest.fn(),
      cancelarAssinatura: jest.fn(), lerWebhook: jest.fn(),
    };

    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PAYMENT_PROVIDER, useValue: gateway },
      ],
    }).compile();
    service = modulo.get(BillingService);
  });

  it('devolve a URL e guarda o id do checkout ANTES de o usuário sair do app', async () => {
    const r = await service.iniciarCheckout('u1', 'pro-mensal', 'https://ok', 'https://nao');

    expect(r).toEqual({ url: 'https://asaas/pagar' });
    const gravado = prisma.subscription.upsert.mock.calls[0][0].create;
    expect(gravado.providerCheckoutId).toBe('chk_1');
    // INCOMPLETE: abrir a tela não é ter pago.
    expect(gravado.status).toBe(SubscriptionStatus.INCOMPLETE);
  });

  it('nenhum dado de pagamento é pedido ao app: nem CPF, nem cartão', async () => {
    await service.iniciarCheckout('u1', 'pro-mensal', 'https://ok', 'https://nao');
    const enviado = gateway.criarCheckout.mock.calls[0][0];
    expect(Object.keys(enviado)).not.toContain('cpfCnpj');
    expect(Object.keys(enviado)).not.toContain('paymentToken');
  });

  // A regra que paga a conta: o corpo do webhook não decide nada. A
  // credencial do Asaas é um token fixo, que prova quem mandou e não que o
  // conteúdo chegou intacto.
  it('CHECKOUT_PAID não libera sozinho: o estado vem de uma consulta ao gateway', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 's1', providerCheckoutId: 'chk_1' });

    await service.aplicarEvento({
      providerEventId: 'evt_1', type: 'checkout.paid', payload: {}, providerCheckoutId: 'chk_1',
    });

    expect(gateway.consultarCheckout).toHaveBeenCalledWith('chk_1');
    expect(prisma.subscription.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: SubscriptionStatus.ACTIVE,
        providerCustomerId: 'cus_1',
        providerSubscriptionId: 'sub_1',
      }),
    );
  });

  it('se o gateway diz que NÃO está pago, nada é liberado — mesmo com o evento de pago', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 's1', providerCheckoutId: 'chk_1' });
    gateway.consultarCheckout.mockResolvedValue({ status: 'ACTIVE' });

    await service.aplicarEvento({
      providerEventId: 'evt_1', type: 'checkout.paid', payload: {}, providerCheckoutId: 'chk_1',
    });

    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('checkout que não é nosso é ignorado em silêncio', async () => {
    prisma.subscription.findUnique.mockResolvedValue(null);
    await service.aplicarEvento({
      providerEventId: 'evt_1', type: 'checkout.paid', payload: {}, providerCheckoutId: 'chk_de_outro',
    });
    expect(gateway.consultarCheckout).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('cancelado ou expirado deixa a assinatura como estava, sem liberar', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 's1', providerCheckoutId: 'chk_1' });
    for (const status of ['CANCELED', 'EXPIRED'] as const) {
      gateway.consultarCheckout.mockResolvedValue({ status });
      await service.aplicarEvento({
        providerEventId: 'evt_' + status, type: 'checkout.canceled', payload: {}, providerCheckoutId: 'chk_1',
      });
    }
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('recusa checkout de plano sem cobrança e de quem já está ativo', async () => {
    prisma.plan.findUnique.mockResolvedValue({ ...PLANO, amount: 0 });
    await expect(service.iniciarCheckout('u1', 'gratis', 'https://a', 'https://b')).rejects.toThrow(
      /sem cobrança/,
    );

    prisma.plan.findUnique.mockResolvedValue(PLANO);
    prisma.subscription.findUnique.mockResolvedValue({ status: SubscriptionStatus.ACTIVE });
    await expect(service.iniciarCheckout('u1', 'pro-mensal', 'https://a', 'https://b')).rejects.toThrow(
      /já tem uma assinatura ativa/,
    );
  });

  it('gateway sem tela hospedada diz isso em vez de falhar torto', async () => {
    delete gateway.criarCheckout;
    await expect(service.iniciarCheckout('u1', 'pro-mensal', 'https://a', 'https://b')).rejects.toThrow(
      /não tem tela de pagamento hospedada/,
    );
  });
});
