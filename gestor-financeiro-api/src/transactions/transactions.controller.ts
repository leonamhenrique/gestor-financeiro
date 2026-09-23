// ============================================================
// transactions.controller.ts
// ============================================================
// Assume um JwtAuthGuard já configurado no projeto, que popula
// `req.user.id` a partir do token. Ajuste o import conforme a
// estrutura real do módulo de autenticação.
// ============================================================

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransactionsService } from './transactions.service';
import {
  CreateTransactionDto,
  UpdateTransactionDto,
  ListTransactionsQueryDto,
  DeleteSeriesQueryDto,
  AnticipateDto,
} from './dto/transaction.dto';

@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // Com `repeat`, cria a série inteira e responde { series, transactions }.
  @Post()
  create(@Req() req: any, @Body() dto: CreateTransactionDto) {
    const input = {
      userId: req.user.id,
      categoryId: dto.categoryId,
      type: dto.type,
      amount: dto.amount,
      description: dto.description,
      transactionDate: new Date(dto.transactionDate),
      bankAccountId: dto.bankAccountId,
      creditCardId: dto.creditCardId,
      isRecurring: dto.isRecurring,
      isConfirmed: dto.isConfirmed,
      invoiceMonth: dto.invoiceMonth,
      source: dto.source,
    };
    return dto.repeat
      ? this.transactionsService.createSeries(input, dto.repeat)
      : this.transactionsService.create(input);
  }

  // POST /transactions/series/:seriesId/anticipate — antes de `:id` por clareza.
  @Post('series/:seriesId/anticipate')
  @HttpCode(200)
  anticipate(@Req() req: any, @Param('seriesId') seriesId: string, @Body() dto: AnticipateDto) {
    return this.transactionsService.anticipate(req.user.id, seriesId, dto);
  }

  // DELETE /transactions/:id/series?scope=ONLY|FOLLOWING|ALL
  @Delete(':id/series')
  deleteSeries(@Req() req: any, @Param('id') id: string, @Query() query: DeleteSeriesQueryDto) {
    return this.transactionsService.deleteSeries(req.user.id, id, query.scope);
  }

  // GET /transactions?startDate=2026-09-01&endDate=2026-09-30&categoryId=...
  // Cobre o requisito de filtro/organização por data do MVP.
  @Get()
  findAll(@Req() req: any, @Query() query: ListTransactionsQueryDto) {
    return this.transactionsService.findAllByUser(req.user.id, query);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.transactionsService.findOneByUser(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactionsService.update(
      id,
      {
        categoryId: dto.categoryId,
        amount: dto.amount,
        description: dto.description,
        transactionDate: dto.transactionDate ? new Date(dto.transactionDate) : undefined,
        isConfirmed: dto.isConfirmed,
        invoiceMonth: dto.invoiceMonth,
      },
      req.user.id,
    );
  }

  // Atalhos para os botões "confirmar" e "voltar a previsto" do app: o
  // mesmo que um PATCH com isConfirmed, sem arriscar mandar outros campos.
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Req() req: any, @Param('id') id: string) {
    return this.transactionsService.update(id, { isConfirmed: true }, req.user.id);
  }

  @Post(':id/unconfirm')
  @HttpCode(200)
  unconfirm(@Req() req: any, @Param('id') id: string) {
    return this.transactionsService.update(id, { isConfirmed: false }, req.user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.transactionsService.delete(id, req.user.id);
  }
}
