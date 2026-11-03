import { Module } from '@nestjs/common';
import { CreditCardsController } from './credit-cards.controller';
import { CreditCardsService } from './credit-cards.service';
import { CreditCardInvoicesService } from './credit-card-invoices.service';
import { InvoiceClosingScheduler } from './invoice-closing.scheduler';
import { InvoicePaymentsService } from './invoice-payments.service';

@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService, CreditCardInvoicesService, InvoicePaymentsService, InvoiceClosingScheduler],
  // CreditCardsService sai junto para o WhatsApp: o cartão que nasce de
  // uma mensagem passa pelo MESMO caminho do formulário — primeira fatura e
  // período de origem do ciclo incluídos.
  exports: [CreditCardsService, CreditCardInvoicesService, InvoicePaymentsService],
})
export class CreditCardsModule {}
