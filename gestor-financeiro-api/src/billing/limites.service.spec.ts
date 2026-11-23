// ============================================================
// limites.service.spec.ts
// ============================================================
// A trava em si: o 403, o que ele carrega, e as duas coisas que ela NÃO faz
// — contar quando não há limite, e recusar quem já está acima dele por ter
// caído de plano (aí ela recusa CRIAR, e nunca toca no que existe).
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { LimitesService } from './limites.service';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LimitesService', () => {
  let limites: LimitesService;
  let prisma: any;
  let billing: any;

  const GRATIS = { contas: 1, cartoes: 1, objetivos: 1, bancos: 0 };

  beforeEach(async () => {
    prisma = {
      bankAccount: { count: jest.fn().mockResolvedValue(0) },
      creditCard: { count: jest.fn().mockResolvedValue(0) },
      goal: { count: jest.fn().mockResolvedValue(0) },
      openFinanceConnection: { count: jest.fn().mockResolvedValue(0) },
    };
    billing = { direitos: jest.fn().mockResolvedValue(GRATIS) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        LimitesService,
        { provide: PrismaService, useValue: prisma },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();
    limites = mod.get(LimitesService);
  });

  it('com o limite livre, deixa criar', async () => {
    await expect(limites.conferirConta('u1')).resolves.toBeUndefined();
  });

  it('com o limite cheio, recusa com o código e o número', async () => {
    prisma.bankAccount.count.mockResolvedValue(1);
    await expect(limites.conferirConta('u1')).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await limites.conferirConta('u1');
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: 'PLAN_LIMIT', recurso: 'contas', limite: 1, quantos: 1 });
      expect(e.getResponse().message).toContain('1 conta');
    }
  });

  /* Limite zero é "o seu plano não tem isso", e a frase muda: "vai até 0
   * bancos conectados" não diria nada a ninguém. */
  it('limite zero diz que o plano não inclui aquilo', async () => {
    try {
      await limites.conferirBanco('u1');
      fail('devia ter recusado');
    } catch (e: any) {
      expect(e.getResponse().message).toContain('não inclui');
    }
  });

  it('sem limite (`null`), nem conta — é uma consulta a menos por cadastro', async () => {
    billing.direitos.mockResolvedValue({ ...GRATIS, contas: null });
    await expect(limites.conferirConta('u1')).resolves.toBeUndefined();
    expect(prisma.bankAccount.count).not.toHaveBeenCalled();
  });

  /* Quem tinha cinco contas e caiu para o grátis continua com as cinco: a
   * trava recusa a SEXTA, e nunca apaga nem esconde o que já existe. */
  it('acima do limite, recusa criar mais — e só isso', async () => {
    prisma.bankAccount.count.mockResolvedValue(5);
    await expect(limites.conferirConta('u1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cada recurso conta a sua própria tabela', async () => {
    await limites.conferirCartao('u1');
    await limites.conferirObjetivo('u1');
    await limites.conferirBanco('u1').catch(() => {});
    expect(prisma.creditCard.count).toHaveBeenCalled();
    expect(prisma.goal.count).toHaveBeenCalled();
    /* O banco tem limite zero no grátis: recusa ANTES de contar, porque não
     * há contagem que faça caber. */
    expect(prisma.openFinanceConnection.count).not.toHaveBeenCalled();
  });

  /* O planejamento não é guard de rota: a rota é a mesma para qualquer mês,
   * e quem decide é o `:month` que veio. */
  describe('mês do planejamento', () => {
    const mesAtual = new Date().toISOString().slice(0, 7);

    it('no grátis, o mês corrente passa', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, planejamentoCompleto: false });
      await expect(limites.conferirMesDoPlanejamento('u1', mesAtual)).resolves.toBeUndefined();
    });

    it('no grátis, outro mês é recusado — e o erro diz qual vale', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, planejamentoCompleto: false });
      try {
        await limites.conferirMesDoPlanejamento('u1', '2020-01');
        fail('devia ter recusado');
      } catch (e: any) {
        expect(e.getResponse()).toMatchObject({
          code: 'PLAN_FEATURE',
          funcao: 'planejamentoCompleto',
          mesPermitido: mesAtual,
        });
      }
    });

    it('no pago, qualquer mês passa', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, planejamentoCompleto: true });
      await expect(limites.conferirMesDoPlanejamento('u1', '2020-01')).resolves.toBeUndefined();
    });
  });

  /* A cota do WhatsApp não lança exceção: do outro lado há alguém esperando
   * resposta, e um 500 viraria silêncio. */
  describe('cota de mensagens', () => {
    beforeEach(() => {
      prisma.whatsappUsage = {
        upsert: jest.fn().mockResolvedValue({ count: 1 }),
      };
    });

    it('ilimitado nem conta', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, whatsappPorMes: null });
      await expect(limites.registrarMensagemDoWhatsapp('u1')).resolves.toMatchObject({
        permitido: true,
        limite: null,
      });
      expect(prisma.whatsappUsage.upsert).not.toHaveBeenCalled();
    });

    it('cota zero recusa sem contar', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, whatsappPorMes: 0 });
      await expect(limites.registrarMensagemDoWhatsapp('u1')).resolves.toMatchObject({
        permitido: false,
        limite: 0,
      });
      expect(prisma.whatsappUsage.upsert).not.toHaveBeenCalled();
    });

    it('dentro da cota, conta e deixa passar', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, whatsappPorMes: 100 });
      prisma.whatsappUsage.upsert.mockResolvedValue({ count: 100 });
      await expect(limites.registrarMensagemDoWhatsapp('u1')).resolves.toMatchObject({
        permitido: true,
        usadas: 100,
      });
    });

    it('a 101 nao passa', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, whatsappPorMes: 100 });
      prisma.whatsappUsage.upsert.mockResolvedValue({ count: 101 });
      await expect(limites.registrarMensagemDoWhatsapp('u1')).resolves.toMatchObject({
        permitido: false,
        usadas: 101,
      });
    });

    /* Duas mensagens no mesmo segundo são comuns: quem manda três frases
     * seguidas faz isso sempre. Ler-somar-gravar perderia uma. */
    it('o incremento é atômico, pelo banco', async () => {
      billing.direitos.mockResolvedValue({ ...GRATIS, whatsappPorMes: 100 });
      await limites.registrarMensagemDoWhatsapp('u1');
      const chamada = prisma.whatsappUsage.upsert.mock.calls[0][0];
      expect(chamada.update).toEqual({ count: { increment: 1 } });
      expect(chamada.where.userId_month.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  it('arquivado não conta: o limite é sobre o que está de pé', async () => {
    await limites.conferirConta('u1');
    expect(prisma.bankAccount.count).toHaveBeenCalledWith({ where: { userId: 'u1', isActive: true } });
    await limites.conferirObjetivo('u1');
    expect(prisma.goal.count).toHaveBeenCalledWith({ where: { userId: 'u1', completedAt: null } });
  });
});
