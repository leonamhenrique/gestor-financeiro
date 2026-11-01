import { Module } from '@nestjs/common';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [TransfersController],
  providers: [TransfersService],
  // Exportado para o WhatsApp poder transferir pelo mesmo caminho da tela.
  exports: [TransfersService],
})
export class TransfersModule {}
