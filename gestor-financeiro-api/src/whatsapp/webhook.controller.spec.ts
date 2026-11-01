// ============================================================
// webhook.controller.spec.ts
// ============================================================
// A porta aberta. O que se prova aqui é o que ela faz com quem bate:
// responde 200 e calada para todo mundo, deixa entrar só quem assinou, e
// escreve no log do servidor o que não diz para fora.
// ============================================================

import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { WhatsappWebhookController } from './webhook.controller';

const SEGREDO = 'app-secret-de-teste';

function pedido(corpo: any, segredo = SEGREDO) {
  const rawBody = Buffer.from(JSON.stringify(corpo), 'utf8');
  const assinatura = 'sha256=' + createHmac('sha256', segredo).update(rawBody).digest('hex');
  return { req: { rawBody, body: corpo }, assinatura };
}

const comMensagem = {
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              { from: '5531975696594', id: 'm1', type: 'text', text: { body: 'oi' } },
            ],
          },
        },
      ],
    },
  ],
};

// O que a Meta manda a cada "enviado", "entregue" e "lido".
const soStatus = {
  entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }],
};

describe('WhatsappWebhookController', () => {
  let controller: WhatsappWebhookController;
  let conversa: any;
  let logs: string[];
  let avisos: string[];
  const env = { ...process.env };

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = SEGREDO;
    // Sem token nem phone id: `responder` devolve o motivo sem tocar na rede.
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_ID;

    logs = [];
    avisos = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: any) => {
      logs.push(String(m));
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => {
      avisos.push(String(m));
    });

    conversa = { responderA: jest.fn(async () => null) };
    controller = new WhatsappWebhookController(conversa);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...env };
  });

  describe('o aperto de mao', () => {
    it('devolve o desafio quando o token confere', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'combinado';
      const r = controller.verificar({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'combinado',
        'hub.challenge': '12345',
      });
      expect(r).toBe('12345');
      expect(logs.join(' ')).toContain('handshake aceito');
    });

    it('e nada quando nao confere, dizendo no log qual foi o caso', () => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'combinado';
      expect(
        controller.verificar({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'outro',
          'hub.challenge': '12345',
        }),
      ).toBe('');
      expect(avisos.join(' ')).toMatch(/n[ãa]o confere/);
    });

    it('sem a variavel configurada, recusa e diz isso', () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      expect(
        controller.verificar({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'qualquer',
          'hub.challenge': '12345',
        }),
      ).toBe('');
      expect(avisos.join(' ')).toContain('WHATSAPP_VERIFY_TOKEN');
    });
  });

  describe('a entrega', () => {
    it('a mensagem assinada entra, e o log conta quantas', async () => {
      const { req, assinatura } = pedido(comMensagem);
      await controller.receber(req, assinatura);
      expect(conversa.responderA).toHaveBeenCalledTimes(1);
      expect(logs.join(' ')).toContain('entrega aceita: 1 mensagem(ns)');
    });

    it('aviso de entrega e leitura nao vira linha de log', async () => {
      // Sao tres por conversa. Um log cheio de nada e um log que ninguem olha.
      const { req, assinatura } = pedido(soStatus);
      await controller.receber(req, assinatura);
      expect(conversa.responderA).not.toHaveBeenCalled();
      expect(logs.join(' ')).not.toContain('entrega aceita');
    });

    it('assinatura errada nao entra, e o log diz por que', async () => {
      const { req } = pedido(comMensagem, 'outro-segredo');
      const { assinatura } = pedido(comMensagem);
      // corpo assinado com um segredo, cabeçalho de outro
      await controller.receber(req, assinatura.replace(/.$/, '0'));
      expect(conversa.responderA).not.toHaveBeenCalled();
      expect(avisos.join(' ')).toMatch(/assinatura n[ãa]o confere/);
    });

    it('sem o App Secret configurado, nada passa', async () => {
      delete process.env.WHATSAPP_APP_SECRET;
      const { req, assinatura } = pedido(comMensagem);
      await controller.receber(req, assinatura);
      expect(conversa.responderA).not.toHaveBeenCalled();
      expect(avisos.join(' ')).toContain('WHATSAPP_APP_SECRET');
    });

    it('responde sempre 200 vazio, para quem acertou e para quem errou', async () => {
      const bom = pedido(comMensagem);
      expect(await controller.receber(bom.req, bom.assinatura)).toBe('');
      const ruim = pedido(comMensagem);
      expect(await controller.receber(ruim.req, 'sha256=errado')).toBe('');
    });

    it('uma mensagem que estoura nao derruba as outras do lote', async () => {
      conversa.responderA = jest
        .fn()
        .mockRejectedValueOnce(new Error('pane'))
        .mockResolvedValueOnce(null);
      const duas = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '5531975696594', id: 'm1', type: 'text', text: { body: 'a' } },
                    { from: '5531975696594', id: 'm2', type: 'text', text: { body: 'b' } },
                  ],
                },
              },
            ],
          },
        ],
      };
      const { req, assinatura } = pedido(duas);
      await expect(controller.receber(req, assinatura)).resolves.toBe('');
      expect(conversa.responderA).toHaveBeenCalledTimes(2);
    });

    it('a resposta que nao sai deixa o motivo no log', async () => {
      conversa.responderA = jest.fn(async () => 'alguma resposta');
      const { req, assinatura } = pedido(comMensagem);
      await controller.receber(req, assinatura);
      // Sem WHATSAPP_TOKEN, o motivo é esse — e ele chega ao log inteiro.
      expect(avisos.join(' ')).toMatch(/resposta N[ÃA]O saiu: .*WHATSAPP_TOKEN/);
    });
  });
});
