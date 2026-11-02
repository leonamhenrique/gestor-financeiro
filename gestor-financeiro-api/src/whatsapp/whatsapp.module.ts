import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransfersModule } from '../transfers/transfers.module';
import { RelatorioModule } from '../relatorio/relatorio.module';
import { AudioService } from './audio.service';
import { ConversaService } from './conversa.service';
import { CupomService } from './cupom.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './webhook.controller';

@Module({
  imports: [TransactionsModule, TransfersModule, RelatorioModule, CategoriesModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, ConversaService, AudioService, CupomService],
  // Exportado porque a pergunta "de quem é esta mensagem?" é a primeira de
  // qualquer coisa que venha pelo WhatsApp.
  exports: [WhatsappService],
})
export class WhatsappModule {}
