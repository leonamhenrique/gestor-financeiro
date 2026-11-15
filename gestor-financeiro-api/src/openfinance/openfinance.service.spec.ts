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
import { PolpClient } from './polp.client';
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
        urlParaAutorizar: 'https://banco.exemplo/autorizar',
        urlExpiraEm: '2026-11-15T16:27:01.000Z',
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
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(CONEXAO),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...CONEXAO, ...data })),
      },
      bankAccount: { findFirst: jest.fn().mockResolvedValue(null) },
      creditCard: { findFirst: jest.fn().mockResolvedValue(null) },
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
  describe('a flag desligada apaga o modulo', () => {
    const antes = process.env.OPENFINANCE_ENABLED;
    afterEach(() => {
      if (antes === undefined) delete process.env.OPENFINANCE_ENABLED;
      else process.env.OPENFINANCE_ENABLED = antes;
    });

    /* 404 e nao 403: 403 conta que existe e voce nao pode. 404 e o app de
     * antes, em que isto nunca foi escrito. */
    it('sem a variavel, as rotas nao existem', () => {
      delete process.env.OPENFINANCE_ENABLED;
      expect(() => new OpenFinanceAtivo().canActivate()).toThrow(NotFoundException);
    });

    it('"false" tambem e desligado', () => {
      process.env.OPENFINANCE_ENABLED = 'false';
      expect(() => new OpenFinanceAtivo().canActivate()).toThrow(NotFoundException);
    });

    it('so "true" liga', () => {
      process.env.OPENFINANCE_ENABLED = 'true';
      expect(new OpenFinanceAtivo().canActivate()).toBe(true);
    });
  });

  // ----------------------------------------------------------------------
  describe('conectar', () => {
    it('guarda a conexao e devolve o link para o DONO autorizar', async () => {
      const r = await service.conectar('u1', { institutionId: 'inst-1', cpf: '123.456.789-00' });

      expect(r.urlParaAutorizar).toBe('https://banco.exemplo/autorizar');
      expect(polp.criarConsentimento).toHaveBeenCalledWith(
        expect.objectContaining({ institutionId: 'inst-1', cpf: '12345678900', clienteUserId: 'u1' }),
      );
    });

    /* O CPF e documento: guardar o de alguem por uma integracao OPCIONAL
     * aumenta o que se perde num vazamento em troca de nada. Na reconexao
     * ele digita de novo, uma vez por ano. */
    it('o CPF atravessa e some: nao vai para o banco de dados', async () => {
      await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678900' });

      const gravado = JSON.stringify(prisma.openFinanceConnection.create.mock.calls[0][0]);
      expect(gravado).not.toContain('12345678900');
      expect(gravado).toContain('consent-1');
    });

    it('CPF torto nao chega a sair do app', async () => {
      await expect(
        service.conectar('u1', { institutionId: 'inst-1', cpf: '123' }),
      ).rejects.toThrow(BadRequestException);
      expect(polp.criarConsentimento).not.toHaveBeenCalled();
    });

    it('instituicao que nao existe nao vira conexao', async () => {
      await expect(
        service.conectar('u1', { institutionId: 'nao-existe', cpf: '12345678900' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.openFinanceConnection.create).not.toHaveBeenCalled();
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
