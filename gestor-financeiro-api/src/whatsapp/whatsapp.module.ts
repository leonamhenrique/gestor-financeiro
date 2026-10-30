import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { ConversaService } from './conversa.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './webhook.controller';

@Module({
  imports: [TransactionsModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, ConversaService],
  // Exportado porque a pergunta "de quem é esta mensagem?" é a primeira de
  // qualquer coisa que venha pelo WhatsApp.
  exports: [WhatsappService],
})
export class WhatsappModule {}
