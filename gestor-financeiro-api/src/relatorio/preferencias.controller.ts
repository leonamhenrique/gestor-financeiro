// ============================================================
// preferencias.controller.ts
// ============================================================
// A preferência que decide o número dos relatórios.
//
// Mora aqui, e não na autenticação, porque é o relatório que a usa — e porque
// foi o relatório pelo WhatsApp que a tirou do navegador. O app continua
// guardando a escolha em `localStorage` para lembrar dela offline; a verdade,
// agora, é esta rota.
// ============================================================

import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { PreferenciasDto } from './dto/preferencias.dto';
import { RelatorioService } from './relatorio.service';

@Controller('preferences')
export class PreferenciasController {
  constructor(private readonly relatorio: RelatorioService) {}

  @Get()
  async ler(@Req() req: any) {
    return { reportRegime: await this.relatorio.regime(req.user.id) };
  }

  @Patch()
  async salvar(@Req() req: any, @Body() dto: PreferenciasDto) {
    return { reportRegime: await this.relatorio.definirRegime(req.user.id, dto.reportRegime) };
  }
}
