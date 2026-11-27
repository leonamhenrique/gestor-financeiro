// ============================================================
// support.controller.ts
// ============================================================
// Autenticada, e com teto apertado: a rota manda e-mail, então um laço num
// console vira uma conta de provedor e uma caixa de entrada inutilizável.
// Cinco por dez minutos é folgado para quem escreve de verdade e estreito
// para quem não está escrevendo.
// ============================================================

import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SupportService, LIMITE_DO_TEXTO, enderecoDeContato } from './support.service';

export class MensagemDto {
  @IsIn(['SUPORTE', 'IDEIA'])
  tipo: 'SUPORTE' | 'IDEIA';

  @IsString()
  @IsNotEmpty({ message: 'Escreva a mensagem antes de enviar.' })
  @MaxLength(LIMITE_DO_TEXTO)
  texto: string;
}

interface RequisicaoAutenticada extends Request {
  user: { id?: string; sub?: string };
}

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /**
   * A tela pergunta antes de oferecer o formulário.
   *
   * O endereço vai junto de propósito. Sem serviço de e-mail configurado o
   * certo NÃO é esconder o Suporte — é a última porta de quem está com
   * problema. A tela passa a mostrar o endereço para a pessoa escrever do
   * aparelho dela, que é pior que o formulário e muito melhor que nada.
   */
  @Get()
  estado() {
    return { disponivel: this.support.disponivel(), contato: enderecoDeContato() };
  }

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post()
  enviar(@Req() req: RequisicaoAutenticada, @Body() dto: MensagemDto) {
    const userId = req.user.id ?? req.user.sub!;
    return this.support.enviar(userId, dto.tipo, dto.texto);
  }
}
