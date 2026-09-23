// ============================================================
// billing.module.ts
// ============================================================
// O adaptador do gateway é escolhido por variável de ambiente. Trocar de
// provedor é adicionar um `case` aqui e escrever a classe do adaptador — o
// BillingService e o guard não mudam.
// ============================================================

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SubscriptionActiveGuard } from './subscription-active.guard';
import { PAYMENT_PROVIDER } from './payment-provider.port';
import { FakePaymentProvider } from './fake-payment-provider';

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
          // case 'ASAAS': return new AsaasPaymentProvider();
          default:
            return new FakePaymentProvider();
        }
      },
    },
  ],
  exports: [BillingService, SubscriptionActiveGuard],
})
export class BillingModule {}
