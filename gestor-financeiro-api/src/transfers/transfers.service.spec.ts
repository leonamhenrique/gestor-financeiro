// ============================================================
// transfers.service.spec.ts
// ============================================================
// O que estes testes cobrem, em uma frase: dinheiro não aparece nem
// desaparece numa transferência — ele troca de conta, e só quando confirmada.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransfersService } from './transfers.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (n: number | string) => new Prisma.Decimal(n);

describe('TransfersService', () => {
  let service: TransfersService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((callback: any) => callback(prismaMock)),
      transfer: {
        create: jest.fn(async ({ data }: any) => ({ id: 'tr-1', ...data })),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        delete: jest.fn(async () => ({})),
      },
      bankAccount: {
        findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id }))),
        update: jest.fn(async () => ({})),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [TransfersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(TransfersService);
  });

  /** Os movimentos de saldo que o serviço pediu, em ordem: [conta, sinal, valor]. */
  const movimentos = () =>
    prismaMock.bankAccount.update.mock.calls.map(([arg]: any[]) => {
      const saldo = arg.data.currentBalance;
      const sinal = saldo.decrement !== undefined ? '-' : '+';
      return [arg.where.id, sinal, String(saldo.decrement ?? saldo.increment)];
    });

  const entrada = (over: any = {}) => ({
    userId: 'u1',
    fromAccountId: 'a1',
    toAccountId: 'a2',
    amount: 250,
    transferDate: '2026-10-05',
    ...over,
  });

  // ---------- criar ----------
  describe('create', () => {
    it('confirmada: tira da origem e põe no destino, o mesmo valor', async () => {
      await service.create(entrada());
      expect(movimentos()).toEqual([
        ['a1', '-', '250'],
        ['a2', '+', '250'],
      ]);
    });

    it('prevista não mexe em saldo nenhum', async () => {
      await service.create(entrada({ isConfirmed: false }));
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('nasce confirmada quando ninguém diz o contrário', async () => {
      const t: any = await service.create(entrada());
      expect(t.isConfirmed).toBe(true);
    });

    it('origem igual ao destino é recusado', async () => {
      await expect(service.create(entrada({ toAccountId: 'a1' }))).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.transfer.create).not.toHaveBeenCalled();
    });

    it('conta que não é do usuário não existe para ele', async () => {
      prismaMock.bankAccount.findMany.mockResolvedValueOnce([{ id: 'a1' }]); // falta a a2
      await expect(service.create(entrada())).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('a mesma chave devolve a transferência que já existe, sem mover de novo', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce({ id: 'tr-ja', amount: d(250) });
      const t: any = await service.create(entrada({ clientKey: 'chave-de-teste-1' }));
      expect(t.id).toBe('tr-ja');
      expect(prismaMock.transfer.create).not.toHaveBeenCalled();
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('corrida perdida no índice único devolve a vencedora, não erro', async () => {
      prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      prismaMock.transfer.findFirst.mockResolvedValueOnce({ id: 'tr-vencedora' });
      const t: any = await service.create(entrada({ clientKey: 'chave-de-teste-2' }));
      expect(t.id).toBe('tr-vencedora');
    });

    it('sem chave, um erro de banco continua sendo erro', async () => {
      prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      await expect(service.create(entrada())).rejects.toThrow();
    });
  });

  // ---------- alterar ----------
  describe('update', () => {
    const existente = (over: any = {}) => ({
      id: 'tr-1', userId: 'u1', fromAccountId: 'a1', toAccountId: 'a2',
      amount: d(250), isConfirmed: true, ...over,
    });

    it('mudar o valor desfaz o antigo e aplica o novo', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente());
      await service.update('tr-1', { amount: 400 }, 'u1');
      expect(movimentos()).toEqual([
        ['a2', '-', '250'], ['a1', '+', '250'],   // desfaz
        ['a1', '-', '400'], ['a2', '+', '400'],   // aplica
      ]);
    });

    it('trocar a conta de origem devolve o dinheiro para a conta velha', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente());
      await service.update('tr-1', { fromAccountId: 'a3' }, 'u1');
      expect(movimentos()).toEqual([
        ['a2', '-', '250'], ['a1', '+', '250'],
        ['a3', '-', '250'], ['a2', '+', '250'],
      ]);
    });

    it('confirmar uma prevista move o dinheiro pela primeira vez', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente({ isConfirmed: false }));
      await service.update('tr-1', { isConfirmed: true }, 'u1');
      expect(movimentos()).toEqual([
        ['a1', '-', '250'],
        ['a2', '+', '250'],
      ]);
    });

    it('desconfirmar devolve o dinheiro e não aplica nada', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente());
      await service.update('tr-1', { isConfirmed: false }, 'u1');
      expect(movimentos()).toEqual([
        ['a2', '-', '250'],
        ['a1', '+', '250'],
      ]);
    });

    it('mudar só a descrição não mexe em saldo', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente({ isConfirmed: false }));
      await service.update('tr-1', { description: 'Reserva do mês' }, 'u1');
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('não dá para apontar origem e destino para a mesma conta editando', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(existente());
      await expect(service.update('tr-1', { toAccountId: 'a1' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('transferência de outro dono não é encontrada', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(null);
      await expect(service.update('tr-1', { amount: 10 }, 'outro')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------- apagar ----------
  describe('remove', () => {
    it('confirmada: devolve o dinheiro para a origem', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce({
        id: 'tr-1', userId: 'u1', fromAccountId: 'a1', toAccountId: 'a2', amount: d(250), isConfirmed: true,
      });
      await service.remove('tr-1', 'u1');
      expect(movimentos()).toEqual([
        ['a2', '-', '250'],
        ['a1', '+', '250'],
      ]);
      expect(prismaMock.transfer.delete).toHaveBeenCalled();
    });

    it('prevista: apaga sem tocar em saldo', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce({
        id: 'tr-1', userId: 'u1', fromAccountId: 'a1', toAccountId: 'a2', amount: d(250), isConfirmed: false,
      });
      await service.remove('tr-1', 'u1');
      expect(prismaMock.bankAccount.update).not.toHaveBeenCalled();
    });

    it('de outro dono não é encontrada', async () => {
      prismaMock.transfer.findFirst.mockResolvedValueOnce(null);
      await expect(service.remove('tr-1', 'outro')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ---------- a regra que dá sentido ao resto ----------
  it('em toda operação, o que sai de uma conta entra na outra — nada evapora', async () => {
    const soma = (ms: string[][]) =>
      ms.reduce((s, [, sinal, valor]) => s + (sinal === '+' ? Number(valor) : -Number(valor)), 0);

    await service.create(entrada());
    expect(soma(movimentos())).toBe(0);

    prismaMock.bankAccount.update.mockClear();
    prismaMock.transfer.findFirst.mockResolvedValueOnce({
      id: 'tr-1', userId: 'u1', fromAccountId: 'a1', toAccountId: 'a2', amount: d(250), isConfirmed: true,
    });
    await service.update('tr-1', { amount: 999, toAccountId: 'a3' }, 'u1');
    expect(soma(movimentos())).toBe(0);

    prismaMock.bankAccount.update.mockClear();
    prismaMock.transfer.findFirst.mockResolvedValueOnce({
      id: 'tr-1', userId: 'u1', fromAccountId: 'a1', toAccountId: 'a2', amount: d(250), isConfirmed: true,
    });
    await service.remove('tr-1', 'u1');
    expect(soma(movimentos())).toBe(0);
  });

  // ---------- vinda da importação ----------
  /* Um Pix que entrou numa conta e saiu de outra do mesmo dono é
   * transferência, não receita. Quando ela nasce de um extrato, precisa
   * carregar DE ONDE veio: sem o lote, o botão "desfazer esta importação"
   * devolveria os lançamentos e deixaria o dinheiro mexido entre as duas
   * contas; sem o id do provedor, a mesma linha voltaria amanhã como
   * novidade, para sempre. */
  describe('nascida de uma importação', () => {
    it('guarda o lote, a hora e o id do provedor', async () => {
      const agora = new Date('2026-11-16T03:00:00.000Z');
      await service.create(
        entrada({ importBatchId: 'imp-1', importedAt: agora, providerTxId: 'tx-pix-1' }),
      );
      expect(prismaMock.transfer.create.mock.calls[0][0].data).toMatchObject({
        importBatchId: 'imp-1',
        importedAt: agora,
        providerTxId: 'tx-pix-1',
      });
    });

    it('transferência digitada à mão continua sem nada disso', async () => {
      await service.create(entrada());
      expect(prismaMock.transfer.create.mock.calls[0][0].data).toMatchObject({
        importBatchId: null,
        importedAt: null,
        providerTxId: null,
      });
    });

    it('desfazer o lote devolve o dinheiro pelo caminho inverso', async () => {
      prismaMock.transfer.findMany.mockResolvedValueOnce([
        { id: 'tr-1', fromAccountId: 'a1', toAccountId: 'a2', amount: d(250), isConfirmed: true },
      ]);

      const apagadas = await service.desfazerDoLote(prismaMock, 'u1', 'imp-1');

      expect(apagadas).toHaveLength(1);
      // Volta para a origem: credita a1 e debita a2, o contrário de criar.
      expect(movimentos()).toEqual([
        ['a2', '-', '250'],
        ['a1', '+', '250'],
      ]);
      expect(prismaMock.transfer.delete).toHaveBeenCalledWith({ where: { id: 'tr-1' } });
    });

    /* Prevista nunca tirou dinheiro de lugar nenhum. "Devolver" o que não
     * saiu criaria saldo do nada — e numa conta de verdade. */
    it('prevista some sem mexer em saldo', async () => {
      prismaMock.transfer.findMany.mockResolvedValueOnce([
        { id: 'tr-2', fromAccountId: 'a1', toAccountId: 'a2', amount: d(90), isConfirmed: false },
      ]);

      await service.desfazerDoLote(prismaMock, 'u1', 'imp-1');

      expect(movimentos()).toEqual([]);
      expect(prismaMock.transfer.delete).toHaveBeenCalledWith({ where: { id: 'tr-2' } });
    });

    it('lote sem transferência nenhuma não mexe em nada', async () => {
      const apagadas = await service.desfazerDoLote(prismaMock, 'u1', 'imp-vazio');
      expect(apagadas).toEqual([]);
      expect(movimentos()).toEqual([]);
      expect(prismaMock.transfer.delete).not.toHaveBeenCalled();
    });

    it('só procura no lote e no dono certos', async () => {
      await service.desfazerDoLote(prismaMock, 'u1', 'imp-1');
      expect(prismaMock.transfer.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', importBatchId: 'imp-1' },
      });
    });
  });

  // ---------- listar ----------
  describe('findAllByUser', () => {
    it('filtra por período quando pedido', async () => {
      await service.findAllByUser('u1', { from: '2026-10-01', to: '2026-10-31' });
      const where = prismaMock.transfer.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.transferDate.gte).toEqual(new Date('2026-10-01'));
      expect(where.transferDate.lte).toEqual(new Date('2026-10-31'));
    });

    it('sem período, não inventa filtro de data', async () => {
      await service.findAllByUser('u1');
      expect(prismaMock.transfer.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    });
  });
});
