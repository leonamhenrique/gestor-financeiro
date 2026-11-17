// ============================================================
// push.controller.ts — as três portas do aviso
// ============================================================
// Ler a chave pública, inscrever um aparelho, e desinscrevê-lo. Nada mais:
// QUANDO avisar não se decide por aqui — quem decide é o trabalho diário,
// que já conta quantos lançamentos esperam.
// ============================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty, MaxLength, ValidateNested, IsDefined } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PushService,
  chavePublicaDePush,
  problemaNaChavePublica,
  pushLigado,
} from './push.service';

class ChavesDoNavegadorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  auth!: string;
}

class InscreverDto {
  /* A URL que o serviço de push do navegador deu. Vem longa: 2048 é o teto
   * de URL que todo mundo respeita, e abaixo disso cortaria endpoint
   * legítimo. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ChavesDoNavegadorDto)
  keys!: ChavesDoNavegadorDto;
}

class DesinscreverDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  private readonly logger = new Logger('Push');

  /**
   * A chave pública, que o navegador precisa para se inscrever.
   *
   * `ligado: false` em vez de erro: sem as chaves no ambiente — ou com a
   * pública inválida — o recurso simplesmente não existe, e a tela some o
   * botão em vez de oferecer um caminho que termina em erro de navegador.
   */
  @Get('key')
  chave() {
    /* Configuração errada aparece no LOG de quem configurou, e não como um
     * erro de navegador no celular de quem usa. Só o diagnóstico, nunca o
     * valor da chave. */
    const problema = problemaNaChavePublica();
    if (problema && (process.env.VAPID_PRIVATE_KEY || '').trim()) {
      this.logger.warn(problema);
    }
    return { ligado: pushLigado(), chave: chavePublicaDePush() };
  }

  @Get('me')
  async minhas(@Req() req: any) {
    return { inscrito: await this.push.temInscricao(req.user.id) };
  }

  @Post('subscribe')
  @HttpCode(204)
  async inscrever(@Req() req: any, @Body() dto: InscreverDto) {
    await this.push.inscrever(req.user.id, dto);
  }

  @Delete('subscribe')
  @HttpCode(204)
  async desinscrever(@Req() req: any, @Body() dto: DesinscreverDto) {
    await this.push.desinscrever(req.user.id, dto.endpoint);
  }
}
