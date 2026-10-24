// ============================================================
// category-rules.controller.ts
// ============================================================

import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { CategoryRulesService } from './category-rules.service';
import { UpsertCategoryRulesDto } from './dto/category-rule.dto';

@Controller('category-rules')
export class CategoryRulesController {
  constructor(private readonly categoryRulesService: CategoryRulesService) {}

  @Get()
  listar(@Req() req: any) {
    return this.categoryRulesService.listar(req.user.id);
  }

  // PUT, e não POST: mandar a mesma leva duas vezes tem de deixar o mesmo
  // resultado. A importação que falha no meio é repetida inteira.
  @Put()
  upsert(@Req() req: any, @Body() dto: UpsertCategoryRulesDto) {
    return this.categoryRulesService.upsert(req.user.id, dto.rules);
  }

  @Delete(':id')
  remover(@Req() req: any, @Param('id') id: string) {
    return this.categoryRulesService.remover(req.user.id, id);
  }
}
