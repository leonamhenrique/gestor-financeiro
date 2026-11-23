import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [BillingModule],
  controllers: [GoalsController],
  providers: [GoalsService],
  // O WhatsApp aplica e resgata pela mesma porta do app: e este servico
  // que trava o resgate no guardado e mexe no saldo na mesma transacao.
  exports: [GoalsService],
})
export class GoalsModule {}
