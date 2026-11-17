// ============================================================
// openfinance.module.ts
// ============================================================
// Módulo isolado de propósito: desistir do experimento é apagar esta pasta
// e tirar a linha do `app.module`. Nada fora daqui importa o que está aqui,
// e nenhum serviço do app passou a depender de Open Finance para funcionar.
// ============================================================

import { Module } from '@nestjs/common';
import { OpenFinanceController, OpenFinanceAtivo } from './openfinance.controller';
import { OpenFinanceWebhookController } from './openfinance.webhook.controller';
import { OpenFinanceService } from './openfinance.service';
import { OpenFinanceScheduler } from './openfinance.scheduler';
import { PolpClient } from './polp.client';
import { PushModule } from '../push/push.module';

@Module({
  /* O trabalho diário já sabe quantos lançamentos esperam; o módulo de push
   * sabe entregar o aviso. Quem decide a HORA continua sendo o trabalho. */
  imports: [PushModule],
  /* O webhook fica em controller próprio porque não tem pessoa logada:
   * quem bate é o provedor. Pôr a rota junto das outras obrigaria a
   * afrouxar o guard que protege todas elas. */
  controllers: [OpenFinanceController, OpenFinanceWebhookController],
  /* O trabalho diário entra aqui e em lugar nenhum mais: desistir do
   * experimento continua sendo apagar esta pasta. */
  providers: [OpenFinanceService, PolpClient, OpenFinanceAtivo, OpenFinanceScheduler],
})
export class OpenFinanceModule {}
