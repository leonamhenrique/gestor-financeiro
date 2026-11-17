// ============================================================
// openfinance.webhook.controller.spec.ts — a única porta sem token do app
// ============================================================
// Todas as outras rotas deste módulo exigem a pessoa logada. Esta não pode:
// quem bate é o provedor. O que estes testes defendem é que ela continue
// sendo uma porta estreita — fechada por omissão, muda para quem não tem a
// chave, e incapaz de gravar dinheiro mesmo para quem tem.
// ============================================================

import { NotFoundException } from '@nestjs/common';

jest.mock('../prisma/contexto', () => ({
  comUsuario: (_userId: string, fn: () => any) => fn(),
}));

import { OpenFinanceWebhookController } from './openfinance.webhook.controller';

describe('OpenFinanceWebhookController', () => {
  let controller: OpenFinanceWebhookController;
  let prisma: any;
  let servico: any;
  const antes = { ...process.env };

  const SEGREDO = 'segredo-de-teste-bem-comprido-123456';

  beforeEach(() => {
    process.env.OPENFINANCE_ENABLED = 'true';
    process.env.POLP_WEBHOOK_TOKEN = SEGREDO;

    prisma = {
      openFinanceConnection: { findFirst: jest.fn().mockResolvedValue(null) },
      bankAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      creditCard: { findFirst: jest.fn().mockResolvedValue(null) },
      transaction: { create: jest.fn(), createMany: jest.fn(), update: jest.fn() },
    };
    servico = { recontarPendentes: jest.fn().mockResolvedValue(3) };

    controller = new OpenFinanceWebhookController(prisma, servico);
  });

  afterEach(() => {
    process.env = { ...antes };
    jest.restoreAllMocks();
  });

  const aviso = (resto: any = {}) => ({
    event: 'credit_cards.transactions',
    resource: 'credit-cards',
    resource_id: 'rec-1',
    ...resto,
  });

  /** O pedido, com os bytes crus — é deles que o HMAC se calcula. */
  const pedido = (corpo: any = null) => ({
    rawBody: Buffer.from(JSON.stringify(corpo ?? aviso())),
  });

  /** Deixa a conferência solta terminar antes do expect. */
  const esperar = () => new Promise((r) => setImmediate(r));

  // ---------------------------------------------------------------- porta
  it('com a flag desligada, a rota nao existe', () => {
    delete process.env.OPENFINANCE_ENABLED;
    expect(() => controller.receber(SEGREDO, {}, aviso(), pedido())).toThrow(NotFoundException);
    expect(prisma.openFinanceConnection.findFirst).not.toHaveBeenCalled();
  });

  /* O contrário disto — "sem segredo configurado, aceita todo mundo" — é a
   * falha que se instala sozinha: basta esquecer a variável num ambiente
   * novo e a porta fica aberta, em silêncio, funcionando. */
  it('sem segredo configurado, nao aceita nem quem manda token', () => {
    delete process.env.POLP_WEBHOOK_TOKEN;
    expect(() => controller.receber(SEGREDO, {}, aviso(), pedido())).toThrow(NotFoundException);
  });

  it('token errado e token ausente dao a MESMA resposta', () => {
    expect(() => controller.receber('outro-token-qualquer', {}, aviso(), pedido())).toThrow(NotFoundException);
    expect(() => controller.receber(undefined, {}, aviso(), pedido())).toThrow(NotFoundException);
  });

  /* 404, e não 403: 403 conta que a porta existe. */
  it('o token quase certo tambem e recusado', () => {
    expect(() => controller.receber(SEGREDO + 'x', {}, aviso(), pedido())).toThrow(NotFoundException);
    expect(() => controller.receber(SEGREDO.slice(0, -1), {}, aviso(), pedido())).toThrow(NotFoundException);
  });

  // ------------------------------------------------------------- roteamento
  /* Nos eventos de recurso o `resource_id` é o id do CONSENTIMENTO. */
  it('acha a conexao pelo consentimento', async () => {
    prisma.openFinanceConnection.findFirst.mockResolvedValue({ id: 'cx1', userId: 'u1' });

    controller.receber(SEGREDO, {}, aviso({ event: 'accounts', resource_id: 'consent-1' }), pedido());
    await esperar();

    expect(prisma.openFinanceConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { consentId: 'consent-1', revokedAt: null } }),
    );
    expect(servico.recontarPendentes).toHaveBeenCalledWith('u1', 'cx1');
  });

  /* Nos eventos de transação é o id da CONTA ou do CARTÃO lá. */
  it('acha a conexao pela conta ligada', async () => {
    prisma.bankAccount.findFirst.mockResolvedValue({ userId: 'u2', connectionId: 'cx2' });

    controller.receber(SEGREDO, {}, aviso({ event: 'accounts.transactions' }), pedido());
    await esperar();

    expect(servico.recontarPendentes).toHaveBeenCalledWith('u2', 'cx2');
  });

  it('acha a conexao pelo cartao ligado', async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ userId: 'u3', connectionId: 'cx3' });

    controller.receber(SEGREDO, {}, aviso(), pedido());
    await esperar();

    expect(servico.recontarPendentes).toHaveBeenCalledWith('u3', 'cx3');
  });

  /* Pode ser aviso de outro ambiente com as mesmas chaves, ou de uma conexão
   * já desconectada aqui. Não é erro, e não vira exceção. */
  it('aviso de algo que nao e nosso nao faz nada, e nao estoura', async () => {
    controller.receber(SEGREDO, {}, aviso({ resource_id: 'nao-existe' }), pedido());
    await esperar();

    expect(servico.recontarPendentes).not.toHaveBeenCalled();
  });

  it('corpo sem resource_id e ignorado', async () => {
    controller.receber(SEGREDO, {}, { event: 'accounts' }, pedido());
    await esperar();

    expect(prisma.openFinanceConnection.findFirst).not.toHaveBeenCalled();
    expect(servico.recontarPendentes).not.toHaveBeenCalled();
  });

  /* O corpo vem de fora: nada nele pode ser lido como ordem, e um campo com
   * tipo errado é só um campo com tipo errado. */
  it('resource_id que nao e texto nao vira consulta', async () => {
    controller.receber(SEGREDO, {}, { event: 'accounts', resource_id: { toString: () => 'x' } }, pedido());
    await esperar();

    expect(prisma.openFinanceConnection.findFirst).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------ assinatura
  /* Em duas fases de propósito. Enquanto o esquema não é conhecido, nada é
   * recusado por causa da assinatura: recusar pelo que ainda não se entende
   * perderia entregas boas em silêncio, que é o pior desfecho para um aviso
   * que não se repete para sempre. Conhecido, ele passa a ser exigido. */
  describe('assinatura', () => {
    const SIGNING = 'segredo-de-assinatura-da-polp';
    const corpo = aviso({ resource_id: 'consent-1' });
    const cru = Buffer.from(JSON.stringify(corpo));
    const assinar = (dados: Buffer) =>
      require('crypto').createHmac('sha256', SIGNING).update(dados).digest('hex');

    beforeEach(() => {
      process.env.POLP_WEBHOOK_SIGNING_SECRET = SIGNING;
      prisma.openFinanceConnection.findFirst.mockResolvedValue({ id: 'cx1', userId: 'u1' });
    });

    it('sem esquema conhecido, assinatura errada NAO recusa a entrega', async () => {
      delete process.env.OPENFINANCE_SIGNATURE;

      controller.receber(SEGREDO, { 'x-webhook-signature': 'nao-confere' }, corpo,
        { rawBody: cru });
      await esperar();

      expect(servico.recontarPendentes).toHaveBeenCalled();
    });

    it('com o esquema conhecido, assinatura certa passa', async () => {
      process.env.OPENFINANCE_SIGNATURE = 'corpo-hex';

      controller.receber(SEGREDO, { 'x-webhook-signature': assinar(cru) }, corpo,
        { rawBody: cru });
      await esperar();

      expect(servico.recontarPendentes).toHaveBeenCalledWith('u1', 'cx1');
    });

    it('com o esquema conhecido, assinatura errada e recusada', () => {
      process.env.OPENFINANCE_SIGNATURE = 'corpo-hex';

      expect(() =>
        controller.receber(SEGREDO, { 'x-webhook-signature': 'nao-confere' }, corpo,
          { rawBody: cru }),
      ).toThrow(NotFoundException);
      expect(servico.recontarPendentes).not.toHaveBeenCalled();
    });

    /* Token certo e assinatura ausente, com o esquema exigido: é o reenvio
     * de quem pegou o token mas não tem o segredo de assinatura. */
    it('com o esquema conhecido, entrega SEM assinatura e recusada', () => {
      process.env.OPENFINANCE_SIGNATURE = 'corpo-hex';

      expect(() => controller.receber(SEGREDO, {}, corpo, { rawBody: cru })).toThrow(
        NotFoundException,
      );
    });

    /* Exigir um esquema sem ter o segredo é configuração que não pode
     * funcionar: recusar alto é melhor que aceitar achando que confere. */
    it('esquema exigido sem segredo de assinatura recusa tudo', () => {
      process.env.OPENFINANCE_SIGNATURE = 'corpo-hex';
      delete process.env.POLP_WEBHOOK_SIGNING_SECRET;

      expect(() => controller.receber(SEGREDO, {}, corpo, { rawBody: cru })).toThrow(
        NotFoundException,
      );
    });

    /* O HMAC se calcula sobre os BYTES que chegaram. Se o corpo cru não
     * estiver disponível não há o que conferir — e, com esquema exigido,
     * isso é recusa, não "deixa passar". */
    it('sem corpo cru, com esquema exigido, recusa', () => {
      process.env.OPENFINANCE_SIGNATURE = 'corpo-hex';

      expect(() =>
        controller.receber(SEGREDO, { 'x-webhook-signature': assinar(cru) }, corpo, {}),
      ).toThrow(NotFoundException);
    });
  });

  // ------------------------------------------------------------- o contrato
  /* A integração PROPÕE. Uma chamada vinda de fora é o último lugar do app
   * onde gravar dinheiro seria aceitável. */
  it('nao grava lancamento nenhum', async () => {
    prisma.creditCard.findFirst.mockResolvedValue({ userId: 'u3', connectionId: 'cx3' });

    controller.receber(SEGREDO, {}, aviso(), pedido());
    await esperar();

    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  /* A resposta não espera a reconferência: ela baixa o extrato e leva
   * segundos, e quem está do outro lado repete o aviso quando o tempo
   * estoura. Segurar a resposta transformaria um aviso em três. */
  it('responde sem esperar a reconferencia', () => {
    prisma.openFinanceConnection.findFirst.mockReturnValue(new Promise(() => {}));

    expect(controller.receber(SEGREDO, {}, aviso({ resource_id: 'consent-1' }), pedido())).toBeUndefined();
  });

  /* Provedor fora, consentimento expirado, banco em manutenção: o aviso já
   * foi respondido, e a falha não pode virar promessa rejeitada solta — no
   * Node isso derruba o processo. */
  it('falha na reconferencia nao derruba nada', async () => {
    prisma.openFinanceConnection.findFirst.mockResolvedValue({ id: 'cx1', userId: 'u1' });
    servico.recontarPendentes.mockRejectedValue(new Error('provedor fora'));

    expect(() => controller.receber(SEGREDO, {}, aviso({ resource_id: 'consent-1' }), pedido())).not.toThrow();
    await esperar();
    await esperar();
  });
});
