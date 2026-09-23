// ============================================================
// bank-accounts.controller.ts
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
import { BankAccountsService } from './bank-accounts.service';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
  AdjustBalanceDto,
} from './dto/bank-account.dto';

@UseGuards(JwtAuthGuard)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateBankAccountDto) {
    return this.bankAccountsService.create({ userId: req.user.id, ...dto });
  }

  // GET /bank-accounts?includeInactive=true
  @Get()
  findAll(@Req() req: any, @Query('includeInactive') includeInactive?: string) {
    return this.bankAccountsService.findAllByUser(req.user.id, includeInactive === 'true');
  }

  // Usado pelo card de "saldo geral total" do Dashboard.
  @Get('total-balance')
  getTotalBalance(@Req() req: any) {
    return this.bankAccountsService.getTotalBalance(req.user.id);
  }

  // { visible, hidden, hiddenAccounts } — saldo geral separado das ocultas.
  @Get('balance-summary')
  getBalanceSummary(@Req() req: any) {
    return this.bankAccountsService.getBalanceSummary(req.user.id);
  }

  // PUT /bank-accounts/order { ids } — nova ordem da lista.
  @Put('order')
  reorder(@Req() req: any, @Body() dto: ReorderDto) {
    return this.bankAccountsService.reorder(req.user.id, dto.ids);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.bankAccountsService.findOneByUser(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateBankAccountDto) {
    return this.bankAccountsService.update(req.user.id, id, dto);
  }

  // Rota separada e explícita — deliberadamente fora do PATCH genérico
  // (ver regra de negócio no service).
  @Patch(':id/adjust-balance')
  adjustBalance(@Req() req: any, @Param('id') id: string, @Body() dto: AdjustBalanceDto) {
    return this.bankAccountsService.adjustBalance(req.user.id, id, dto.newBalance, dto.reason);
  }

  @Patch(':id/reactivate')
  reactivate(@Req() req: any, @Param('id') id: string) {
    return this.bankAccountsService.reactivate(req.user.id, id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.bankAccountsService.delete(req.user.id, id);
  }
}
