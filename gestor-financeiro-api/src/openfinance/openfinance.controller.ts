// ============================================================
// openfinance.controller.ts — as portas, todas atrás de uma flag
// ============================================================
// Sem `OPENFINANCE_ENABLED=true` nenhuma destas rotas existe: o guard
// responde 404, e não 403. A diferença importa — 403 conta que a coisa
// existe e você não pode; 404 é o app de antes, em que isto nunca foi
// escrito. É assim que "desistir" fica a uma variável de distância.
// ============================================================

import {
  CanActivate,
  Controller,
  Injectable,
  NotFoundException,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { OpenFinanceService, openFinanceLigado } from './openfinance.service';

/** A flag, como guard: desligada, o módulo inteiro desaparece. */
@Injectable()
export class OpenFinanceAtivo implements CanActivate {
  canActivate(): boolean {
    if (!openFinanceLigado()) throw new NotFoundException();
    return true;
  }
}

export class ConectarDto {
  @IsString()
  @IsNotEmpty()
  institutionId: string;

  /* O CPF chega, atravessa até o provedor e some — não é gravado em lugar
   * nenhum. Ver a nota em `PolpClient.criarConsentimento`. */
  @IsString()
  @Matches(/^\d{11}$/, { message: 'CPF deve ter 11 dígitos.' })
  cpf: string;
}

@UseGuards(OpenFinanceAtivo)
@Controller('openfinance')
export class OpenFinanceController {
  constructor(private readonly openFinance: OpenFinanceService) {}

  /** Os bancos que dá para conectar. `?q=` filtra pelo nome. */
  @Get('institutions')
  instituicoes(@Query('q') q?: string) {
    return this.openFinance.instituicoes(q);
  }

  @Get('connections')
  listar(@Req() req: any) {
    return this.openFinance.listar(req.user.id);
  }

  /** Cria o consentimento e devolve o link que o DONO DA CONTA vai abrir. */
  @Post('connections')
  conectar(@Req() req: any, @Body() dto: ConectarDto) {
    return this.openFinance.conectar(req.user.id, dto);
  }

  @Get('connections/:id')
  situacao(@Req() req: any, @Param('id') id: string) {
    return this.openFinance.situacao(req.user.id, id);
  }

  /**
   * O que o banco tem e o app ainda não.
   *
   * É POST porque fala com o provedor e carimba `lastSyncedAt` — mas não
   * grava lançamento nenhum: devolve a PROPOSTA para a tela conferir.
   */
  @Post('connections/:id/sync')
  sincronizar(@Req() req: any, @Param('id') id: string) {
    return this.openFinance.paraImportar(req.user.id, id);
  }

  /** Revoga no provedor (o que para a cobrança) e encerra a conexão. */
  @Delete('connections/:id')
  desconectar(@Req() req: any, @Param('id') id: string) {
    return this.openFinance.desconectar(req.user.id, id);
  }
}
