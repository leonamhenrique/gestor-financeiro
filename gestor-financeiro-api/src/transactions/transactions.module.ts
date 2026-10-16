import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService],
  // Exportado para o módulo de despesas compartilhadas poder criar o
  // lançamento e a divisão dele na MESMA transação de banco.
  exports: [TransactionsService],
})
export class TransactionsModule {}
