// ============================================================
// openfinance.service.spec.ts
// ============================================================
// O que estes testes defendem, em ordem de gravidade:
//
// 1. Quem não conectar banco nenhum não é afetado — a flag desligada faz o
//    módulo responder 404, como se nunca tivesse sido escrito.
// 2. Nada aqui GRAVA lançamento. A integração propõe; quem decide é a tela.
// 3. Sincronizar de novo não propõe o que já entrou — a idempotência pelo
//    id do provedor.
// 4. As três armadilhas do payload, medidas em fatura de verdade: a data que
//    o fuso desloca, o valor sem sinal e a parcela ainda não faturada.
// 5. O CPF atravessa e some.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpenFinanceService } from './openfinance.service';
import { OpenFinanceAtivo } from './openfinance.controller';
import { PolpClient, ConflitoDeConsentimento } from './polp.client';
import { PrismaService } from '../prisma/prisma.service';

describe('OpenFinance', () => {
  let service: OpenFinanceService;
  let polp: any;
  let prisma: any;

  const CONEXAO = {
    id: 'cx1',
    userId: 'u1',
    consentId: 'consent-1',
    institutionId: 'inst-1',
    institutionName: 'Banco Inter PF',
    status: 'AUTHORISED',
    authorizedAt: new Date('2026-11-15T12:00:00Z'),
    revokedAt: null,
  };

  beforeEach(async () => {
    polp = {
      instituicoes: jest.fn().mockResolvedValue([
        { id: 'inst-1', nome: 'Banco Inter PF', tipo: 'PERSONAL', disponivel: true },
        { id: 'inst-2', nome: 'Banco Fechado', tipo: 'PERSONAL', disponivel: false },
      ]),
      criarConsentimento: jest.fn().mockResolvedValue({
        consentId: 'consent-1',
        status: 'AWAITING_AUTHORIZATION',
        urlParaAutorizar: 'https://api.polp.com.br/c/abc',
        urlExpiraEm: '2026-11-15T16:27:01.000Z',
        reaproveitado: false,
      }),
      consentimento: jest.fn().mockResolvedValue({ status: 'AUTHORISED', execucao: 'SUCCESS' }),
      contas: jest.fn().mockResolvedValue([]),
      cartoes: jest.fn().mockResolvedValue([]),
      diasDoCartao: jest.fn().mockResolvedValue({ fechamento: 30, vencimento: 7 }),
      transacoesDaConta: jest.fn().mockResolvedValue([]),
      transacoesDoCartao: jest.fn().mockResolvedValue([]),
      revogar: jest.fn().mockResolvedValue(undefined),
    };

    prisma = {
      openFinanceConnection: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'cx1', ...data })),
        upsert: jest.fn().mockImplementation(({ create }: any) => ({ id: 'cx1', ...create })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(CONEXAO),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...CONEXAO, ...data })),
      },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      creditCard: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenFinanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: PolpClient, useValue: polp },
      ],
    }).compile();

    service = module.get(OpenFinanceService);
  });

  // ----------------------------------------------------------------------
  describe('quem enxerga a integracao', () => {
    const antes = { ...process.env };
    afterEach(() => {
      process.env = { ...antes };
    });

    /** Um contexto de requisicao como o Nest entrega, com o usuario logado. */
    const como = (usuario: any) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ user: usuario }) }) }) as any;

    const EU = { id: 'u-1', email: 'dono@exemplo.com' };
    const OUTRO = { id: 'u-2', email: 'alguem@exemplo.com' };

    /* 404 e nao 403: 403 conta que existe e voce nao pode. 404 e o app de
     * antes, em que isto nunca foi escrito. */
    it('sem a variavel, as rotas nao existem', () => {
      delete process.env.OPENFINANCE_ENABLED;
      expect(() => new OpenFinanceAtivo().canActivate(como(EU))).toThrow(NotFoundException);
    });

    it('"false" tambem e desligado', () => {
      process.env.OPENFINANCE_ENABLED = 'false';
      expect(() => new OpenFinanceAtivo().canActivate(como(EU))).toThrow(NotFoundException);
    });

    it('ligada e sem lista: todo mundo', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      delete process.env.OPENFINANCE_USERS;
      expect(new OpenFinanceAtivo().canActivate(como(OUTRO))).toBe(true);
    });

    /* O caso que esta lista existe para resolver: a integracao sobe LIGADA em
     * producao e mesmo assim nao estreia para o app inteiro -- cada
     * consentimento autorizado e cobrado, de quem quer que conecte. */
    it('com lista, quem esta nela entra', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      process.env.OPENFINANCE_USERS = 'dono@exemplo.com';
      expect(new OpenFinanceAtivo().canActivate(como(EU))).toBe(true);
    });

    it('com lista, quem nao esta nela ve o MESMO 404 de desligado', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      process.env.OPENFINANCE_USERS = 'dono@exemplo.com';
      expect(() => new OpenFinanceAtivo().canActivate(como(OUTRO))).toThrow(NotFoundException);
    });

    it('vale pelo id tambem, nao so pelo e-mail', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      process.env.OPENFINANCE_USERS = 'u-1';
      expect(new OpenFinanceAtivo().canActivate(como(EU))).toBe(true);
      expect(() => new OpenFinanceAtivo().canActivate(como(OUTRO))).toThrow(NotFoundException);
    });

    /* Quem digita a lista no painel digita com espaco depois da virgula e com
     * a maiuscula que o teclado do telefone poe sozinha. Nenhum dos dois pode
     * custar uma tarde de "liguei e nao apareceu". */
    it('espaco e maiuscula nao derrubam ninguem', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      process.env.OPENFINANCE_USERS = ' Dono@Exemplo.com , outro@exemplo.com ';
      expect(new OpenFinanceAtivo().canActivate(como(EU))).toBe(true);
    });

    it('lista so de virgulas conta como vazia, e nao tranca todo mundo', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      process.env.OPENFINANCE_USERS = ' , , ';
      expect(new OpenFinanceAtivo().canActivate(como(OUTRO))).toBe(true);
    });
  });

  // ----------------------------------------------------------------------
  describe('conectar', () => {
    it('guarda a conexao e devolve o link para o DONO autorizar', async () => {
      const r = await service.conectar('u1', { institutionId: 'inst-1', cpf: '123.456.789-00' });

      expect(r.urlParaAutorizar).toBe('https://api.polp.com.br/c/abc');
      expect(polp.criarConsentimento).toHaveBeenCalledWith(
        expect.objectContaining({ institutionId: 'inst-1', cpf: '12345678900', clienteUserId: 'u1' }),
      );
    });

    /* O CPF e documento: guardar o de alguem por uma integracao OPCIONAL
     * aumenta o que se perde num vazamento em troca de nada. Na reconexao
     * ele digita de novo, uma vez por ano. */
    it('o CPF atravessa e some: nao vai para o banco de dados', async () => {
      await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' });

      const gravado = JSON.stringify(prisma.openFinanceConnection.upsert.mock.calls[0][0]);
      expect(gravado).not.toContain('12345678900');
      expect(gravado).toContain('consent-1');
    });

    it('CPF torto nao chega a sair do app', async () => {
      await expect(
        service.conectar('u1', { institutionId: 'inst-1', cpf: '123' }),
      ).rejects.toThrow(BadRequestException);
      expect(polp.criarConsentimento).not.toHaveBeenCalled();
    });

    /* O defeito que esta parte conserta custou caro: cada criacao de
     * consentimento QUEIMA a cota mensal do CPF naquela instituicao, e seis
     * tentativas num dia gastaram o mes de um banco. A v3 responde 409 em
     * vez de criar de novo -- e 409 aqui nao e erro, e resposta. */
    it('ja autorizado: ADOTA o consentimento em vez de criar outro', async () => {
      polp.criarConsentimento.mockRejectedValue(
        new ConflitoDeConsentimento('CONSENT_ALREADY_AUTHORISED', 'consent-ja-existe'),
      );

      const r = await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' });

      expect(r.jaConectado).toBe(true);
      expect(r.urlParaAutorizar).toBeNull();
      expect(prisma.openFinanceConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider_consentId: { provider: 'POLP', consentId: 'consent-ja-existe' } },
        }),
      );
    });

    it('link ainda vivo: nao gera outro, e diz ate quando esperar', async () => {
      polp.criarConsentimento.mockRejectedValue(
        new ConflitoDeConsentimento('AUTHORIZATION_LINK_ACTIVE', null, '2026-11-15T18:00:00Z'),
      );

      await expect(
        service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' }),
      ).rejects.toThrow(/2026-11-15T18:00:00Z/);
      expect(prisma.openFinanceConnection.upsert).not.toHaveBeenCalled();
    });

    it('criacao em andamento vira "tente em instantes"', async () => {
      polp.criarConsentimento.mockRejectedValue(
        new ConflitoDeConsentimento('CONSENT_CREATION_IN_PROGRESS'),
      );
      await expect(
        service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' }),
      ).rejects.toThrow(BadRequestException);
    });

    /* O indice unico e por (provider, consentId), sem o dono. Um upsert cego
     * trocaria o dono de um consentimento -- e com ele, de uma conta
     * bancaria inteira. */
    it('consentimento de outra conta nao se adota', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue({ id: 'cx9', userId: 'outro' });
      polp.criarConsentimento.mockRejectedValue(
        new ConflitoDeConsentimento('CONSENT_ALREADY_AUTHORISED', 'consent-de-outro'),
      );

      await expect(
        service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' }),
      ).rejects.toThrow(/outra conta/);
      expect(prisma.openFinanceConnection.upsert).not.toHaveBeenCalled();
    });

    it('reaproveitado: grava pelo upsert, e nao cria linha nova', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue(null);
      polp.criarConsentimento.mockResolvedValue({
        consentId: 'consent-1',
        status: 'AWAITING_AUTHORIZATION',
        urlParaAutorizar: 'https://api.polp.com.br/c/xyz',
        urlExpiraEm: null,
        reaproveitado: true,
      });

      const r = await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' });

      expect(r.reaproveitado).toBe(true);
      expect(prisma.openFinanceConnection.create).not.toHaveBeenCalled();
      expect(prisma.openFinanceConnection.upsert).toHaveBeenCalled();
    });

    it('instituicao que nao existe nao vira conexao', async () => {
      await expect(
        service.conectar('u1', { institutionId: 'nao-existe', cpf: '12345678900' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.openFinanceConnection.upsert).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  describe('propor, sem gravar', () => {
    const compra = (id: string, resto: any = {}) => ({
      providerTxId: id,
      data: '2026-11-12',
      valor: 66,
      tipo: 'EXPENSE',
      descricao: 'DELICINHA DA PENHA',
      parcela: null,
      faturada: true,
      faturaPrevista: '2026-12',
      pagamentoDeFatura: false,
      ...resto,
    });

    beforeEach(() => {
      polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-lá', nome: 'GOLD' }]);
      polp.transacoesDoCartao.mockResolvedValue([compra('tx-1'), compra('tx-2')]);
    });

    it('nenhum lancamento e criado: a integracao PROPOE', async () => {
      await service.paraImportar('u1', 'cx1');

      expect(prisma.transaction.create).not.toHaveBeenCalled();
      expect(prisma.transaction.createMany).not.toHaveBeenCalled();
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    /* O caso que esta coluna existe para resolver: o provedor reenvia TUDO
     * a cada leitura. Sem este corte, a lista de conferencia viria cheia do
     * que a pessoa ja importou ontem -- e aceitar duas vezes e dinheiro
     * contado em dobro. */
    it('a segunda sincronizacao nao propoe o que ja entrou', async () => {
      prisma.transaction.findMany.mockResolvedValue([{ providerTxId: 'tx-1' }]);

      const r = await service.paraImportar('u1', 'cx1');

      expect(r.cartoes[0].lancamentos.map((l: any) => l.providerTxId)).toEqual(['tx-2']);
      expect(r.jaSincronizados).toBe(1);
    });

    it('os dias do cartao vem das faturas, para a tela poder comparar', async () => {
      const r = await service.paraImportar('u1', 'cx1');
      expect(r.cartoes[0]).toMatchObject({ fechamento: 30, vencimento: 7 });
    });

    it('conexao ainda nao autorizada nao sincroniza', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue({
        ...CONEXAO,
        status: 'AWAITING_AUTHORIZATION',
      });
      await expect(service.paraImportar('u1', 'cx1')).rejects.toThrow(BadRequestException);
    });

    it('conexao de outra pessoa nao existe', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue(null);
      await expect(service.paraImportar('u2', 'cx1')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------------------
  describe('vincular', () => {
    it('liga o cartao de la ao cartao daqui', async () => {
      prisma.creditCard.findFirst.mockResolvedValue({ id: 'k-daqui' });

      const r = await service.vincular('u1', 'cx1', {
        providerAccountId: 'k-la',
        destino: 'CARTAO',
        destinoId: 'k-daqui',
      });

      expect(r.vinculado).toBe(true);
      expect(prisma.creditCard.update).toHaveBeenCalledWith({
        where: { id: 'k-daqui' },
        data: { connectionId: 'cx1', providerAccountId: 'k-la' },
      });
    });

    /* Um cartao de la corresponde a UM daqui. Trocar sem soltar o anterior
     * esbarraria no indice unico da migracao -- e o erro apareceria como
     * "nao consegui salvar", sem dizer que o problema era o vinculo velho. */
    it('trocar o destino solta o anterior antes', async () => {
      prisma.creditCard.findFirst.mockResolvedValue({ id: 'k-novo' });

      await service.vincular('u1', 'cx1', {
        providerAccountId: 'k-la',
        destino: 'CARTAO',
        destinoId: 'k-novo',
      });

      expect(prisma.creditCard.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', connectionId: 'cx1', providerAccountId: 'k-la' },
        data: { connectionId: null, providerAccountId: null },
      });
    });

    /* Desvincular e a volta para o estado de antes: a conta continua sendo a
     * conta da pessoa, com o historico inteiro -- so deixa de ser alimentada. */
    it('destino nulo solta o vinculo e nao apaga nada', async () => {
      const r = await service.vincular('u1', 'cx1', {
        providerAccountId: 'a-la',
        destino: 'CONTA',
        destinoId: null,
      });

      expect(r.vinculado).toBe(false);
      expect(prisma.bankAccount.updateMany).toHaveBeenCalled();
      expect(prisma.bankAccount.update).not.toHaveBeenCalled();
    });

    it('conta de outra pessoa nao se vincula', async () => {
      prisma.bankAccount.findFirst.mockResolvedValue(null);
      await expect(
        service.vincular('u1', 'cx1', {
          providerAccountId: 'a-la',
          destino: 'CONTA',
          destinoId: 'de-outro',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------------------
  describe('desconectar', () => {
    it('revoga no provedor ANTES de marcar, porque e isso que para a cobranca', async () => {
      const ordem: string[] = [];
      polp.revogar.mockImplementation(async () => { ordem.push('revogou'); });
      prisma.openFinanceConnection.update.mockImplementation(async () => {
        ordem.push('marcou');
        return CONEXAO;
      });

      await service.desconectar('u1', 'cx1');
      expect(ordem).toEqual(['revogou', 'marcou']);
    });

    /* Falhou a revogacao, a conexao NAO e marcada: marcada e sem revogar,
     * ela sairia da tela continuando a ser cobrada, e ninguem descobriria. */
    it('se a revogacao falha, a conexao continua viva para tentar de novo', async () => {
      polp.revogar.mockRejectedValue(new Error('provedor fora'));

      await expect(service.desconectar('u1', 'cx1')).rejects.toThrow();
      expect(prisma.openFinanceConnection.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  describe('situacao', () => {
    it('autorizou agora: grava QUANDO, que e desde quando custa', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue({
        ...CONEXAO,
        status: 'AWAITING_AUTHORIZATION',
        authorizedAt: null,
      });

      const r = await service.situacao('u1', 'cx1');

      expect(prisma.openFinanceConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'AUTHORISED', authorizedAt: expect.any(Date) }),
        }),
      );
      expect(r.pronta).toBe(true);
    });

    it('ja autorizada antes: a data NAO se reescreve', async () => {
      await service.situacao('u1', 'cx1');
      const data = prisma.openFinanceConnection.update.mock.calls[0][0].data;
      expect(data.authorizedAt).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------------
  describe('instituicoes', () => {
    it('sem busca, so as que dao para conectar agora', async () => {
      const r = await service.instituicoes();
      expect(r.map((i: any) => i.nome)).toEqual(['Banco Inter PF']);
    });
  });
});
