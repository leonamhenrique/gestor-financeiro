import { Module } from '@nestjs/common';
import { CreditCardsController } from './credit-cards.controller';
import { CreditCardsService } from './credit-cards.service';
import { CreditCardInvoicesService } from './credit-card-invoices.service';
import { InvoiceClosingScheduler } from './invoice-closing.scheduler';
import { InvoicePaymentsService } from './invoice-payments.service';

@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService, CreditCardInvoicesService, InvoicePaymentsService, InvoiceClosingScheduler],
  exports: [CreditCardInvoicesService, InvoicePaymentsService],
})
export class CreditCardsModule {}
