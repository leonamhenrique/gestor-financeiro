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
  ShiftInvoiceDto,
  BulkCategoryDto,
  ImportBatchDto,
  ImportItemDto,
} from './dto/transaction.dto';

/** Uma linha do extrato, no formato que o service espera. */
function linhaDoExtrato(dto: ImportItemDto) {
  return {
    categoryId: dto.categoryId,
    type: dto.type,
    amount: dto.amount,
    description: dto.description,
    transactionDate: new Date(dto.transactionDate),
    bankAccountId: dto.bankAccountId,
    creditCardId: dto.creditCardId,
    isConfirmed: dto.isConfirmed,
    invoiceMonth: dto.invoiceMonth,
    seriesRef: dto.seriesRef,
    seriesIndex: dto.seriesIndex,
    seriesCount: dto.seriesCount,
  };
}

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
      clientKey: dto.clientKey,
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

  // POST /transactions/import — um extrato inteiro de uma vez, atômico.
  //
  // Antes das rotas com `:id` pelo mesmo motivo de `bulk-category`: depois
  // delas, "import" seria lido como o id de um lançamento.
  @Post('import')
  importar(@Req() req: any, @Body() dto: ImportBatchDto) {
    return this.transactionsService.criarEmLote(req.user.id, dto.batchId, dto.items.map(linhaDoExtrato));
  }

  // DELETE /transactions/import/:batchId — desfaz a importação inteira,
  // devolvendo saldo e fatura ao que eram.
  @Delete('import/:batchId')
  desfazerImportacao(@Req() req: any, @Param('batchId') batchId: string) {
    return this.transactionsService.desfazerImportacao(req.user.id, batchId);
  }

  // PATCH /transactions/bulk-category — põe vários lançamentos na mesma
  // categoria. Serve à correção de um lojista classificado errado.
  //
  // Esta rota vem ANTES das que começam com `:id`: depois delas, "bulk-category"
  // seria lido como o id de um lançamento e a chamada morreria em 404.
  @Patch('bulk-category')
  reclassificar(@Req() req: any, @Body() dto: BulkCategoryDto) {
    return this.transactionsService.reclassificarEmLote(req.user.id, dto.ids, dto.categoryId);
  }

  // PATCH /transactions/:id/series/shift-invoice — empurra as parcelas
  // SEGUINTES para outra fatura, de `months` meses. Serve ao caso em que a
  // operadora joga a primeira parcela para a fatura seguinte: corrigida a
  // primeira, as outras precisam andar junto.
  @Patch(':id/series/shift-invoice')
  deslocarFaturas(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: ShiftInvoiceDto,
  ) {
    return this.transactionsService.deslocarFaturasSeguintes(req.user.id, id, dto.months);
  }

  // PATCH /transactions/:id/series/realign-dates — na CONTA nao ha fatura:
  // o que se corrige e a data, e as seguintes sao recalculadas a partir dela.
  @Patch(':id/series/realign-dates')
  realinharDatas(@Req() req: any, @Param('id') id: string) {
    return this.transactionsService.realinharDatasSeguintes(req.user.id, id);
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
        type: dto.type,
        bankAccountId: dto.bankAccountId,
        creditCardId: dto.creditCardId,
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
