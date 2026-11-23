// ============================================================
// reports.controller.ts
// ============================================================
// A borda do relatório. Sem `@Public()`, então o guard global (JwtAuthGuard)
// exige sessão — e o usuário vem SEMPRE do token, nunca da query: deixar o
// cliente dizer de quem é o relatório seria entregar o extrato alheio a
// quem trocasse um parâmetro na URL.
// ============================================================

import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Funcao, FuncaoDoPlanoGuard } from '../billing/funcao-do-plano.guard';

@UseGuards(FuncaoDoPlanoGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /* A tela inteira é a função: sem ela no plano, não há meia resposta que
   * valha — meio fluxo de caixa é um gráfico que mente. */
  @Funcao('fluxoDeCaixa')
  @Get('cashflow')
  cashflow(@Req() req: any, @Query('year') year?: string) {
    const ano = year === undefined ? new Date().getUTCFullYear() : Number(year);
    // Faixa de sanidade: fora dela não há dado possível, e deixar passar
    // abriria consulta de intervalo arbitrário no banco.
    if (!Number.isInteger(ano) || ano < 1970 || ano > 2200) {
      throw new BadRequestException('Ano inválido.');
    }
    return this.reports.cashflow(req.user.id, ano);
  }
}
