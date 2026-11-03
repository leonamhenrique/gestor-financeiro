import { Module } from '@nestjs/common';
import { BankAccountsController } from './bank-accounts.controller';
import { BankAccountsService } from './bank-accounts.service';

@Module({
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
  // Exportado para o WhatsApp: a conta que nasce de uma mensagem passa pelo
  // MESMO serviço do formulário — inclusive o saldo inicial virando saldo
  // atual, que é regra de dinheiro e não pode ter segunda via.
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
