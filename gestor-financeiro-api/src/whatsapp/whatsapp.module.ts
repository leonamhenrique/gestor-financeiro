import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService],
  // Exportado porque o webhook, quando existir, precisa perguntar de quem é a
  // mensagem antes de qualquer outra coisa.
  exports: [WhatsappService],
})
export class WhatsappModule {}
