// ============================================================
// billing.service.ts
// ============================================================
// Regras de negócio da assinatura:
//
// 1. O estado da assinatura é REFLEXO do gateway, nunca decidido aqui.
//    Nenhum método deste serviço marca uma assinatura como paga por conta
//    própria — isso só acontece em `aplicarEvento`, a partir de um webhook
//    já autenticado. É a diferença entre cobrar e fingir que cobrou.
//
// 2. Inadimplência bloqueia PARCIALMENTE. PAST_DUE e INCOMPLETE impedem
//    criar registro novo, mas não impedem ler, editar nem apagar o que já
//    existe. Bloquear a leitura esconderia justamente o dado que o usuário
//    precisa para decidir se paga — e reter dado de quem parou de pagar é
//    problema, não alavanca.
//
// 3. Cancelamento não apaga nada. `CANCELED` mantém o histórico intacto e
//    apenas fecha a criação de registros novos.
// ============================================================

import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionStatus, SubscriptionInvoiceStatus, Prisma } from '@prisma/client';
import { PAYMENT_PROVIDER, PaymentProviderPort, EventoWebhook } from './payment-provider.port';

/** Estados em que a conta segue podendo criar registros. */
const STATUS_LIBERADOS: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
];

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProviderPort,
  ) {}

  /**
   * Fonte única do bloqueio parcial. Usuário sem assinatura nenhuma é tratado
   * como liberado: o bloqueio é para quem assinou e parou de pagar, não para
   * quem ainda não passou pelo checkout.
   */
  async podeCriarRegistros(userId: string): Promise<boolean> {
    const assinatura = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!assinatura) return true;
    return STATUS_LIBERADOS.includes(assinatura.status);
  }

  async obterAssinatura(userId: string) {
    return this.prisma.subscription.findUnique({
      where: { userId },
      include: {
        plan: true,
        invoices: { orderBy: { createdAt: 'desc' }, take: 12 },
      },
    });
  }

  /**
   * Registra o cartão tokenizado no navegador e assina o plano. O token é a
   * única coisa que chega aqui: número e CVV nunca passam por este processo.
   */
  async assinar(userId: string, planCode: string, paymentToken: string) {
    const [usuario, plano] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.plan.findUnique({ where: { code: planCode } }),
    ]);
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    if (!plano || !plano.isActive) throw new BadRequestException('Plano indisponível.');

    const existente = await this.prisma.subscription.findUnique({ where: { userId } });
    if (existente && STATUS_LIBERADOS.includes(existente.status)) {
      throw new BadRequestException('Este usuário já tem uma assinatura ativa.');
    }

    // Plano sem cobrança não passa por gateway: não há o que tokenizar nem o
    // que renovar. Sem este caminho, exigir cartão para um plano de R$ 0
    // seria pedir dado que o negócio não precisa.
    if (Number(plano.amount) <= 0) {
      const dadosGratuito = {
        planId: plano.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: null, // não expira, então não há ciclo a renovar
        provider: this.gateway.nome,
        providerCustomerId: existente?.providerCustomerId ?? null,
        providerSubscriptionId: null,
        cancelAtPeriodEnd: false,
      };
      return this.prisma.subscription.upsert({
        where: { userId },
        create: { userId, ...dadosGratuito },
        update: dadosGratuito,
        include: { plan: true },
      });
    }

    if (!paymentToken) {
      throw new BadRequestException('Este plano exige um meio de pagamento.');
    }

    const providerCustomerId =
      existente?.providerCustomerId ??
      (await this.gateway.criarCliente({
        userId,
        nome: usuario.name,
        email: usuario.email,
      }));

    const cartao = await this.gateway.registrarCartao(providerCustomerId, paymentToken);
    const remota = await this.gateway.criarAssinatura({
      providerCustomerId,
      providerPlanCode: plano.code,
      paymentToken: cartao.providerToken,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.paymentMethod.updateMany({ where: { userId }, data: { isDefault: false } });
      await tx.paymentMethod.upsert({
        where: {
          provider_providerToken: {
            provider: this.gateway.nome,
            providerToken: cartao.providerToken,
          },
        },
        create: {
          userId,
          provider: this.gateway.nome,
          providerToken: cartao.providerToken,
          brand: cartao.brand,
          last4: cartao.last4,
          expMonth: cartao.expMonth,
          expYear: cartao.expYear,
          isDefault: true,
        },
        update: { isDefault: true },
      });

      const dados = {
        planId: plano.id,
        status: remota.status as SubscriptionStatus,
        currentPeriodEnd: remota.currentPeriodEnd ?? null,
        provider: this.gateway.nome,
        providerCustomerId,
        providerSubscriptionId: remota.providerSubscriptionId,
        cancelAtPeriodEnd: false,
      };

      return tx.subscription.upsert({
        where: { userId },
        create: { userId, ...dados },
        update: dados,
        include: { plan: true },
      });
    });
  }

  /**
   * Abre a tela de pagamento do gateway e devolve para onde mandar o
   * navegador. É o caminho da cobrança pela WEB.
   *
   * A assinatura local nasce aqui como INCOMPLETE, guardando o id do
   * checkout — e nasce ANTES de o usuário sair do app, de propósito. Se ela
   * só nascesse quando o webhook chegasse, o pagamento voltaria sem dono: o
   * cliente e a assinatura do lado do gateway só existem depois de pago, e
   * não haveria o que casar com qual conta.
   *
   * INCOMPLETE não libera nada: quem libera é o webhook, depois de o gateway
   * confirmar. Abrir a tela não é ter pago.
   */
  async iniciarCheckout(userId: string, planCode: string, urlSucesso: string, urlCancelamento: string) {
    if (!this.gateway.criarCheckout) {
      throw new BadRequestException('Este gateway não tem tela de pagamento hospedada.');
    }
    const [usuario, plano] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.plan.findUnique({ where: { code: planCode } }),
    ]);
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');
    if (!plano || !plano.isActive) throw new BadRequestException('Plano indisponível.');
    if (Number(plano.amount) <= 0) {
      throw new BadRequestException('Plano sem cobrança não passa por tela de pagamento.');
    }

    const existente = await this.prisma.subscription.findUnique({ where: { userId } });
    if (existente && STATUS_LIBERADOS.includes(existente.status)) {
      throw new BadRequestException('Este usuário já tem uma assinatura ativa.');
    }

    const checkout = await this.gateway.criarCheckout({
      userId,
      nome: usuario.name,
      email: usuario.email,
      planoCode: plano.code,
      planoNome: plano.name,
      valor: Number(plano.amount),
      intervalo: plano.interval === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
      urlSucesso,
      urlCancelamento,
    });

    const dados = {
      planId: plano.id,
      status: SubscriptionStatus.INCOMPLETE,
      provider: this.gateway.nome,
      providerCheckoutId: checkout.providerCheckoutId,
      cancelAtPeriodEnd: false,
    };
    await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, ...dados },
      update: dados,
    });

    return { url: checkout.url };
  }

  async cancelar(userId: string, aoFimDoPeriodo = true) {
    const assinatura = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!assinatura?.providerSubscriptionId) {
      throw new NotFoundException('Nenhuma assinatura para cancelar.');
    }

    const remota = await this.gateway.cancelarAssinatura(
      assinatura.providerSubscriptionId,
      aoFimDoPeriodo,
    );

    return this.prisma.subscription.update({
      where: { userId },
      data: {
        status: remota.status as SubscriptionStatus,
        cancelAtPeriodEnd: aoFimDoPeriodo,
      },
    });
  }

  /**
   * Ponto de entrada do webhook, já autenticado pelo adaptador do gateway.
   * Idempotente: a segunda entrega do mesmo evento não repete efeito nenhum,
   * porque o gateway reenvia sempre que não recebe 2xx.
   */
  async aplicarEvento(evento: EventoWebhook): Promise<'aplicado' | 'repetido'> {
    const registro = await this.prisma.webhookEvent
      .create({
        data: {
          provider: this.gateway.nome,
          providerEventId: evento.providerEventId,
          type: evento.type,
          payload: evento.payload as Prisma.InputJsonValue,
        },
      })
      .catch((erro: unknown) => {
        // Violação de unicidade = evento já recebido antes.
        if ((erro as { code?: string }).code === 'P2002') return null;
        throw erro;
      });
    if (!registro) return 'repetido';

    try {
      await this.processar(evento);
      await this.prisma.webhookEvent.update({
        where: { id: registro.id },
        data: { processedAt: new Date() },
      });
      return 'aplicado';
    } catch (erro) {
      // O erro fica gravado e é relançado: sem 2xx, o gateway reenvia e a
      // idempotência acima garante que a retentativa não duplique efeito.
      await this.prisma.webhookEvent.update({
        where: { id: registro.id },
        data: { errorReason: erro instanceof Error ? erro.message : String(erro) },
      });
      throw erro;
    }
  }

  private async processar(evento: EventoWebhook) {
    if (evento.providerCheckoutId) return this.processarCheckout(evento);
    if (!evento.providerSubscriptionId) return;

    const assinatura = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: evento.providerSubscriptionId },
    });
    if (!assinatura) return; // evento de assinatura que não é nossa

    switch (evento.type) {
      case 'invoice.paid':
        await this.registrarCobranca(assinatura.id, evento, SubscriptionInvoiceStatus.PAID);
        await this.prisma.subscription.update({
          where: { id: assinatura.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd: this.lerData(evento, 'currentPeriodEnd'),
          },
        });
        break;

      case 'invoice.payment_failed':
        await this.registrarCobranca(assinatura.id, evento, SubscriptionInvoiceStatus.FAILED);
        // PAST_DUE, não CANCELED: o gateway ainda vai retentar. Cancelar aqui
        // mataria a assinatura antes da régua de inadimplência rodar.
        await this.prisma.subscription.update({
          where: { id: assinatura.id },
          data: { status: SubscriptionStatus.PAST_DUE },
        });
        break;

      case 'subscription.canceled':
        await this.prisma.subscription.update({
          where: { id: assinatura.id },
          data: { status: SubscriptionStatus.CANCELED },
        });
        break;

      default:
        break; // evento que não muda estado nosso
    }
  }

  /**
   * O retorno da tela de pagamento hospedada.
   *
   * O corpo do webhook NÃO decide nada aqui. A credencial do Asaas é um token
   * fixo: ela prova quem mandou, não que o conteúdo chegou intacto. Então o
   * evento serve de gatilho e o estado vem de uma consulta ao gateway. Sem
   * isso, um POST com o token vazado liberaria assinatura de graça.
   */
  private async processarCheckout(evento: EventoWebhook) {
    const assinatura = await this.prisma.subscription.findUnique({
      where: { providerCheckoutId: evento.providerCheckoutId! },
    });
    if (!assinatura) return; // checkout que não é nosso

    if (!this.gateway.consultarCheckout) {
      throw new Error('Gateway sem `consultarCheckout`: não dá para confirmar o pagamento com segurança.');
    }
    const real = await this.gateway.consultarCheckout(evento.providerCheckoutId!);

    if (real.status !== 'PAID') {
      // Cancelado ou expirado: a assinatura nunca chegou a valer, e fica como
      // estava — INCOMPLETE não libera nada. Apagar a linha perderia o
      // registro de que a pessoa tentou e não concluiu.
      return;
    }

    await this.prisma.subscription.update({
      where: { id: assinatura.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        providerCustomerId: real.providerCustomerId ?? assinatura.providerCustomerId,
        providerSubscriptionId: real.providerSubscriptionId ?? assinatura.providerSubscriptionId,
      },
    });
  }

  private async registrarCobranca(
    subscriptionId: string,
    evento: EventoWebhook,
    status: SubscriptionInvoiceStatus,
  ) {
    if (!evento.providerInvoiceId) return;
    const dados = evento.payload as { data?: { amount?: number; dueDate?: string; failureReason?: string } };
    const valor = dados.data?.amount ?? 0;
    const vencimento = dados.data?.dueDate ? new Date(dados.data.dueDate) : new Date();

    await this.prisma.subscriptionInvoice.upsert({
      where: { providerInvoiceId: evento.providerInvoiceId },
      create: {
        subscriptionId,
        providerInvoiceId: evento.providerInvoiceId,
        amount: valor,
        status,
        dueDate: vencimento,
        paidAt: status === SubscriptionInvoiceStatus.PAID ? new Date() : null,
        failureReason: dados.data?.failureReason ?? null,
      },
      update: {
        status,
        paidAt: status === SubscriptionInvoiceStatus.PAID ? new Date() : null,
        failureReason: dados.data?.failureReason ?? null,
      },
    });
  }

  private lerData(evento: EventoWebhook, campo: string): Date | undefined {
    const dados = evento.payload as { data?: Record<string, string> };
    const bruto = dados.data?.[campo];
    return bruto ? new Date(bruto) : undefined;
  }
}
