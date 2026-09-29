import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { BillingModule } from './billing/billing.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    TransactionsModule,
    BankAccountsModule,
    CategoriesModule,
    CreditCardsModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Autenticação por PADRÃO, em toda rota da API — inclusive as que ainda
    // não existem. Abrir uma exige `@Public()`, que é explícito e aparece na
    // revisão. Antes o guard era declarado controlador a controlador, e um
    // controlador novo nascia aberto por esquecimento.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
