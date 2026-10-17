// ============================================================
// shared-expenses.controller.ts
// ============================================================
// O dono vem sempre de `req.user.id`, nunca do corpo.
// ============================================================

import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, HttpCode } from '@nestjs/common';
import { SharedExpensesService } from './shared-expenses.service';
import { SettlementsService } from './settlements.service';
import { SharedSummaryService } from './shared-summary.service';
import { ShareLinksService } from './share-links.service';
import {
  CreateSharedExpenseDto,
  CreateSettlementDto,
  ListSharedQueryDto,
  CreateShareLinkDto,
  UpdateSharedExpenseDto,
  UpdateSettlementDto,
} from './dto/shared-expense.dto';

@Controller('shared')
export class SharedExpensesController {
  constructor(
    private readonly despesas: SharedExpensesService,
    private readonly acertos: SettlementsService,
    private readonly resumos: SharedSummaryService,
    private readonly links: ShareLinksService,
  ) {}

  // ---------- resumo e extrato ----------

  @Get('summary')
  resumo(@Req() req: any) {
    return this.resumos.resumo(req.user.id);
  }

  // `por` é a escolha do usuário entre contar compra de cartão no vencimento
  // da fatura (padrão) ou na data da compra. A mesma do resto do app: duas
  // telas com critérios diferentes dariam dois números para o mesmo mês.
  @Get('people/:id/statement')
  extrato(
    @Req() req: any,
    @Param('id') id: string,
    @Query('month') month?: string,
    @Query('por') por?: string,
  ) {
    return this.resumos.extratoDaPessoa(req.user.id, id, month, por === 'compra' ? 'compra' : 'fatura');
  }

  @Get('statement')
  extratoGeral(@Req() req: any, @Query('month') month?: string, @Query('por') por?: string) {
    return this.resumos.extratoGeral(req.user.id, month, por === 'compra' ? 'compra' : 'fatura');
  }

  @Get('report-impact')
  impacto(@Req() req: any, @Query('month') month: string, @Query('por') por?: string) {
    return this.resumos.impactoNoMes(req.user.id, month, por === 'compra' ? 'compra' : 'fatura');
  }

  // ---------- despesas ----------

  @Post('expenses')
  criarDespesa(@Req() req: any, @Body() dto: CreateSharedExpenseDto) {
    return this.despesas.create({ userId: req.user.id, ...dto });
  }

  @Get('expenses')
  listarDespesas(@Req() req: any, @Query() query: ListSharedQueryDto) {
    return this.despesas.findAllByUser(req.user.id, query);
  }

  @Get('expenses/:id')
  umaDespesa(@Req() req: any, @Param('id') id: string) {
    return this.despesas.findOneByUser(req.user.id, id);
  }

  // Valor e rateio mudam JUNTOS: é esta a porta que a recusa de editar o
  // valor pelo lançamento comum manda procurar.
  @Patch('expenses/:id')
  editarDespesa(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSharedExpenseDto) {
    return this.despesas.update(req.user.id, id, dto);
  }

  @Delete('expenses/:id')
  apagarDespesa(@Req() req: any, @Param('id') id: string) {
    return this.despesas.remove(req.user.id, id);
  }

  // ---------- link de compartilhamento ----------

  @Post('people/:id/links')
  criarLink(@Req() req: any, @Param('id') id: string, @Body() dto: CreateShareLinkDto) {
    return this.links.create(req.user.id, id, dto.expiresAt);
  }

  @Get('people/:id/links')
  listarLinks(@Req() req: any, @Param('id') id: string) {
    return this.links.findByPerson(req.user.id, id);
  }

  @Delete('links/:id')
  revogarLink(@Req() req: any, @Param('id') id: string) {
    return this.links.revoke(req.user.id, id);
  }

  // ---------- acertos ----------

  @Post('settlements')
  criarAcerto(@Req() req: any, @Body() dto: CreateSettlementDto) {
    return this.acertos.create({ userId: req.user.id, ...dto });
  }

  @Get('settlements')
  listarAcertos(
    @Req() req: any,
    @Query() query: ListSharedQueryDto,
    @Query('personId') personId?: string,
  ) {
    return this.acertos.findAllByUser(req.user.id, { ...query, personId });
  }

  @Patch('settlements/:id')
  editarAcerto(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSettlementDto) {
    return this.acertos.update(req.user.id, id, dto);
  }

  @Delete('settlements/:id')
  @HttpCode(204)
  async apagarAcerto(@Req() req: any, @Param('id') id: string) {
    await this.acertos.remove(req.user.id, id);
  }
}
