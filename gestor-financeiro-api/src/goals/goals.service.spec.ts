// ============================================================
// goals.service.spec.ts
// ============================================================
// O que estes testes cobrem, em uma frase: o saldo inicial de um objetivo
// nunca encosta nas contas, o que se aplica sai de uma conta de verdade, e
// concluir um objetivo fecha a porta de entrada sem trancar a de saída.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GoalsService } from './goals.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (n: number | string) => new Prisma.Decimal(n);
const dia = (s: string) => new Date(s + 'T00:00:00.000Z');

describe('GoalsService', () => {
  let service: GoalsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
      goal: {
        create: jest.fn(async ({ data }: any) => ({ id: 'ob-1', ...data })),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        delete: jest.fn(async () => ({})),
      },
      goalMovement: {
        create: jest.fn(async ({ data }: any) => ({ id: 'mv-1', ...data })),
        findFirst: jest.fn(async () => null),
        delete: jest.fn(async () => ({})),
      },
      bankAccount: {
        findFirst: jest.fn(async ({ where }: any) => ({ id: where.id })),
        update: jest.fn(async () => ({})),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [GoalsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(GoalsService);
  });

  /** O que o serviço pediu ao saldo das contas: [conta, sinal, valor]. */
  const movimentos = () =>
    prismaMock.bankAccount.update.mock.calls.map(([arg]: any[]) => {
      const saldo = arg.data.currentBalance;
      const sinal = saldo.decrement !== undefined ? '-' : '+';
      return [arg.where.id, sinal, String(saldo.decrement ?? saldo.increment)];
    });

  const novoObjetivo = (over: any = {}) => ({
    userId: 'u1',
    name: 'Viagem',
    startDate: '2026-10-01',
    targetDate: '2026-12-31',
    targetAmount: 6000,
    ...over,
  });

  const objetivoGravado = (over: any = {}) => ({
    id: 'ob-1',
    userId: 'u1',
    name: 'Viagem',
    startDate: dia('2026-10-01'),
    targetDate: dia('2026-12-31'),
    targetAmount: d(6000),
    initialBalance: d(0),
    accountId: null,
    completedAt: null,
    movements: [],
    ...over,
  });

  const aporte = (over: any = {}) => ({
    userId: 'u1',
    bankAccountId: 'a1',
    amount: 500,
    movementDate: '2026-10-07',
    ...over,
  });

  // ---------- cadastro ----------
  describe('create', () => {
    it('grava o objetivo com meta, prazo e saldo inicial', async () => {
      const o: any = await service.create(novoObjetivo({ initialBalance: 1500 }));
      expect(String(o.targetAmount)).toBe('6000');
      expect(String(o.initialBalance)).toBe('1500');
      expect(o.targetDate).toEqual(dia('2026-12-31'));
    });

    /** A regra que o usuário pediu em primeiro lugar: o saldo que ele já tem
     * guardado não pode mexer no saldo das contas. */
    it('saldo inicial não toca em conta nenhuma', async () => {
      await service.create(novoObjetivo({ initialBalance: 1500 }));
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('sem saldo inicial, começa em zero', async () => {
      const o: any = await service.create(novoObjetivo());
      expect(String(o.initialBalance)).toBe('0');
    });

    it('data final antes da inicial é recusada', async () => {
      await expect(
        service.create(novoObjetivo({ targetDate: '2026-09-01' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.goal.create).not.toHaveBeenCalled();
    });

    it('conta vinculada precisa ser do usuário', async () => {
      prismaMock.bankAccount.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.create(novoObjetivo({ accountId: 'de-outro' })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.goal.create).not.toHaveBeenCalled();
    });

    it('tira espaço sobrando do nome', async () => {
      const o: any = await service.create(novoObjetivo({ name: '  Viagem  ' }));
      expect(o.name).toBe('Viagem');
    });
  });

  // ---------- consulta ----------
  describe('findAllByUser', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(dia('2026-10-07')));
    afterEach(() => jest.useRealTimers());

    it('entrega as contas prontas: guardado, falta e quanto por mês', async () => {
      prismaMock.goal.findMany.mockResolvedValueOnce([
        objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(600) }] }),
      ]);
      const [o]: any = await service.findAllByUser('u1');
      expect(o.progress.saved).toBe('600.00');
      expect(o.progress.remaining).toBe('5400.00');
      expect(o.progress.monthsLeft).toBe(3); // out, nov, dez
      expect(o.progress.monthlyTarget).toBe('1800.00');
    });

    it('o saldo inicial conta para o progresso, mas não para o que veio das contas', async () => {
      prismaMock.goal.findMany.mockResolvedValueOnce([
        objetivoGravado({
          initialBalance: d(1500),
          movements: [{ type: 'DEPOSIT', amount: d(600) }],
        }),
      ]);
      const [o]: any = await service.findAllByUser('u1');
      expect(o.progress.saved).toBe('2100.00');      // 1.500 + 600
      expect(o.appliedFromAccounts).toBe('600.00');  // só os 600 saíram de conta
    });

    /** O pedido, em um teste: depositar menos do que o sugerido faz a
     * estimativa subir, no MESMO prazo. */
    it('a estimativa mensal é dinâmica', async () => {
      const comGuardado = (v: number) =>
        objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(v) }] });

      prismaMock.goal.findMany.mockResolvedValueOnce([comGuardado(2000)]);
      const [emDia]: any = await service.findAllByUser('u1');
      expect(emDia.progress.monthlyTarget).toBe('1333.34'); // 4.000 ÷ 3

      prismaMock.goal.findMany.mockResolvedValueOnce([comGuardado(500)]);
      const [atrasado]: any = await service.findAllByUser('u1');
      expect(atrasado.progress.monthlyTarget).toBe('1833.34'); // 5.500 ÷ 3
    });

    it('findOne de outro dono não encontra', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('ob-1', 'outro')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------- alterar, postergar, concluir ----------
  describe('update', () => {
    it('postergar muda só a data final e não mexe em saldo', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      const o: any = await service.update('ob-1', { targetDate: '2027-06-30' }, 'u1');
      expect(o.targetDate).toEqual(dia('2027-06-30'));
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('postergar para antes da data inicial é recusado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      await expect(
        service.update('ob-1', { targetDate: '2026-09-15' }, 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('concluir grava a data e não devolve dinheiro nenhum', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      const o: any = await service.update('ob-1', { isCompleted: true }, 'u1');
      expect(o.completedAt).toBeInstanceOf(Date);
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('concluir de novo não troca a data de conclusão', async () => {
      const antes = dia('2026-10-02');
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado({ completedAt: antes }));
      const o: any = await service.update('ob-1', { isCompleted: true }, 'u1');
      expect(o.completedAt).toEqual(antes);
    });

    it('reabrir apaga a conclusão', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ completedAt: dia('2026-10-02') }),
      );
      const o: any = await service.update('ob-1', { isCompleted: false }, 'u1');
      expect(o.completedAt).toBeNull();
    });

    it('mudar o saldo inicial continua sem encostar nas contas', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      await service.update('ob-1', { initialBalance: 3000 }, 'u1');
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('desvincular a conta é mandar null, e isso não vira busca de conta', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado({ accountId: 'a1' }));
      const o: any = await service.update('ob-1', { accountId: null }, 'u1');
      expect(o.accountId).toBeNull();
      expect(prismaMock.bankAccount.findFirst).not.toHaveBeenCalled();
    });

    it('objetivo de outro dono não é encontrado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.update('ob-1', { name: 'x' }, 'outro')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------- excluir ----------
  describe('remove', () => {
    it('objetivo sem dinheiro de conta é apagado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ initialBalance: d(1500), movements: [] }),
      );
      await service.remove('ob-1', 'u1');
      expect(prismaMock.goal.delete).toHaveBeenCalledWith({ where: { id: 'ob-1' } });
    });

    /** Apagar com valor aplicado faria esse dinheiro sumir do total sem
     * voltar para conta nenhuma. O app pede o resgate em vez de escolher
     * sozinho para onde o dinheiro vai. */
    it('com valor aplicado, pede o resgate antes', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(600) }] }),
      );
      await expect(service.remove('ob-1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.goal.delete).not.toHaveBeenCalled();
    });

    it('já resgatado tudo, pode apagar', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({
          movements: [
            { type: 'DEPOSIT', amount: d(600) },
            { type: 'WITHDRAW', amount: d(600) },
          ],
        }),
      );
      await service.remove('ob-1', 'u1');
      expect(prismaMock.goal.delete).toHaveBeenCalled();
    });

    it('de outro dono não é encontrado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.remove('ob-1', 'outro')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------- aplicar ----------
  describe('aplicar', () => {
    it('sai da conta escolhida e vira movimento do objetivo', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      const m: any = await service.aplicar('ob-1', aporte());
      expect(movimentos()).toEqual([['a1', '-', '500']]);
      expect([m.type, String(m.amount), m.goalId]).toEqual(['DEPOSIT', '500', 'ob-1']);
    });

    /** Concluído sai das opções de novo depósito — foi o pedido. */
    it('objetivo concluído não recebe aplicação', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ completedAt: dia('2026-10-05') }),
      );
      await expect(service.aplicar('ob-1', aporte())).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('conta que não é do usuário não existe para ele', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      prismaMock.bankAccount.findFirst.mockResolvedValueOnce(null);
      await expect(service.aplicar('ob-1', aporte())).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.goalMovement.create).not.toHaveBeenCalled();
    });

    it('objetivo de outro dono não é encontrado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(null);
      await expect(service.aplicar('ob-1', aporte())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a mesma chave devolve o movimento que já existe, sem tirar de novo', async () => {
      prismaMock.goalMovement.findFirst.mockResolvedValueOnce({ id: 'mv-ja' });
      const m: any = await service.aplicar('ob-1', aporte({ clientKey: 'chave-de-teste-1' }));
      expect(m.id).toBe('mv-ja');
      expect(prismaMock.goalMovement.create).not.toHaveBeenCalled();
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('corrida perdida no índice único devolve o vencedor, não erro', async () => {
      prismaMock.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      prismaMock.goalMovement.findFirst.mockResolvedValueOnce({ id: 'mv-vencedor' });
      const m: any = await service.aplicar('ob-1', aporte({ clientKey: 'chave-de-teste-2' }));
      expect(m.id).toBe('mv-vencedor');
    });

    it('sem chave, um erro de banco continua sendo erro', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
      prismaMock.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      await expect(service.aplicar('ob-1', aporte())).rejects.toThrow();
    });
  });

  // ---------- resgatar ----------
  describe('resgatar', () => {
    it('entra na conta escolhida', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(600) }] }),
      );
      const m: any = await service.resgatar('ob-1', aporte({ bankAccountId: 'a2' }));
      expect(movimentos()).toEqual([['a2', '+', '500']]);
      expect(m.type).toBe('WITHDRAW');
    });

    it('não dá para resgatar mais do que o objetivo tem', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(400) }] }),
      );
      await expect(service.resgatar('ob-1', aporte({ amount: 500 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('o saldo inicial também pode ser resgatado — e aí o total sobe, porque o dinheiro passa a ser conhecido', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({ initialBalance: d(1500), movements: [] }),
      );
      await service.resgatar('ob-1', aporte({ amount: 1500 }));
      expect(movimentos()).toEqual([['a1', '+', '1500']]);
    });

    /** Resgatar de um objetivo concluído CONTINUA valendo: trancar a saída
     * deixaria o dinheiro preso e o total errado para sempre. */
    it('objetivo concluído ainda pode ser resgatado', async () => {
      prismaMock.goal.findFirst.mockResolvedValueOnce(
        objetivoGravado({
          completedAt: dia('2026-10-05'),
          movements: [{ type: 'DEPOSIT', amount: d(600) }],
        }),
      );
      await service.resgatar('ob-1', aporte());
      expect(movimentos()).toEqual([['a1', '+', '500']]);
    });
  });

  // ---------- apagar movimento ----------
  describe('removerMovimento', () => {
    it('apagar uma aplicação devolve o dinheiro para a conta', async () => {
      prismaMock.goalMovement.findFirst.mockResolvedValueOnce({
        id: 'mv-1', userId: 'u1', bankAccountId: 'a1', type: 'DEPOSIT', amount: d(500),
      });
      await service.removerMovimento('mv-1', 'u1');
      expect(movimentos()).toEqual([['a1', '+', '500']]);
      expect(prismaMock.goalMovement.delete).toHaveBeenCalled();
    });

    it('apagar um resgate tira de volta da conta', async () => {
      prismaMock.goalMovement.findFirst.mockResolvedValueOnce({
        id: 'mv-1', userId: 'u1', bankAccountId: 'a1', type: 'WITHDRAW', amount: d(500),
      });
      await service.removerMovimento('mv-1', 'u1');
      expect(movimentos()).toEqual([['a1', '-', '500']]);
    });

    it('de outro dono não é encontrado', async () => {
      prismaMock.goalMovement.findFirst.mockResolvedValueOnce(null);
      await expect(service.removerMovimento('mv-1', 'outro')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------- a regra que dá sentido ao resto ----------
  it('o dinheiro que sai da conta é exatamente o que entra no objetivo, e volta igual', async () => {
    prismaMock.goal.findFirst.mockResolvedValueOnce(objetivoGravado());
    await service.aplicar('ob-1', aporte({ amount: 500 }));

    prismaMock.goal.findFirst.mockResolvedValueOnce(
      objetivoGravado({ movements: [{ type: 'DEPOSIT', amount: d(500) }] }),
    );
    await service.resgatar('ob-1', aporte({ amount: 500 }));

    const liquido = movimentos().reduce(
      (s: number, [, sinal, valor]: any[]) => s + (sinal === '+' ? Number(valor) : -Number(valor)),
      0,
    );
    expect(liquido).toBe(0);
  });
});
