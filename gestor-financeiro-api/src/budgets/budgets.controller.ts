// ============================================================
// budgets.controller.ts
// ============================================================
// O dono vem sempre de `req.user.id`, nunca do corpo. O MÊS vem da rota: ele
// é a chave do planejamento, e deixá-lo no corpo permitiria salvar num mês
// enquanto a URL diz outro.
// ============================================================

import { Controller, Get, Put, Post, Delete, Body, Param, Req, HttpCode } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { SaveBudgetDto, CopyBudgetDto } from './dto/budget.dto';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  /** Tudo de uma vez: o app guarda os planejamentos no aparelho e navega
   * entre meses sem voltar ao servidor. */
  @Get()
  list(@Req() req: any) {
    return this.budgets.findAllByUser(req.user.id);
  }

  /** PUT e não POST: salvar o planejamento do mês é idempotente por natureza
   * — o mesmo corpo no mesmo mês deixa o mesmo resultado. */
  @Put(':month')
  save(@Req() req: any, @Param('month') month: string, @Body() dto: SaveBudgetDto) {
    return this.budgets.save({ userId: req.user.id, month, ...dto });
  }

  @Post(':month/copy')
  copy(@Req() req: any, @Param('month') month: string, @Body() dto: CopyBudgetDto) {
    return this.budgets.copy(req.user.id, dto.fromMonth, month);
  }

  @Delete(':month')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('month') month: string) {
    await this.budgets.remove(req.user.id, month);
  }
}
