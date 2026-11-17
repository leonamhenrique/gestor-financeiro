// ============================================================
// openfinance.scheduler.spec.ts
// ============================================================
// O trabalho diário tira o "Buscar" do caminho da pessoa. O que estes
// testes defendem é que ele não arrume, de madrugada e sem ninguém olhando,
// um problema maior do que o que resolve.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { OpenFinanceScheduler } from './openfinance.scheduler';
import { OpenFinanceService } from './openfinance.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

describe('OpenFinanceScheduler', () => {
  let job: OpenFinanceScheduler;
  let prisma: any;
  let servico: any;
  let avisos: any;
  const antes = { ...process.env };

  beforeEach(async () => {
    process.env.OPENFINANCE_ENABLED = 'true';

    prisma = {
      openFinanceConnection: { findMany: jest.fn().mockResolvedValue([]) },
      transaction: { create: jest.fn(), createMany: jest.fn(), update: jest.fn() },
    };
    servico = { recontarPendentes: jest.fn().mockResolvedValue(0) };
    avisos = { avisar: jest.fn().mockResolvedValue(1) };

    const modulo: TestingModule = await Test.createTestingModule({
      providers: [
        OpenFinanceScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenFinanceService, useValue: servico },
        { provide: PushService, useValue: avisos },
      ],
    }).compile();

    job = modulo.get(OpenFinanceScheduler);
  });

  afterEach(() => {
    process.env = { ...antes };
    jest.restoreAllMocks();
  });

  const conexoes = (...ids: string[]) =>
    prisma.openFinanceConnection.findMany.mockResolvedValue(
      ids.map((id) => ({ id, userId: 'u-' + id, institutionName: 'Banco' })),
    );

  /* Desligada, este trabalho não existe — como o resto do módulo. Um cron
   * que roda mesmo com a flag desligada seria a única parte do experimento
   * capaz de falar com o provedor sem ninguém ter ligado nada. */
  it('com a flag desligada, nao fala com o provedor', async () => {
    delete process.env.OPENFINANCE_ENABLED;
    conexoes('a');

    await job.contarPendentesDoDia();

    expect(prisma.openFinanceConnection.findMany).not.toHaveBeenCalled();
    expect(servico.recontarPendentes).not.toHaveBeenCalled();
  });

  it('confere uma conexao por vez, todas as autorizadas', async () => {
    conexoes('a', 'b', 'c');
    await job.contarPendentesDoDia();
    expect(servico.recontarPendentes).toHaveBeenCalledTimes(3);
  });

  /* Provedor fora, consentimento expirado, banco em manutenção: o que falha
   * fica com o número de ontem. Derrubar o laço na primeira exceção deixaria
   * todo mundo depois dela sem conferência, e em silêncio. */
  it('uma conexao que falha nao derruba as outras', async () => {
    conexoes('a', 'b', 'c');
    servico.recontarPendentes
      .mockRejectedValueOnce(new Error('provedor fora'))
      .mockResolvedValue(2);

    await expect(job.contarPendentesDoDia()).resolves.toBeUndefined();
    expect(servico.recontarPendentes).toHaveBeenCalledTimes(3);
  });

  it('so olha conexao viva e autorizada', async () => {
    conexoes('a');
    await job.contarPendentesDoDia();
    expect(prisma.openFinanceConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: null, status: 'AUTHORISED' } }),
    );
  });

  /* A integração PROPÕE. Um trabalho que roda sozinho, de madrugada, sem
   * ninguém olhando, é o último lugar do app onde gravar dinheiro sem
   * confirmação seria aceitável. */
  it('nao grava lancamento nenhum', async () => {
    conexoes('a', 'b');
    servico.recontarPendentes.mockResolvedValue(7);

    await job.contarPendentesDoDia();

    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- aviso
  /* O aviso sai DAQUI e de lugar nenhum mais. O provedor sincroniza a cada
   * 3 horas; avisar a cada sincronizacao seriam oito por dia, e e assim que
   * uma notificacao util vira uma que a pessoa desliga. */
  it('avisa quem tem lancamento esperando', async () => {
    conexoes('a');
    servico.recontarPendentes.mockResolvedValue(4);

    await job.contarPendentesDoDia();

    expect(avisos.avisar).toHaveBeenCalledWith('u-a', 4);
  });

  it('com nada esperando, nao avisa', async () => {
    conexoes('a');
    servico.recontarPendentes.mockResolvedValue(0);

    await job.contarPendentesDoDia();

    expect(avisos.avisar).not.toHaveBeenCalled();
  });

  /* A contagem e a parte que a TELA usa, e ela ja esta gravada quando se
   * chega ao aviso. Falhar em avisar nao pode derrubar o laco e deixar as
   * conexoes seguintes sem conferencia. */
  it('falha ao avisar nao derruba o trabalho', async () => {
    conexoes('a', 'b');
    servico.recontarPendentes.mockResolvedValue(2);
    avisos.avisar.mockRejectedValue(new Error('push fora'));

    await expect(job.contarPendentesDoDia()).resolves.toBeUndefined();
    expect(servico.recontarPendentes).toHaveBeenCalledTimes(2);
  });

  it('sem conexao nenhuma, nao faz nada', async () => {
    conexoes();
    await job.contarPendentesDoDia();
    expect(servico.recontarPendentes).not.toHaveBeenCalled();
  });
});
