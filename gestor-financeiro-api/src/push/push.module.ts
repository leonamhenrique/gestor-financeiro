import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [PushService],
  // Exportado para o trabalho diário do Open Finance poder avisar: é ele
  // quem sabe quantos lançamentos esperam, e quem decide a hora.
  exports: [PushService],
})
export class PushModule {}
