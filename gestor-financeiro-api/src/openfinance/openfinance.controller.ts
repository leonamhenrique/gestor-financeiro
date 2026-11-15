// ============================================================
// openfinance.controller.ts — as portas, atrás de uma flag e de uma lista
// ============================================================
// Sem `OPENFINANCE_ENABLED=true` nenhuma destas rotas existe: o guard
// responde 404, e não 403. A diferença importa — 403 conta que a coisa
// existe e você não pode; 404 é o app de antes, em que isto nunca foi
// escrito. É assim que "desistir" fica a uma variável de distância.
//
// E POR QUE NÃO BASTA A FLAG
// Ligar a flag publicaria a integração para TODO MUNDO de uma vez — e cada
// consentimento autorizado é cobrado na nossa conta do provedor, de quem
// quer que conecte. Experimento que custa dinheiro por pessoa não pode
// estrear no app inteiro. `OPENFINANCE_USERS` é a lista de quem enxerga:
// com ela, a integração sobe ligada e continua invisível para todos menos
// para quem está nela.
//
// Lista VAZIA quer dizer "todo mundo", que é o que a flag sozinha já dizia.
// O cuidado fica em ligar a flag sem a lista, e é por isso que isto está
// escrito aqui.
// ============================================================

import {
  CanActivate,
  ExecutionContext,
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
import { IsString, IsNotEmpty, Matches, IsIn, IsOptional } from 'class-validator';
import { OpenFinanceService, openFinanceLigado } from './openfinance.service';

/**
 * Quem enxerga a integração: ids ou e-mails, separados por vírgula.
 *
 * Aceita os dois porque quem configura sabe o próprio e-mail e não sabe o
 * próprio id — e pedir que vá cavá-lo no banco para ligar uma flag seria
 * transformar um passo de um minuto num de vinte.
 */
export function quemPodeOpenFinance(): string[] {
  return (process.env.OPENFINANCE_USERS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/** A flag e a lista, como guard: fora delas, o módulo inteiro desaparece. */
@Injectable()
export class OpenFinanceAtivo implements CanActivate {
  canActivate(contexto?: ExecutionContext): boolean {
    if (!openFinanceLigado()) throw new NotFoundException();

    const lista = quemPodeOpenFinance();
    if (!lista.length) return true;

    const usuario = contexto?.switchToHttp().getRequest()?.user || {};
    const meus = [usuario.id, usuario.email]
      .filter(Boolean)
      .map((x: string) => String(x).toLowerCase());
    /* Mesmo 404 de quando a flag está desligada: para quem não está na
     * lista, a integração não existe — e não "existe e é para outros". */
    if (!meus.some((x) => lista.includes(x))) throw new NotFoundException();
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

export class VincularDto {
  @IsString()
  @IsNotEmpty()
  providerAccountId: string;

  @IsIn(['CONTA', 'CARTAO'])
  destino: 'CONTA' | 'CARTAO';

  /** Nulo solta o vínculo: a conta volta a ser comum, com o histórico. */
  @IsOptional()
  @IsString()
  destinoId?: string | null;
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

  /** Liga um recurso de lá a uma conta/cartão daqui. `destinoId` nulo solta. */
  @Post('connections/:id/link')
  vincular(@Req() req: any, @Param('id') id: string, @Body() dto: VincularDto) {
    return this.openFinance.vincular(req.user.id, id, {
      providerAccountId: dto.providerAccountId,
      destino: dto.destino,
      destinoId: dto.destinoId ?? null,
    });
  }

  /** Revoga no provedor (o que para a cobrança) e encerra a conexão. */
  @Delete('connections/:id')
  desconectar(@Req() req: any, @Param('id') id: string) {
    return this.openFinance.desconectar(req.user.id, id);
  }
}
