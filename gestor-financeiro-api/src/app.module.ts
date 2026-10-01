import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { ReportsModule } from './reports/reports.module';
import { BillingModule } from './billing/billing.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ContextoDoUsuarioInterceptor } from './auth/contexto.interceptor';

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
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Autenticação por PADRÃO, em toda rota da API — inclusive as que ainda
    // não existem. Abrir uma exige `@Public()`, que é explícito e aparece na
    // revisão. Antes o guard era declarado controlador a controlador, e um
    // controlador novo nascia aberto por esquecimento.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Depois do guard: leva o dono da requisição até o banco, onde o RLS o lê.
    { provide: APP_INTERCEPTOR, useClass: ContextoDoUsuarioInterceptor },
  ],
})
export class AppModule {}
