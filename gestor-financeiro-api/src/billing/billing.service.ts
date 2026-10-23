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
import { acessoLiberado, fimDoCicloPago } from './acesso';

/** Estados em que a conta segue podendo criar registros SEM mais perguntas.
 * Cancelada com ciclo pago correndo também libera — ver `acessoLiberado`. */
const STATUS_LIBERADOS: SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
];

/** O endereço do app, para onde o gateway devolve quem pagou. Vem do
 * ambiente e não do pedido: ver `iniciarCheckout`. */
const ENDERECO_DO_APP = (process.env.APP_URL ?? 'https://saldonline.com.br').replace(/\/+$/, '') + '/';

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
    return acessoLiberado(assinatura);
  }

  /** O catálogo, para a tela não guardar preço próprio. Preço duplicado no
   * cliente é preço que um dia diverge do que a cobrança faz — e aí o app
   * promete um valor e o cartão recebe outro. */
  async planos() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { amount: 'asc' },
      select: { code: true, name: true, amount: true, interval: true },
    });
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
   *
   * Para onde o gateway devolve o usuário é decidido AQUI, nunca pelo
   * cliente. Com a URL vindo de fora, bastava chamar esta rota com um
   * endereço qualquer para o gateway devolver quem pagou num site de outra
   * pessoa — e com a aparência de ter vindo da nossa cobrança.
   */
  async iniciarCheckout(userId: string, planCode: string) {
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
      urlSucesso: ENDERECO_DO_APP + '?assinatura=ok',
      urlCancelamento: ENDERECO_DO_APP + '?assinatura=cancelada',
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
    // Pago é o único caminho que LIBERA, e por isso é o único que confere
    // contra o gateway antes de agir. Os outros só restringem.
    if (evento.type === 'invoice.paid') return this.processarPagamento(evento);

    const assinatura = await this.daAssinatura(evento);
    if (!assinatura) return; // evento que não é nosso

    switch (evento.type) {

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
   * Acha a assinatura de quem o evento fala.
   *
   * Dois caminhos, porque nas duas pontas da vida de uma assinatura o que
   * existe é diferente. Na PRIMEIRA cobrança só há a tela de pagamento que
   * nós abrimos, e o vínculo é o id dela. Dali em diante o id da assinatura
   * do gateway já está gravado, e é por ele que as renovações chegam.
   */
  private async daAssinatura(evento: EventoWebhook) {
    if (evento.providerSubscriptionId) {
      const porAssinatura = await this.prisma.subscription.findUnique({
        where: { providerSubscriptionId: evento.providerSubscriptionId },
      });
      if (porAssinatura) return porAssinatura;
    }
    if (evento.providerCheckoutId) {
      return this.prisma.subscription.findUnique({
        where: { providerCheckoutId: evento.providerCheckoutId },
      });
    }
    return null;
  }

  /**
   * Pagamento confirmado — o único evento que LIBERA acesso, e por isso o
   * único que não acredita no que leu.
   *
   * A credencial do webhook do Asaas é um token FIXO: prova quem mandou, não
   * que o conteúdo chegou intacto. Então do corpo sai apenas o id da
   * cobrança, e todo o resto — se foi paga, por quanto, de qual assinatura —
   * vem de uma consulta ao gateway. Com o token vazado, o máximo que alguém
   * consegue é mandar o sistema reconferir uma cobrança que existe.
   *
   * O valor é conferido contra o plano. Sem isso, uma cobrança de um real
   * pagaria um plano de trinta.
   */
  private async processarPagamento(evento: EventoWebhook) {
    if (!evento.providerInvoiceId) return;
    if (!this.gateway.consultarCobranca) {
      throw new Error('Gateway sem `consultarCobranca`: não dá para confirmar o pagamento com segurança.');
    }

    const real = await this.gateway.consultarCobranca(evento.providerInvoiceId);
    if (!real.pago) return; // o gateway desmentiu o evento

    const assinatura = await this.daAssinatura({
      ...evento,
      providerSubscriptionId: real.providerSubscriptionId,
      providerCheckoutId: real.providerCheckoutId,
    });
    if (!assinatura) return; // cobrança que não é de nenhuma conta nossa

    const plano = await this.prisma.plan.findUnique({ where: { id: assinatura.planId } });
    if (plano && Number(plano.amount) > real.valor) {
      throw new Error(
        `Cobrança de ${real.valor} não cobre o plano ${plano.code}, de ${Number(plano.amount)}.`,
      );
    }

    await this.registrarCobranca(assinatura.id, evento, SubscriptionInvoiceStatus.PAID, {
      valor: real.valor,
      vencimento: real.vencimento,
    });
    await this.prisma.subscription.update({
      where: { id: assinatura.id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        // Até quando vale o que acabou de ser pago. Antes isto lia um campo
        // que o gateway nunca mandou, e ficava sempre nulo: quem cancelasse
        // perderia o acesso na hora, sem data em que se apoiar.
        currentPeriodEnd: real.vencimento && plano
          ? fimDoCicloPago(real.vencimento, plano.interval)
          : assinatura.currentPeriodEnd,
        // Na primeira cobrança é aqui que a assinatura e o cliente do
        // gateway entram: antes de pagar, eles não existiam.
        providerSubscriptionId: real.providerSubscriptionId ?? assinatura.providerSubscriptionId,
        providerCustomerId: real.providerCustomerId ?? assinatura.providerCustomerId,
      },
    });
  }

  private async registrarCobranca(
    subscriptionId: string,
    evento: EventoWebhook,
    status: SubscriptionInvoiceStatus,
    conferido?: { valor: number; vencimento?: Date },
  ) {
    if (!evento.providerInvoiceId) return;
    const dados = evento.payload as { data?: { amount?: number; dueDate?: string; failureReason?: string } };
    // Valor e vencimento conferidos vêm da consulta ao gateway e têm
    // precedência: o do corpo é só o que o remetente afirmou.
    //
    // O vencimento importa mais do que parece. Sem ele, o `new Date()` de
    // reserva grava a hora do webhook em UTC — e depois das 21h daqui isso
    // é o dia seguinte. A cobrança paga em 22/10 aparecia na tela como
    // "23 out". Mesmo defeito que já tinha agendado uma cobrança para o dia
    // errado, agora só na leitura.
    const valor = conferido?.valor ?? dados.data?.amount ?? 0;
    const vencimento =
      conferido?.vencimento ?? (dados.data?.dueDate ? new Date(dados.data.dueDate) : new Date());

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
