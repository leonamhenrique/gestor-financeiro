// ============================================================
// goals.controller.ts
// ============================================================
// O dono vem sempre de `req.user.id`, nunca do corpo: quem manda o pedido
// não escolhe de quem é o objetivo.
// ============================================================

import { Controller, Get, Post, Patch, Delete, Body, Param, Req, HttpCode } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { CreateGoalDto, UpdateGoalDto, GoalMovementDto } from './dto/goal.dto';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateGoalDto) {
    return this.goals.create({ userId: req.user.id, ...dto });
  }

  @Get()
  list(@Req() req: any) {
    return this.goals.findAllByUser(req.user.id);
  }

  @Get(':id')
  one(@Req() req: any, @Param('id') id: string) {
    return this.goals.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.goals.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.goals.remove(id, req.user.id);
  }

  @Post(':id/deposits')
  aplicar(@Req() req: any, @Param('id') id: string, @Body() dto: GoalMovementDto) {
    return this.goals.aplicar(id, { userId: req.user.id, ...dto });
  }

  @Post(':id/withdrawals')
  resgatar(@Req() req: any, @Param('id') id: string, @Body() dto: GoalMovementDto) {
    return this.goals.resgatar(id, { userId: req.user.id, ...dto });
  }

  @Delete('movements/:movementId')
  @HttpCode(204)
  async removerMovimento(@Req() req: any, @Param('movementId') movementId: string) {
    await this.goals.removerMovimento(movementId, req.user.id);
  }
}
