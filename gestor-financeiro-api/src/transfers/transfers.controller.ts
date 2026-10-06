// ============================================================
// transfers.controller.ts
// ============================================================
// O dono vem sempre de `req.user.id`, nunca do corpo: quem manda o pedido
// não escolhe de quem é a transferência.
// ============================================================

import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, HttpCode } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { CreateTransferDto, UpdateTransferDto, ListTransfersQueryDto } from './dto/transfer.dto';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateTransferDto) {
    return this.transfers.create({ userId: req.user.id, ...dto });
  }

  @Get()
  list(@Req() req: any, @Query() query: ListTransfersQueryDto) {
    return this.transfers.findAllByUser(req.user.id, query);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTransferDto) {
    return this.transfers.update(id, dto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.transfers.remove(id, req.user.id);
  }
}
