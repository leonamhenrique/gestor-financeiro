// ============================================================
// openfinance.module.ts
// ============================================================
// Módulo isolado de propósito: desistir do experimento é apagar esta pasta
// e tirar a linha do `app.module`. Nada fora daqui importa o que está aqui,
// e nenhum serviço do app passou a depender de Open Finance para funcionar.
// ============================================================

import { Module } from '@nestjs/common';
import { OpenFinanceController, OpenFinanceAtivo } from './openfinance.controller';
import { OpenFinanceService } from './openfinance.service';
import { OpenFinanceScheduler } from './openfinance.scheduler';
import { PolpClient } from './polp.client';

@Module({
  controllers: [OpenFinanceController],
  /* O trabalho diário entra aqui e em lugar nenhum mais: desistir do
   * experimento continua sendo apagar esta pasta. */
  providers: [OpenFinanceService, PolpClient, OpenFinanceAtivo, OpenFinanceScheduler],
})
export class OpenFinanceModule {}
