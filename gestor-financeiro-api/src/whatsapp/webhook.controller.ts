// ============================================================
// webhook.controller.ts
// ============================================================
// A porta por onde a Meta entrega as mensagens.
//
// É pública por natureza: quem chama é outro servidor, sem token de usuário.
// Por isso ela tem as três defesas que uma rota aberta precisa ter:
//
//   1. a assinatura do corpo bruto (HMAC com o App Secret). Sem isso,
//      qualquer um manda um JSON dizendo ser o número de alguém;
//   2. limite de requisições, como a página pública de despesa compartilhada;
//   3. resposta SEMPRE 200, sem corpo e sem detalhe — nem para quem acertou,
//      nem para quem errou. A Meta reentrega o que não responde 200, e
//      explicar o erro para quem bate na porta é ensinar a arrombá-la.
// ============================================================

import { Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ConversaService } from './conversa.service';
import { assinaturaConfere, mensagensDoPayload, responder } from './meta';

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly conversa: ConversaService) {}

  /**
   * O aperto de mão da Meta, uma vez, quando o webhook é cadastrado: ela
   * chama com um desafio e espera o desafio de volta, em texto puro.
   *
   * O `verify_token` é combinado no painel da Meta e guardado aqui como
   * variável de ambiente. Sem ele configurado, nada é devolvido — melhor o
   * cadastro falhar do que um webhook de outra pessoa apontar para cá.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Get()
  verificar(@Query() q: Record<string, string>) {
    const segredo = process.env.WHATSAPP_VERIFY_TOKEN;
    if (segredo && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === segredo) {
      return q['hub.challenge'];
    }
    return '';
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post()
  @HttpCode(200)
  async receber(
    @Req() req: { rawBody?: Buffer; body?: any },
    @Headers('x-hub-signature-256') assinatura: string,
  ) {
    if (!assinaturaConfere(req.rawBody, assinatura, process.env.WHATSAPP_APP_SECRET)) {
      // 200 mesmo assim, e calado. Um 401 aqui diria ao curioso que ele achou
      // uma rota viva, e faria a Meta reentregar o que já foi recusado.
      return '';
    }

    for (const m of mensagensDoPayload(req.body)) {
      // Uma mensagem ruim não pode derrubar as outras do mesmo lote.
      try {
        const resposta = await this.conversa.responderA(m);
        if (resposta) await responder(m.de, resposta);
      } catch {
        /* o log de erro mora no serviço, com contexto */
      }
    }
    return '';
  }
}
