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
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { PolpClient, ConflitoDeConsentimento } from './polp.client';
import { PrismaService } from '../prisma/prisma.service';
import { limitesLiberados } from '../billing/limites.dobro';
import { LimitesService } from '../billing/limites.service';

describe('OpenFinance', () => {
  let service: OpenFinanceService;
  let cartoes: any;
  let polp: any;
  let prisma: any;
  let limitesDoPlano: any;

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
      /* O padrao conservador: sem saber se o banco ja mudou de datas, o
       * app nao achata historico nenhum. */
      diasDoCartao: jest.fn().mockResolvedValue({ fechamento: 30, vencimento: 7, sempreOsMesmos: false }),
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      creditCard: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      openFinanceRefusal: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      /* A linha que virou TRANSFERENCIA tambem ja esta resolvida: ela nao e
       * lancamento, mas tambem nao e novidade. */
      transfer: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
      },
    };

    cartoes = { corrigirCiclo: jest.fn().mockResolvedValue({}) };
    /* O dublê da trava, local: estes testes mexem no teto de histórico. */
    limitesDoPlano = limitesLiberados() as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenFinanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: PolpClient, useValue: polp },
        /* Um dublê: o que o Open Finance faz com o cartão é CHAMAR a mesma
         * correção de ciclo do formulário. O que se confere aqui é quando
         * ele chama; como ela corrige tem suíte própria. */
        { provide: CreditCardsService, useValue: cartoes },
        { provide: LimitesService, useValue: limitesDoPlano },
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
  /* O BANCO sabe os dias; o cadastro e um palpite de quem digitou. Medido
   * num cartao real: 15 faturas seguidas com fechamento 30 e vencimento 7,
   * contra um cadastro que dizia 1 e 7 -- e o resultado foi um mes inteiro
   * sem fatura. Ate aqui esses dias eram lidos, mostrados numa tela e
   * jogados fora. */
  describe('os dias que o banco reporta', () => {
    beforeEach(() => {
      polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-la', nome: 'GOLD' }]);
      polp.transacoesDoCartao.mockResolvedValue([]);
      polp.diasDoCartao.mockResolvedValue({ fechamento: 30, vencimento: 7, sempreOsMesmos: true });
      prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-1' });
    });

    it('ficam gravados no cartao', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: false, cycles: [{}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(prisma.creditCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { bankClosingDay: 30, bankDueDay: 7 },
      });
    });

    /* Sem escolha de ninguem para respeitar, o banco vale: nao ha decisao
     * humana ali, so um palpite de cadastro contra as faturas de verdade. */
    it('cartao que ninguem configurou e alinhado sozinho', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 1, dueDay: 7, cycleEditedByUser: false, cycles: [{}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).toHaveBeenCalledWith('u1', 'card-1', 30, 7);
    });

    /* Dois periodos e historico torto mesmo com as colunas certas: tambem
     * se alinha, porque e justamente a pilha de ciclos que come um mes. */
    it('cartao com mais de um ciclo e alinhado, mesmo com os dias certos', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: false, cycles: [{}, {}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).toHaveBeenCalled();
    });

    it('ja alinhado nao se mexe', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: false, cycles: [{}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).not.toHaveBeenCalled();
    });

    /* Aqui existe decisao humana, e a integracao volta a so propor: pode
     * ser o banco atrasado, ou alguem que conhece o cartao melhor que a API. */
    it('cartao que a pessoa configurou NAO e mexido', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 1, dueDay: 7, cycleEditedByUser: true, cycles: [{}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).not.toHaveBeenCalled();
    });

    /* O caso real que trouxe este criterio: tres periodos empilhados, dias
     * de hoje iguais aos do banco, e o banco dizendo em 15 faturas que
     * nunca mudou de datas. A pilha nao e escolha de ninguem -- e o que
     * sobra de editar o ciclo pela porta errada. */
    it('pilha de periodos e achatada mesmo com o ciclo marcado como escolha', async () => {
      polp.diasDoCartao.mockResolvedValue({ fechamento: 30, vencimento: 7, sempreOsMesmos: true });
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: true, cycles: [{}, {}, {}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).toHaveBeenCalledWith('u1', 'card-1', 30, 7);
    });

    /* Mas se o BANCO tem historico -- as faturas dele mostram datas
     * diferentes --, os periodos sao legitimos e achatar reescreveria o
     * passado com os dias de hoje. */
    it('banco que mudou de datas nao tem a pilha achatada', async () => {
      polp.diasDoCartao.mockResolvedValue({ fechamento: 30, vencimento: 7, sempreOsMesmos: false });
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: true, cycles: [{}, {}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).not.toHaveBeenCalled();
    });

    /* Dias que DISCORDAM do banco continuam sendo escolha, e intocados:
     * pode ser o banco atrasado, ou alguem que conhece o cartao. */
    it('dias que discordam do banco seguem respeitados, mesmo com pilha', async () => {
      polp.diasDoCartao.mockResolvedValue({ fechamento: 30, vencimento: 7, sempreOsMesmos: true });
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 1, dueDay: 7, cycleEditedByUser: true, cycles: [{}, {}],
      });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).not.toHaveBeenCalled();
    });

    it('banco sem dias legiveis nao grava nem alinha', async () => {
      polp.diasDoCartao.mockResolvedValue({ fechamento: null, vencimento: null, sempreOsMesmos: false });

      await service.paraImportar('u1', 'cx1');

      expect(cartoes.corrigirCiclo).not.toHaveBeenCalled();
      expect(prisma.creditCard.update).not.toHaveBeenCalled();
    });

    /* A conferencia e o que a pessoa esta esperando na tela; o alinhamento
     * e um extra. Extra que falha nao derruba o principal. */
    it('recusa da correcao nao derruba a conferencia', async () => {
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 1, dueDay: 7, cycleEditedByUser: false, cycles: [{}],
      });
      cartoes.corrigirCiclo.mockRejectedValue(new Error('um mes nao existiria'));

      await expect(service.paraImportar('u1', 'cx1')).resolves.toBeDefined();
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

    /* O defeito que isto conserta foi medido: desfiz um lote que tinha
     * entrado sozinho, reabri a tela, e os mesmos lancamentos entraram de
     * novo. A condicao "nao casa com nada que voce ja tem" olha o que o app
     * TEM -- e depois do desfazer ele nao tem mais. */
    it('o que foi recusado nao volta a ser oferecido', async () => {
      prisma.openFinanceRefusal.findMany.mockResolvedValue([{ providerTxId: 'tx-1' }]);

      const r = await service.paraImportar('u1', 'cx1');

      expect(r.cartoes[0].lancamentos.map((l: any) => l.providerTxId)).toEqual(['tx-2']);
    });

    /* A linha que a pessoa marcou como TRANSFERENCIA nao virou lancamento --
     * virou outra coisa, noutra tabela. Olhando so os lancamentos, o mesmo
     * Pix voltava como novidade na sincronizacao seguinte, e a pessoa teria
     * de dizer "isto e transferencia" todo dia, para sempre. */
    it('o que virou transferencia tambem nao volta', async () => {
      prisma.transfer.findMany.mockResolvedValue([{ providerTxId: 'tx-1' }]);

      const r = await service.paraImportar('u1', 'cx1');

      expect(r.cartoes[0].lancamentos.map((l: any) => l.providerTxId)).toEqual(['tx-2']);
    });

    it('recusado e ja importado contam juntos', async () => {
      prisma.transaction.findMany.mockResolvedValue([{ providerTxId: 'tx-1' }]);
      prisma.openFinanceRefusal.findMany.mockResolvedValue([{ providerTxId: 'tx-2' }]);

      const r = await service.paraImportar('u1', 'cx1');

      expect(r.cartoes[0].lancamentos).toHaveLength(0);
      expect(r.jaSincronizados).toBe(2);
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
  describe('o que espera conferencia', () => {
    /* Sem isto, quem autorizava no banco voltava ao app e via "aguardando a
     * sua autorizacao": a tela mostra o ultimo status GUARDADO, e o banco
     * nao nos avisa por iniciativa propria. A pessoa tinha de tocar em "Ja
     * autorizei" para o app descobrir o que ja era verdade. */
    it('abrir a lista confere quem ainda esperava autorizacao', async () => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, status: 'AWAITING_AUTHORIZATION', authorizedAt: null },
      ]);
      polp.consentimento.mockResolvedValue({ status: 'AUTHORISED', execucao: 'SUCCESS' });

      const r = await service.listar('u1');

      expect(polp.consentimento).toHaveBeenCalledWith('consent-1');
      expect(r[0].status).toBe('AUTHORISED');
    });

    it('quem ja esta autorizado nao custa uma chamada', async () => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([CONEXAO]);
      await service.listar('u1');
      expect(polp.consentimento).not.toHaveBeenCalled();
    });

    it('provedor fora nao apaga a lista', async () => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, status: 'AWAITING_AUTHORIZATION' },
      ]);
      polp.consentimento.mockRejectedValue(new Error('fora do ar'));

      const r = await service.listar('u1');
      expect(r[0].status).toBe('AWAITING_AUTHORIZATION');
    });

    /* Nulo e "ainda nao perguntei"; zero e "perguntei e nao havia nada". So
     * o zero autoriza a tela a ficar calada, e achatar os dois faria uma
     * conexao recem-criada parecer conferida e sem novidade. */
    it('nulo nao vira zero no caminho ate a tela', async () => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { id: 'cx1', institutionName: 'Inter', pendingCount: null, pendingCheckedAt: null },
        { id: 'cx2', institutionName: 'Nubank', pendingCount: 3, pendingCheckedAt: new Date() },
      ]);

      const r = await service.pendentes('u1');

      expect(r.total).toBe(3);
      expect(r.conexoes[0].pendentes).toBeNull();
      expect(r.conexoes[1].pendentes).toBe(3);
    });

    /* O provedor importa DOZE MESES de uma vez, e o primeiro aviso falou em
     * 487 lancamentos. Quem decide nao importar o historico ficaria com esse
     * numero aceso para sempre -- e numero que nao desce para de ser lido.
     * Novidade passa a ser o que chegou DEPOIS de a pessoa ter visto. */
    describe('o que e novidade', () => {
      const vindoEm = (id: string, recebidoEm: string | null) => ({
        providerTxId: id, data: '2026-11-12', valor: 10, tipo: 'EXPENSE', descricao: id,
        parcela: null, faturada: true, faturaPrevista: null, pagamentoDeFatura: false,
        recebidoEm,
      });

      beforeEach(() => {
        polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-la', nome: 'GOLD' }]);
        polp.transacoesDoCartao.mockResolvedValue([
          vindoEm('velho', '2026-11-15T10:00:00Z'),
          vindoEm('novo', '2026-11-17T09:00:00Z'),
        ]);
      });

      /* A data da COMPRA nao serve: a compra de marco chegou hoje, e para
       * quem olha ela e novidade de hoje. Quem responde e a data em que o
       * provedor recebeu do banco. */
      it('conta so o que o provedor recebeu depois de ela ter visto', async () => {
        prisma.openFinanceConnection.findFirst.mockResolvedValue({
          ...CONEXAO,
          pendingSeenAt: new Date('2026-11-16T00:00:00Z'),
        });

        const novos = await service.recontarPendentes('u1', 'cx1');

        expect(novos).toBe(1);
        expect(prisma.openFinanceConnection.update).toHaveBeenCalledWith(
          expect.objectContaining({
            // O total continua guardado: e ele que a tela de Importar mostra.
            data: expect.objectContaining({ pendingCount: 2, pendingNewCount: 1 }),
          }),
        );
      });

      /* Nunca olhou: tudo e novidade, e e verdade. O primeiro aviso e o
       * unico que fala do historico inteiro, e e o unico em que isso e
       * informacao. */
      it('quem nunca olhou recebe tudo como novidade', async () => {
        prisma.openFinanceConnection.findFirst.mockResolvedValue({ ...CONEXAO, pendingSeenAt: null });

        expect(await service.recontarPendentes('u1', 'cx1')).toBe(2);
      });

      it('nada novo depois de ela ter visto da zero', async () => {
        prisma.openFinanceConnection.findFirst.mockResolvedValue({
          ...CONEXAO,
          pendingSeenAt: new Date('2026-11-18T00:00:00Z'),
        });

        expect(await service.recontarPendentes('u1', 'cx1')).toBe(0);
      });

      /* Marcar visto e da TELA: pedir a proposta nao e ver. O trabalho
       * diario pede toda manha, e se isso contasse, nada seria novidade. */
      it('marcar visto zera a novidade de todas as conexoes vivas', async () => {
        await service.marcarVisto('u1');

        expect(prisma.openFinanceConnection.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { userId: 'u1', revokedAt: null },
            data: expect.objectContaining({ pendingNewCount: 0, pendingSeenAt: expect.any(Date) }),
          }),
        );
      });
    });

    it('recontar guarda o numero e a hora', async () => {
      polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-la', nome: 'GOLD' }]);
      polp.transacoesDoCartao.mockResolvedValue([
        { providerTxId: 't1', data: '2026-11-12', valor: 10, tipo: 'EXPENSE', descricao: 'A', parcela: null, faturada: true, faturaPrevista: null, pagamentoDeFatura: false },
        { providerTxId: 't2', data: '2026-11-12', valor: 20, tipo: 'EXPENSE', descricao: 'B', parcela: null, faturada: true, faturaPrevista: null, pagamentoDeFatura: false },
      ]);

      const total = await service.recontarPendentes('u1', 'cx1');

      expect(total).toBe(2);
      expect(prisma.openFinanceConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pendingCount: 2, pendingCheckedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ----------------------------------------------------------------------
  describe('recusar', () => {
    it('guarda so o id no provedor, e nada mais', async () => {
      await service.recusar('u1', ['tx-1', 'tx-2']);

      const chamada = prisma.openFinanceRefusal.createMany.mock.calls[0][0];
      expect(chamada.data).toEqual([
        { userId: 'u1', providerTxId: 'tx-1' },
        { userId: 'u1', providerTxId: 'tx-2' },
      ]);
    });

    /* Recusar duas vezes e a mesma recusa. Sem isto, desfazer um lote que
     * repetisse um id morreria no indice unico -- e o desfazer ja tinha
     * acontecido, entao o erro seria sobre nada. */
    it('recusar de novo nao quebra', async () => {
      await service.recusar('u1', ['tx-1', 'tx-1', '', null as any]);

      const chamada = prisma.openFinanceRefusal.createMany.mock.calls[0][0];
      expect(chamada.data).toHaveLength(1);
      expect(chamada.skipDuplicates).toBe(true);
    });

    it('lista vazia nao vai ao banco', async () => {
      const r = await service.recusar('u1', []);
      expect(r.recusados).toBe(0);
      expect(prisma.openFinanceRefusal.createMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------------
  /* "Este lancamento que eu ja tinha E o que o banco mandou."
   *
   * Nasceu de uma pergunta com a tela na mao: se a pessoa importar uma
   * linha que ja existe, o app sobrepoe? Nao -- ele DUPLICA. A caixa
   * desmarcada era a unica protecao, e protecao que depende de ninguem
   * insistir nao e protecao. */
  describe('vincular um lancamento que ja existe', () => {
    it('grava o id do provedor, e so isso', async () => {
      prisma.transaction.findFirst
        .mockResolvedValueOnce({ id: 't1', providerTxId: null })  // o meu
        .mockResolvedValueOnce(null);                             // ninguem mais tem esse id

      await service.vincularLancamento('u1', 't1', 'tx-do-banco');

      const chamada = prisma.transaction.update.mock.calls[0][0];
      expect(chamada.where).toEqual({ id: 't1' });
      expect(chamada.data.providerTxId).toBe('tx-do-banco');
      expect(chamada.data.syncedAt).toBeInstanceOf(Date);
      /* Valor, data, categoria e DESCRICAO continuam os dela: copiar o
       * texto do banco por cima desfaria uma edicao feita de proposito. */
      expect(Object.keys(chamada.data).sort()).toEqual(['providerTxId', 'syncedAt']);
    });

    it('lancamento de outra pessoa nao se vincula', async () => {
      prisma.transaction.findFirst.mockResolvedValueOnce(null);

      await expect(service.vincularLancamento('u1', 't-alheio', 'tx-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    /* Duas transacoes do banco apontando para o mesmo lancamento daqui:
     * uma das duas esta errada, e gravar por cima perderia a primeira. */
    it('lancamento que ja tem OUTRO id do banco e recusado', async () => {
      prisma.transaction.findFirst.mockResolvedValueOnce({ id: 't1', providerTxId: 'tx-antigo' });

      await expect(service.vincularLancamento('u1', 't1', 'tx-novo')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    /* O mesmo id em dois lancamentos seria o mesmo dinheiro contado duas
     * vezes -- exatamente o que isto veio evitar. */
    it('id do banco que ja esta em outro lancamento e recusado', async () => {
      prisma.transaction.findFirst
        .mockResolvedValueOnce({ id: 't1', providerTxId: null })
        .mockResolvedValueOnce({ id: 't2' });

      await expect(service.vincularLancamento('u1', 't1', 'tx-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.transaction.update).not.toHaveBeenCalled();
    });

    it('vincular de novo ao MESMO id nao reclama', async () => {
      prisma.transaction.findFirst
        .mockResolvedValueOnce({ id: 't1', providerTxId: 'tx-1' })
        .mockResolvedValueOnce(null);

      await expect(service.vincularLancamento('u1', 't1', 'tx-1')).resolves.toEqual({
        vinculado: true,
      });
    });
  });

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
  /* Reconectar o mesmo banco cria um consentimento NOVO, com outro id.
   * Sem reencontrar o destino pelo id da conta no provedor, o app
   * perguntaria outra vez para onde vai cada conta e cada cartao -- e quem
   * reconecta ja respondeu isso uma vez. */
  /* A validade da conexao nao e letra miuda: quem nao paga tem o banco
   * desligado antes de o mes virar, e a lista carrega a data para a tela
   * poder dize-la. */
  describe('a janela do banco aparece na lista', () => {
    beforeEach(() => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, authorizedAt: new Date('2026-11-05T12:00:00Z') },
      ]);
    });

    it('quem nao paga ve ate quando o banco fica', async () => {
      limitesDoPlano.estaPagando.mockResolvedValue(false);
      const lista = await service.listar('u1');
      expect(lista[0].conectadaAte).toBe('2026-11-30');
    });

    it('quem paga nao ve data nenhuma: a conexao nao tem prazo', async () => {
      limitesDoPlano.estaPagando.mockResolvedValue(true);
      const lista = await service.listar('u1');
      expect(lista[0].conectadaAte).toBeNull();
    });

    /* Antes do "sim" do banco nao ha consentimento cobrado, e prometer data
     * para o que pode nem existir confunde. */
    it('conexao ainda sem autorizacao nao tem data', async () => {
      limitesDoPlano.estaPagando.mockResolvedValue(false);
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, status: 'AUTHORISED', authorizedAt: null },
      ]);
      const lista = await service.listar('u1');
      expect(lista[0].conectadaAte).toBeNull();
    });

    it('pergunta o plano UMA vez por listagem, nao uma por conexao', async () => {
      limitesDoPlano.estaPagando.mockResolvedValue(false);
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, id: 'a', authorizedAt: new Date('2026-11-05T12:00:00Z') },
        { ...CONEXAO, id: 'b', authorizedAt: new Date('2026-11-05T12:00:00Z') },
        { ...CONEXAO, id: 'c', authorizedAt: new Date('2026-11-05T12:00:00Z') },
      ]);
      await service.listar('u1');
      expect(limitesDoPlano.estaPagando).toHaveBeenCalledTimes(1);
    });
  });

  describe('o vinculo sobrevive a reconexao', () => {
    beforeEach(() => {
      polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-la', nome: 'INTER' }]);
      polp.transacoesDoCartao.mockResolvedValue([]);
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: true, cycles: [{}],
      });
    });

    it('acha pelo par (conexao, conta) quando o vinculo e desta conexao', async () => {
      prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-1' });
      const p = await service.paraImportar('u1', 'cx1');
      expect(p.cartoes[0].creditCardId).toBe('card-1');
      expect(prisma.creditCard.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { connectionId: 'cx1' } }),
      );
    });

    it('reencontra pelo id da conta no provedor e reaponta para a conexao de agora', async () => {
      prisma.creditCard.findFirst
        .mockResolvedValueOnce(null)        // nao e desta conexao
        .mockResolvedValueOnce({ id: 'card-1' }); // mas e desta pessoa
      const p = await service.paraImportar('u1', 'cx1');
      expect(p.cartoes[0].creditCardId).toBe('card-1');
      expect(prisma.creditCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { connectionId: 'cx1' },
      });
    });

    /* Provedor que emite id novo a cada consentimento cai aqui: a tela volta
     * a perguntar, que e o comportamento de antes e nao um erro novo. */
    it('sem nada para reencontrar, segue sem destino', async () => {
      prisma.creditCard.findFirst.mockResolvedValue(null);
      const p = await service.paraImportar('u1', 'cx1');
      expect(p.cartoes[0].creditCardId).toBeNull();
    });

    it('a busca larga e sempre do DONO: nunca acha conta de outra pessoa', async () => {
      prisma.creditCard.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await service.paraImportar('u1', 'cx1');
      const larga = prisma.creditCard.findFirst.mock.calls[1][0];
      expect(larga.where).toMatchObject({ userId: 'u1', providerAccountId: 'k-la' });
      expect(larga.where.connectionId).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------------
  /* O teto de historico do plano. O corte em si tem suite propria
   * (`historico.spec.ts`); aqui se prova a LIGACAO: a busca corta e conta. */
  describe('historico que o plano alcanca', () => {
    beforeEach(() => {
      polp.cartoes.mockResolvedValue([{ providerAccountId: 'k-la', nome: 'INTER' }]);
      polp.transacoesDoCartao.mockResolvedValue([
        { providerTxId: 'a', data: '2026-09-10', valor: 10, tipo: 'EXPENSE', descricao: 'A', faturada: true, faturaPrevista: '2026-10' },
        { providerTxId: 'b', data: '2026-10-11', valor: 20, tipo: 'EXPENSE', descricao: 'B', faturada: true, faturaPrevista: '2026-11' },
        { providerTxId: 'c', data: '2026-11-12', valor: 30, tipo: 'EXPENSE', descricao: 'C', faturada: true, faturaPrevista: '2026-12' },
      ]);
      prisma.creditCard.findFirst.mockResolvedValue({ id: 'card-1' });
      prisma.creditCard.findUnique.mockResolvedValue({
        closingDay: 30, dueDay: 7, cycleEditedByUser: true, cycles: [{}],
      });
    });

    it('sem teto, vem tudo', async () => {
      const p = await service.paraImportar('u1', 'cx1');
      expect(p.cartoes[0].lancamentos).toHaveLength(3);
      expect(p.mesesForaDoPlano).toBe(0);
    });

    it('com teto de 1 mes, so a fatura mais recente desce', async () => {
      limitesDoPlano.direitosPara.mockResolvedValue({ mesesDeHistorico: 1 });
      const p = await service.paraImportar('u1', 'cx1');
      expect(p.cartoes[0].lancamentos.map((t: any) => t.providerTxId)).toEqual(['c']);
      expect(p.mesesForaDoPlano).toBe(2);
    });

    /* O que o plano nao da nem desce para o navegador: corte na tela seria
     * uma linha de console para contornar. */
    it('o que foi cortado nao viaja', async () => {
      limitesDoPlano.direitosPara.mockResolvedValue({ mesesDeHistorico: 1 });
      const p = await service.paraImportar('u1', 'cx1');
      expect(JSON.stringify(p)).not.toContain('2026-09-10');
    });
  });

  // ----------------------------------------------------------------------
  /* Duas conexoes do mesmo banco ficam identicas na lista: o CPF nao e
   * guardado. O apelido e a unica coisa que as distingue -- e e o que
   * permite ligar o Open Finance de OUTRO titular (o conjuge) na mesma
   * conta do app sem transformar "Desconectar" numa roleta. */
  describe('apelido da conexao', () => {
    it('grava o apelido ao conectar', async () => {
      await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678901', apelido: ' Ana ' });
      const criado = prisma.openFinanceConnection.upsert.mock.calls[0][0].create;
      expect(criado.nickname).toBe('Ana');
    });

    it('sem apelido grava nulo, e nao vazio', async () => {
      await service.conectar('u1', { institutionId: 'inst-1', cpf: '12345678901' });
      expect(prisma.openFinanceConnection.upsert.mock.calls[0][0].create.nickname).toBeNull();
    });

    it('a lista devolve o apelido junto com o banco', async () => {
      prisma.openFinanceConnection.findMany.mockResolvedValue([
        { ...CONEXAO, nickname: 'Ana', pendingCount: 0, pendingCheckedAt: null, lastSyncedAt: null },
      ]);
      const r = await service.listar('u1');
      expect(r[0]).toMatchObject({ instituicao: 'Banco Inter PF', apelido: 'Ana' });
    });

    it('renomeia sem falar com o provedor', async () => {
      const r = await service.renomear('u1', 'cx1', 'Ana');
      expect(r.apelido).toBe('Ana');
      expect(prisma.openFinanceConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nickname: 'Ana' } }),
      );
      expect(polp.consentimento).not.toHaveBeenCalled();
      expect(polp.criarConsentimento).not.toHaveBeenCalled();
    });

    it('apelido vazio limpa, e volta a valer o nome do banco', async () => {
      await service.renomear('u1', 'cx1', '   ');
      expect(prisma.openFinanceConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nickname: null } }),
      );
    });

    it('corta em 40 para nao empurrar os botoes da linha', async () => {
      await service.renomear('u1', 'cx1', 'a'.repeat(60));
      const data = prisma.openFinanceConnection.update.mock.calls[0][0].data;
      expect(data.nickname).toHaveLength(40);
    });

    it('conexao de outra pessoa nao se renomeia', async () => {
      prisma.openFinanceConnection.findFirst.mockResolvedValue(null);
      await expect(service.renomear('u2', 'cx1', 'Ana')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.openFinanceConnection.update).not.toHaveBeenCalled();
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
