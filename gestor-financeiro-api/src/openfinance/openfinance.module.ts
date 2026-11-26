// ============================================================
// openfinance.module.ts
// ============================================================
// Módulo isolado de propósito: desistir do experimento é apagar esta pasta
// e tirar a linha do `app.module`. Nada fora daqui importa o que está aqui,
// e nenhum serviço do app passou a depender de Open Finance para funcionar.
// ============================================================

import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { OpenFinanceController, OpenFinanceAtivo } from './openfinance.controller';
import { OpenFinanceWebhookController } from './openfinance.webhook.controller';
import { OpenFinanceService } from './openfinance.service';
import { OpenFinanceScheduler } from './openfinance.scheduler';
import { FimDoTesteScheduler } from './fim-do-teste.scheduler';
import { PolpClient } from './polp.client';
import { PushModule } from '../push/push.module';
import { CreditCardsModule } from '../credit-cards/credit-cards.module';

@Module({
  /* O trabalho diário já sabe quantos lançamentos esperam; o módulo de push
   * sabe entregar o aviso. Quem decide a HORA continua sendo o trabalho. */
  /* `CreditCardsModule` entra pelo ciclo de fatura: o banco é quem sabe os
   * dias de verdade, e alinhar o cartão com eles passa pela MESMA correção
   * que o formulário usa — nenhuma regra de fatura nasce aqui dentro. A
   * dependência é de mão única, e apagar esta pasta continua bastando. */
  imports: [BillingModule, PushModule, CreditCardsModule],
  /* O webhook fica em controller próprio porque não tem pessoa logada:
   * quem bate é o provedor. Pôr a rota junto das outras obrigaria a
   * afrouxar o guard que protege todas elas. */
  controllers: [OpenFinanceController, OpenFinanceWebhookController],
  /* O trabalho diário entra aqui e em lugar nenhum mais: desistir do
   * experimento continua sendo apagar esta pasta. */
  /* O segundo trabalho diário desliga o banco de quem não paga antes da
   * virada do mês, e avisa do fim do teste. Mora aqui, e não em `billing`,
   * porque quem ele desliga é conexão — e porque `billing` não pode importar
   * este módulo sem fechar um ciclo. */
  providers: [
    OpenFinanceService,
    PolpClient,
    OpenFinanceAtivo,
    OpenFinanceScheduler,
    FimDoTesteScheduler,
  ],
})
export class OpenFinanceModule {}
