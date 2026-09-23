// ============================================================
// categories.controller.ts
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
} from '@nestjs/common';
import { ReorderDto } from '../common/reorder.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto, ListCategoriesQueryDto } from './dto/category.dto';

@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create({ userId: req.user.id, ...dto });
  }

  // GET /categories?type=EXPENSE
  @Get()
  findAll(@Req() req: any, @Query() query: ListCategoriesQueryDto) {
    return this.categoriesService.findAllForUser(req.user.id, query.type);
  }

  // PUT /categories/order { ids } — irmãs (mesmo pai e tipo), na nova ordem.
  @Put('order')
  reorder(@Req() req: any, @Body() dto: ReorderDto) {
    return this.categoriesService.reorder(req.user.id, dto.ids);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.categoriesService.findOneForUser(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(req.user.id, id, dto);
  }

  // DELETE /categories/:id?reassignToCategoryId=uuid
  @Delete(':id')
  remove(
    @Req() req: any,
    @Param('id') id: string,
    @Query('reassignToCategoryId') reassignToCategoryId?: string,
  ) {
    return this.categoriesService.delete(req.user.id, id, reassignToCategoryId);
  }
}
