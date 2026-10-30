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

import { Controller, Get, Headers, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ConversaService } from './conversa.service';
import { assinaturaConfere, mensagensDoPayload, responder } from './meta';

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  /* O log da porta existe para separar duas coisas que, de fora, são
   * idênticas: "a mensagem não chegou" e "chegou e foi recusada na entrada".
   * Sem isto, um App Secret errado e um webhook mal assinado têm exatamente o
   * mesmo sintoma — silêncio — e não há como saber qual dos dois consertar.
   *
   * Vai o FATO, nunca o conteúdo: nem o texto da mensagem, nem o número de
   * quem mandou. Quem lê o log de produção não precisa de nenhum dos dois, e
   * guardar isso em log seria guardar conversa. */
  private readonly log = new Logger('WhatsApp/webhook');

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
      this.log.log('handshake aceito');
      return q['hub.challenge'];
    }
    this.log.warn(
      segredo
        ? 'handshake recusado: o token não confere com WHATSAPP_VERIFY_TOKEN'
        : 'handshake recusado: WHATSAPP_VERIFY_TOKEN não está configurado',
    );
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
      // 200 mesmo assim, e calado para quem bateu. Mas no log do servidor
      // fica dito: senão o operador não tem como distinguir isto de "nada
      // chegou".
      this.log.warn(
        !process.env.WHATSAPP_APP_SECRET
          ? 'entrega recusada: WHATSAPP_APP_SECRET não está configurado'
          : !assinatura
            ? 'entrega recusada: veio sem cabeçalho de assinatura'
            : 'entrega recusada: assinatura não confere com o App Secret',
      );
      return '';
    }

    const mensagens = mensagensDoPayload(req.body);
    this.log.log('entrega aceita: ' + mensagens.length + ' mensagem(ns)');

    for (const m of mensagens) {
      // Uma mensagem ruim não pode derrubar as outras do mesmo lote.
      try {
        const resposta = await this.conversa.responderA(m);
        if (!resposta) continue;
        // Responder pode falhar por fora do app: número fora da lista de
        // destinatários permitidos (modo de teste), token vencido, janela de
        // 24h fechada. Sem este aviso, a pessoa vê silêncio e o servidor acha
        // que fez o seu trabalho.
        const foi = await responder(m.de, resposta);
        if (!foi) {
          this.log.warn(
            'resposta NÃO saiu: confira WHATSAPP_TOKEN, WHATSAPP_PHONE_ID e a lista de destinatários',
          );
        }
      } catch {
        /* o log de erro mora no serviço, com contexto */
      }
    }
    return '';
  }
}
