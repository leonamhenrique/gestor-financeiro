// ============================================================
// people.controller.ts
// ============================================================
// O dono vem sempre de `req.user.id`, nunca do corpo: quem manda o pedido
// não escolhe de quem é a pessoa.
// ============================================================

import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { PeopleService } from './people.service';
import { CreatePersonDto, UpdatePersonDto, ReorderPeopleDto } from './dto/person.dto';

@Controller('shared/people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreatePersonDto) {
    return this.people.create({ userId: req.user.id, ...dto });
  }

  @Get()
  list(@Req() req: any, @Query('includeArchived') includeArchived?: string) {
    return this.people.findAllByUser(req.user.id, includeArchived === 'true');
  }

  @Patch('reorder')
  reorder(@Req() req: any, @Body() dto: ReorderPeopleDto) {
    return this.people.reorder(req.user.id, dto.ids);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdatePersonDto) {
    return this.people.update(req.user.id, id, dto);
  }

  @Patch(':id/reactivate')
  reactivate(@Req() req: any, @Param('id') id: string) {
    return this.people.reactivate(req.user.id, id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.people.delete(req.user.id, id);
  }
}
