// ============================================================
// fim-do-teste.scheduler.spec.ts
// ============================================================
// Dois erros possíveis aqui, e os dois são caros em direções opostas:
// desligar o banco de quem PAGA, e deixar vivo o banco de quem não paga na
// virada do mês — que é dinheiro saindo da nossa conta no provedor todo mês,
// em silêncio. Os testes vigiam os dois lados.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { FimDoTesteScheduler, emDiaEMes } from './fim-do-teste.scheduler';
import { OpenFinanceService } from './openfinance.service';
import { BillingService } from '../billing/billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

/** Meio-dia em São Paulo, para o dia de calendário não depender do fuso da
 * máquina que roda o teste. */
const AO_MEIO_DIA = (dia: string) => new Date(dia + 'T15:00:00.000Z');

describe('FimDoTesteScheduler', () => {
  let job: FimDoTesteScheduler;
  let prisma: any;
  let openFinance: any;
  let billing: any;
  let push: any;
  const antes = { ...process.env };

  /** O estado de plano que o `BillingService` devolveria, por pessoa. */
  let estados: Record<string, any>;

  beforeEach(async () => {
    process.env.OPENFINANCE_ENABLED = 'true';
    estados = {};

    prisma = {
      openFinanceConnection: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    openFinance = { desconectar: jest.fn().mockResolvedValue({ desconectada: true }) };
    billing = {
      estadoDoPlano: jest.fn(async (id: string) => estados[id] ?? {}),
      estaPagando: jest.fn(async (id: string) => {
        const e = estados[id] ?? {};
        return !!e.cortesia || !!(e.liberada && e.codigo);
      }),
    };
    push = { avisarTexto: jest.fn().mockResolvedValue(1) };

    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        FimDoTesteScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenFinanceService, useValue: openFinance },
        { provide: BillingService, useValue: billing },
        { provide: PushService, useValue: push },
      ],
    }).compile();

    job = modulo.get(FimDoTesteScheduler);
  });

  afterEach(() => {
    process.env = { ...antes };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Hoje é este dia, no relógio do processo. */
  const hojeEh = (dia: string) => jest.useFakeTimers().setSystemTime(AO_MEIO_DIA(dia));

  const conexaoDe = (userId: string, autorizadaEm: string, id = 'cx-1') =>
    prisma.openFinanceConnection.findMany.mockResolvedValue([
      { id, userId, authorizedAt: AO_MEIO_DIA(autorizadaEm), institutionName: 'Inter' },
    ]);

  const emTeste = (userId: string, diasQueFaltam: number) => {
    estados[userId] = { testeAte: new Date(Date.now() + (diasQueFaltam - 0.5) * 86400000) };
    prisma.user.findMany.mockResolvedValue([{ id: userId }]);
  };

  // ----------------------------------------------------------
  // O banco de quem não paga
  // ----------------------------------------------------------
  describe('o banco é desligado antes da virada do mês', () => {
    it('no dia do desligamento, desconecta e avisa', async () => {
      hojeEh('2026-11-30');
      conexaoDe('u1', '2026-11-05');

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).toHaveBeenCalledWith('u1', 'cx-1');
      expect(push.avisarTexto).toHaveBeenCalledWith(
        'u1',
        'O banco foi desconectado',
        expect.stringContaining('Inter'),
      );
    });

    it('três dias antes, avisa e NÃO desconecta', async () => {
      hojeEh('2026-11-27');
      conexaoDe('u1', '2026-11-05');

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).not.toHaveBeenCalled();
      expect(push.avisarTexto).toHaveBeenCalledWith(
        'u1',
        'O banco se desconecta em 3 dias',
        expect.stringContaining('30/11'),
      );
    });

    it('no meio do caminho, não faz nada', async () => {
      hojeEh('2026-11-18');
      conexaoDe('u1', '2026-11-05');

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).not.toHaveBeenCalled();
      expect(push.avisarTexto).not.toHaveBeenCalled();
    });

    /* O dia pode passar em branco — servidor fora, deploy no ar. Comparar
     * com `>=` e não com `===` é o que faz o atraso ser recuperado no dia
     * seguinte, em vez de a conexão viver para sempre. */
    it('se o dia passou em branco, desliga mesmo atrasado', async () => {
      hojeEh('2026-12-03');
      conexaoDe('u1', '2026-11-05');

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).toHaveBeenCalledWith('u1', 'cx-1');
    });

    it('quem conectou nos últimos dias do mês fica até o fim do mês seguinte', async () => {
      hojeEh('2026-11-30');
      conexaoDe('u1', '2026-11-25');

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).not.toHaveBeenCalled();
    });
  });

  describe('quem paga não perde o banco', () => {
    it('assinatura liberada poupa a conexão', async () => {
      hojeEh('2026-11-30');
      conexaoDe('u1', '2026-11-05');
      estados.u1 = { codigo: 'pro-mensal', liberada: true };

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).not.toHaveBeenCalled();
      expect(push.avisarTexto).not.toHaveBeenCalled();
    });

    it('cortesia também poupa', async () => {
      hojeEh('2026-11-30');
      conexaoDe('u1', '2026-11-05');
      estados.u1 = { cortesia: true };

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).not.toHaveBeenCalled();
    });

    /* Assinatura vencida não é assinatura: `liberada` falso cai no mesmo
     * caminho de quem nunca pagou. */
    it('assinatura não liberada NÃO poupa', async () => {
      hojeEh('2026-11-30');
      conexaoDe('u1', '2026-11-05');
      estados.u1 = { codigo: 'pro-mensal', liberada: false };

      await job.cuidarDoFimDoTeste();

      expect(openFinance.desconectar).toHaveBeenCalled();
    });

    it('pergunta o plano UMA vez por pessoa, não por conexão', async () => {
      hojeEh('2026-11-18');
      prisma.openFinanceConnection.findMany.mockResolvedValue(
        ['a', 'b', 'c'].map((id) => ({
          id,
          userId: 'u1',
          authorizedAt: AO_MEIO_DIA('2026-11-05'),
          institutionName: 'Inter',
        })),
      );

      await job.cuidarDoFimDoTeste();

      expect(billing.estaPagando).toHaveBeenCalledTimes(1);
    });
  });

  /* A flag esconde a função; ela não cancela consentimento. Parar de revogar
   * quando alguém desliga o Open Finance seria continuar pagando em
   * silêncio. */
  it('desliga mesmo com o Open Finance desligado na flag', async () => {
    delete process.env.OPENFINANCE_ENABLED;
    hojeEh('2026-11-30');
    conexaoDe('u1', '2026-11-05');

    await job.cuidarDoFimDoTeste();

    expect(openFinance.desconectar).toHaveBeenCalled();
  });

  it('uma conexão que falha não derruba as outras', async () => {
    hojeEh('2026-11-30');
    prisma.openFinanceConnection.findMany.mockResolvedValue([
      { id: 'a', userId: 'u1', authorizedAt: AO_MEIO_DIA('2026-11-05'), institutionName: 'Inter' },
      { id: 'b', userId: 'u2', authorizedAt: AO_MEIO_DIA('2026-11-05'), institutionName: 'Nubank' },
    ]);
    openFinance.desconectar.mockImplementation(async (_u: string, id: string) => {
      if (id === 'a') throw new Error('provedor fora');
      return { desconectada: true };
    });

    await job.cuidarDoFimDoTeste();

    expect(openFinance.desconectar).toHaveBeenCalledTimes(2);
    // A que falhou não mente dizendo que desconectou.
    expect(push.avisarTexto).toHaveBeenCalledTimes(1);
    expect(push.avisarTexto).toHaveBeenCalledWith('u2', 'O banco foi desconectado', expect.any(String));
  });

  // ----------------------------------------------------------
  // Os avisos do fim do teste
  // ----------------------------------------------------------
  describe('os avisos de 7 e 3 dias', () => {
    it('avisa a sete dias, sem oferta', async () => {
      hojeEh('2026-11-10');
      emTeste('u1', 7);

      await job.cuidarDoFimDoTeste();

      expect(push.avisarTexto).toHaveBeenCalledWith(
        'u1',
        'Seu teste acaba em 7 dias',
        expect.stringContaining('volta ao grátis'),
      );
    });

    it('a três dias, a oferta diz que o débito só vem no fim', async () => {
      hojeEh('2026-11-10');
      emTeste('u1', 3);

      await job.cuidarDoFimDoTeste();

      expect(push.avisarTexto).toHaveBeenCalledWith(
        'u1',
        'Seu teste acaba em 3 dias',
        expect.stringContaining('primeiro débito'),
      );
    });

    it('nos outros dias, silêncio', async () => {
      hojeEh('2026-11-10');
      emTeste('u1', 5);

      await job.cuidarDoFimDoTeste();

      expect(push.avisarTexto).not.toHaveBeenCalled();
    });

    /* Quem assinou no meio do teste ainda tem `trial_ends_at` no futuro.
     * Avisá-lo do fim de um teste que não o atinge mais seria assustar
     * justamente quem já pagou. */
    it('quem assinou no meio do teste não recebe o aviso', async () => {
      hojeEh('2026-11-10');
      emTeste('u1', 3);
      estados.u1 = { ...estados.u1, codigo: 'pro-mensal', liberada: true };

      await job.cuidarDoFimDoTeste();

      expect(push.avisarTexto).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // Os dois assuntos no mesmo dia
  // ----------------------------------------------------------
  it('banco e teste no mesmo dia viram UM aviso, com as duas frases', async () => {
    hojeEh('2026-11-27');
    conexaoDe('u1', '2026-11-05');
    emTeste('u1', 3);

    await job.cuidarDoFimDoTeste();

    expect(push.avisarTexto).toHaveBeenCalledTimes(1);
    const [, titulo, texto] = push.avisarTexto.mock.calls[0];
    // O título é o do assunto mais pesado; o texto leva os dois.
    expect(titulo).toBe('O banco se desconecta em 3 dias');
    expect(texto).toContain('Inter');
    expect(texto).toContain('primeiro débito');
  });

  it('emDiaEMes escreve a data como a frase lê', () => {
    expect(emDiaEMes('2026-11-30')).toBe('30/11');
    expect(emDiaEMes('2027-01-05')).toBe('05/01');
  });
});
