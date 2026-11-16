import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  // A importação pode trazer transferência junto com lançamento, no mesmo
  // lote e na mesma transação de banco. Quem sabe mexer em saldo de duas
  // contas é o módulo de transferência, e continua sendo só ele.
  imports: [TransfersModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  // Exportado para o módulo de despesas compartilhadas poder criar o
  // lançamento e a divisão dele na MESMA transação de banco.
  exports: [TransactionsService],
})
export class TransactionsModule {}
