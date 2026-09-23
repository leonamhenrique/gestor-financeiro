// ============================================================
// credit-cards.controller.ts
// ============================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReorderDto } from '../common/reorder.dto';
import { CreditCardsService } from './credit-cards.service';
import { CreditCardInvoicesService } from './credit-card-invoices.service';
import { InvoicePaymentsService } from './invoice-payments.service';
import {
  CreateCreditCardDto,
  UpdateCreditCardDto,
  UpdateBillingCycleDto,
  PayInvoiceDto,
  UpdateInvoicePaymentDto,
} from './dto/credit-card.dto';

@UseGuards(JwtAuthGuard)
@Controller('credit-cards')
export class CreditCardsController {
  constructor(
    private readonly creditCardsService: CreditCardsService,
    private readonly invoicesService: CreditCardInvoicesService,
    private readonly paymentsService: InvoicePaymentsService,
  ) {}

  // ---------------- Faturas e pagamentos ----------------

  // Sequência de faturas (mais recente primeiro) com compras, transporte,
  // pagamentos, valor em aberto e status.
  @Get(':id/invoices')
  listInvoices(@Req() req: any, @Param('id') id: string) {
    return this.invoicesService.findAllByCard(req.user.id, id);
  }

  // :month no formato AAAA-MM
  @Get(':id/invoices/:month')
  getInvoice(@Req() req: any, @Param('id') id: string, @Param('month') month: string) {
    return this.invoicesService.findByMonth(req.user.id, id, month);
  }

  // Registra um pagamento (total ou parcial). Pode haver vários na mesma
  // fatura, até o vencimento; depois dele, o que sobrou vai para a seguinte.
  @Post(':id/invoices/:month/payments')
  pay(@Req() req: any, @Param('id') id: string, @Param('month') month: string, @Body() dto: PayInvoiceDto) {
    return this.paymentsService.pagar(req.user.id, id, month, dto);
  }

  @Patch(':id/payments/:paymentId')
  updatePayment(
    @Req() req: any,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdateInvoicePaymentDto,
  ) {
    return this.paymentsService.editar(req.user.id, id, paymentId, dto);
  }

  // Desfazer: o valor volta para a conta de origem.
  @Delete(':id/payments/:paymentId')
  @HttpCode(204)
  async undoPayment(@Req() req: any, @Param('id') id: string, @Param('paymentId') paymentId: string) {
    await this.paymentsService.desfazer(req.user.id, id, paymentId);
  }

  // ---------------- Cartão ----------------

  @Post()
  create(@Req() req: any, @Body() dto: CreateCreditCardDto) {
    return this.creditCardsService.create({ userId: req.user.id, ...dto });
  }

  // GET /credit-cards?includeInactive=true
  @Get()
  findAll(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.creditCardsService.findAllByUser(req.user.id, includeInactive === 'true');
  }

  // PUT /credit-cards/order { ids } — nova ordem da lista.
  @Put('order')
  reorder(@Req() req: any, @Body() dto: ReorderDto) {
    return this.creditCardsService.reorder(req.user.id, dto.ids);
  }

  // Visão completa para a Tela de Controle de Cartões: limite
  // disponível + faturas com status já calculado.
  @Get(':id/overview')
  getOverview(@Req() req: any, @Param('id') id: string) {
    return this.creditCardsService.getOverview(req.user.id, id);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.creditCardsService.findOneByUser(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCreditCardDto) {
    return this.creditCardsService.update(req.user.id, id, dto);
  }

  // Rota separada e explícita — deliberadamente fora do PATCH genérico
  // (ver regra de negócio no service).
  @Patch(':id/billing-cycle')
  updateBillingCycle(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBillingCycleDto) {
    return this.creditCardsService.updateBillingCycle(
      req.user.id,
      id,
      dto.closingDay,
      dto.dueDay,
    );
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.creditCardsService.delete(req.user.id, id);
  }
}
