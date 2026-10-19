// ============================================================
// billing.module.ts
// ============================================================
// O adaptador do gateway é escolhido por variável de ambiente. Trocar de
// provedor é adicionar um `case` aqui e escrever a classe do adaptador — o
// BillingService e o guard não mudam.
// ============================================================

import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionActiveGuard } from './subscription-active.guard';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import { FakePaymentProvider } from './fake-payment-provider';
import { AsaasPaymentProvider } from './asaas-payment-provider';
import { PrismaService } from '../prisma/prisma.service';
import { garantirPlanosPadrao } from './default-plans';

@Module({
  imports: [PrismaModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    SubscriptionActiveGuard,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () => {
        switch (process.env.PAYMENT_PROVIDER) {
          // case 'STRIPE': return new StripePaymentProvider();
          case 'ASAAS':
            return new AsaasPaymentProvider();
          default:
            return new FakePaymentProvider();
        }
      },
    },
  ],
  exports: [BillingService, SubscriptionActiveGuard],
})
export class BillingModule implements OnModuleInit {
  private readonly logger = new Logger(BillingModule.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sem plano no catálogo a tela de assinatura abre sem nada para escolher,
   * e ninguém consegue assinar. Conferido na subida pelo mesmo motivo das
   * categorias padrão: o `prisma db seed` não roda no deploy, e isto não
   * pode depender de alguém lembrar de um comando.
   *
   * Falhar aqui não derruba a API: melhor o app no ar sem poder cobrar do
   * que fora do ar por causa do catálogo. */
  async onModuleInit() {
    try {
      const criados = await garantirPlanosPadrao(this.prisma);
      if (criados) this.logger.log(`Planos criados: ${criados}`);
    } catch (erro) {
      this.logger.error(`Não consegui garantir os planos: ${(erro as Error).message}`);
    }
  }
}
