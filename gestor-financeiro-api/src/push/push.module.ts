import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { ENVIADOR_DE_PUSH } from './push.port';
import { WebPushEnviador } from './webpush.enviador';

@Module({
  imports: [BillingModule],
  controllers: [PushController],
  providers: [
    PushService,
    // Quem entrega o aviso. Trocar de serviço um dia é trocar esta linha —
    // e é aqui que o `import()` dinâmico de `web-push` fica contido.
    { provide: ENVIADOR_DE_PUSH, useClass: WebPushEnviador },
  ],
  // Exportado para o trabalho diário do Open Finance poder avisar: é ele
  // quem sabe quantos lançamentos esperam, e quem decide a hora.
  exports: [PushService],
})
export class PushModule {}
