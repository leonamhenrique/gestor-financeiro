import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { TransfersModule } from './transfers/transfers.module';
import { GoalsModule } from './goals/goals.module';
import { BudgetsModule } from './budgets/budgets.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { CategoryRulesModule } from './category-rules/category-rules.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { ReportsModule } from './reports/reports.module';
import { RelatorioModule } from './relatorio/relatorio.module';
import { SharedExpensesModule } from './shared-expenses/shared-expenses.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { BillingModule } from './billing/billing.module';
import { SupportModule } from './support/support.module';
import { OpenFinanceModule } from './openfinance/openfinance.module';
import { PushModule } from './push/push.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ContextoDoUsuarioInterceptor } from './auth/contexto.interceptor';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // Limite padrão, usado hoje só pela rota pública de despesa
    // compartilhada (ver PublicSharedController). Não há guard global: as
    // rotas autenticadas já têm o token como porta.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    AuthModule,
    TransactionsModule,
    TransfersModule,
    GoalsModule,
    BudgetsModule,
    BankAccountsModule,
    CategoriesModule,
    CategoryRulesModule,
    CreditCardsModule,
    BillingModule,
    SupportModule,
    ReportsModule,
    RelatorioModule,
    SharedExpensesModule,
    WhatsappModule,
    /* Experimento, e isolado de propósito: sem `OPENFINANCE_ENABLED=true`
     * todas as rotas dele respondem 404, e o app se comporta exatamente como
     * antes. Nenhum outro módulo depende dele. */
    OpenFinanceModule,
    PushModule,
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
