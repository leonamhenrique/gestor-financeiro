// ============================================================
// budgets.service.spec.ts
// ============================================================
// O que estes testes cobrem, em uma frase: o planejamento guarda intenção, e
// as partes nunca podem somar mais que o todo.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BudgetsService } from './budgets.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (n: number | string) => new Prisma.Decimal(n);

/** Mesma árvore dos testes de utils: Alimentação com duas filhas. */
const CATEGORIAS = [
  { id: 'alim', parentId: null, type: 'EXPENSE' },
  { id: 'mercado', parentId: 'alim', type: 'EXPENSE' },
  { id: 'restaurante', parentId: 'alim', type: 'EXPENSE' },
  { id: 'moradia', parentId: null, type: 'EXPENSE' },
  { id: 'salario', parentId: null, type: 'INCOME' },
];

describe('BudgetsService', () => {
  let service: BudgetsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
      budget: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => ({ id: 'b1', ...data })),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
        delete: jest.fn(async () => ({})),
      },
      budgetItem: {
        create: jest.fn(async ({ data }: any) => ({ id: 'i' + Math.random(), ...data })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      category: { findMany: jest.fn(async () => CATEGORIAS) },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [BudgetsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(BudgetsService);
  });

  /** As metas que o serviço mandou gravar: [categoria, valor, veioDasFilhas]. */
  const gravadas = () =>
    prismaMock.budgetItem.create.mock.calls.map(([arg]: any[]) => [
      arg.data.categoryId,
      String(arg.data.amount),
      arg.data.fromChildren,
    ]);

  const entrada = (over: any = {}) => ({
    userId: 'u1',
    month: '2026-07',
    income: 9000,
    total: 5000,
    items: [] as any[],
    ...over,
  });

  // ---------- o mês é a chave ----------
  describe('o mês', () => {
    it.each(['2026-7', 'julho', '2026-13', '2026-00', ''])('recusa %p', async (mes) => {
      await expect(service.save(entrada({ month: mes }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aceita AAAA-MM', async () => {
      const b: any = await service.save(entrada({ month: '2026-12' }));
      expect(prismaMock.budget.create).toHaveBeenCalled();
      expect(b).toBeDefined();
    });

    it('vale também para copiar e apagar', async () => {
      await expect(service.remove('u1', 'julho')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.copy('u1', 'julho', '2026-08')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.copy('u1', '2026-08', 'julho')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ---------- salvar ----------
  describe('save', () => {
    it('grava teto e receita esperada', async () => {
      await service.save(entrada());
      const data = prismaMock.budget.create.mock.calls[0][0].data;
      expect([String(data.total), String(data.income), data.month]).toEqual(['5000', '9000', '2026-07']);
    });

    it('sem receita informada, zero — e não "não mexe"', async () => {
      await service.save(entrada({ income: undefined }));
      expect(String(prismaMock.budget.create.mock.calls[0][0].data.income)).toBe('0');
    });

    it('grava as metas por categoria', async () => {
      await service.save(entrada({ items: [{ categoryId: 'moradia', amount: 1500 }] }));
      expect(gravadas()).toEqual([['moradia', '1500', false]]);
    });

    /** Salvar é substituir: a meta que a pessoa desmarcou precisa sumir. */
    it('salvar de novo apaga as metas antigas antes de gravar as novas', async () => {
      prismaMock.budget.findFirst.mockResolvedValueOnce({ id: 'b-ja' });
      await service.save(entrada({ items: [{ categoryId: 'moradia', amount: 100 }] }));
      expect(prismaMock.budgetItem.deleteMany).toHaveBeenCalledWith({ where: { budgetId: 'b-ja' } });
      expect(prismaMock.budget.create).not.toHaveBeenCalled();
      expect(gravadas()).toEqual([['moradia', '100', false]]);
    });

    it('a pai marcada recebe a soma das filhas, não o que veio no corpo', async () => {
      await service.save(entrada({ items: [
        { categoryId: 'alim', amount: 1, fromChildren: true },
        { categoryId: 'mercado', amount: 500 },
        { categoryId: 'restaurante', amount: 300 },
      ] }));
      expect(gravadas()).toEqual([
        ['alim', '800', true],
        ['mercado', '500', false],
        ['restaurante', '300', false],
      ]);
    });

    /** A regra que dá sentido ao resto: as partes não somam mais que o todo. */
    it('repartir mais do que o teto é recusado', async () => {
      await expect(service.save(entrada({ total: 1000, items: [
        { categoryId: 'moradia', amount: 700 },
        { categoryId: 'mercado', amount: 500 },
      ] }))).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.budget.create).not.toHaveBeenCalled();
    });

    it('a mensagem da recusa diz os dois números', async () => {
      await expect(service.save(entrada({ total: 1000, items: [{ categoryId: 'moradia', amount: 1200 }] })))
        .rejects.toThrow(/1200,?\.00[\s\S]*1000,?\.00/);
    });

    /** E aqui é onde a conta da pai importa: 800 + 500 + 300 "somaria" 1600 e
     * estouraria o teto de 1000 — mas a filha está dentro da pai. */
    it('com meta na pai, a filha não conta de novo contra o teto', async () => {
      await service.save(entrada({ total: 1000, items: [
        { categoryId: 'alim', amount: 0, fromChildren: true },
        { categoryId: 'mercado', amount: 500 },
        { categoryId: 'restaurante', amount: 300 },
      ] }));
      expect(prismaMock.budget.create).toHaveBeenCalled();
    });

    it('repartir exatamente o teto passa', async () => {
      await service.save(entrada({ total: 1000, items: [{ categoryId: 'moradia', amount: 1000 }] }));
      expect(prismaMock.budget.create).toHaveBeenCalled();
    });

    it('categoria repetida é recusada', async () => {
      await expect(service.save(entrada({ items: [
        { categoryId: 'moradia', amount: 100 },
        { categoryId: 'moradia', amount: 200 },
      ] }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('categoria de receita não tem teto de gasto', async () => {
      await expect(service.save(entrada({ items: [{ categoryId: 'salario', amount: 100 }] })))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('categoria de outro dono não existe para esta pessoa', async () => {
      await expect(service.save(entrada({ items: [{ categoryId: 'de-outro', amount: 100 }] })))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('a busca de categorias inclui as padrão do sistema, que não têm dono', async () => {
      await service.save(entrada({ items: [{ categoryId: 'moradia', amount: 10 }] }));
      expect(prismaMock.category.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ userId: 'u1' }, { userId: null }],
      });
    });

    it('teto negativo é recusado', async () => {
      await expect(service.save(entrada({ total: -1 }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('planejamento sem meta nenhuma é legítimo: o teto do mês já é um plano', async () => {
      await service.save(entrada({ items: [] }));
      expect(prismaMock.budget.create).toHaveBeenCalled();
      expect(prismaMock.budgetItem.create).not.toHaveBeenCalled();
    });
  });

  // ---------- consultar ----------
  describe('leitura', () => {
    it('traz os planejamentos da pessoa com as metas dentro, do mais novo para o mais velho', async () => {
      prismaMock.budget.findMany.mockResolvedValueOnce([
        { id: 'b1', month: '2026-07', total: d(5000), income: d(9000), items: [] },
      ]);
      const lista: any = await service.findAllByUser('u1');
      expect(lista[0].month).toBe('2026-07');
      const pedido = prismaMock.budget.findMany.mock.calls[0][0];
      expect([pedido.where, pedido.include, pedido.orderBy]).toEqual([
        { userId: 'u1' }, { items: true }, { month: 'desc' },
      ]);
    });

    it('quem não planejou nada recebe lista vazia, não erro', async () => {
      expect(await service.findAllByUser('u1')).toEqual([]);
    });
  });

  // ---------- copiar ----------
  describe('copy', () => {
    const origem = {
      id: 'b-origem', month: '2026-06', income: d(9000), total: d(5000),
      items: [
        { categoryId: 'alim', amount: d(800), fromChildren: true },
        { categoryId: 'mercado', amount: d(800), fromChildren: false },
      ],
    };

    it('leva teto, receita e metas para o mês de destino', async () => {
      prismaMock.budget.findFirst.mockResolvedValueOnce(origem).mockResolvedValueOnce(null);
      await service.copy('u1', '2026-06', '2026-07');
      const data = prismaMock.budget.create.mock.calls[0][0].data;
      expect([data.month, String(data.total), String(data.income)]).toEqual(['2026-07', '5000', '9000']);
      expect(gravadas()).toEqual([['alim', '800', true], ['mercado', '800', false]]);
    });

    /** Copiar passa pelo mesmo crivo do salvar: a filha mudou de valor desde
     * então e a pai marcada acompanha, em vez de levar o número velho. */
    it('a pai marcada é recalculada na cópia', async () => {
      prismaMock.budget.findFirst
        .mockResolvedValueOnce({ ...origem, items: [
          { categoryId: 'alim', amount: d(800), fromChildren: true },
          { categoryId: 'mercado', amount: d(650), fromChildren: false },
        ] })
        .mockResolvedValueOnce(null);
      await service.copy('u1', '2026-06', '2026-07');
      expect(gravadas()[0]).toEqual(['alim', '650', true]);
    });

    it('copiar de um mês vazio não inventa planejamento', async () => {
      prismaMock.budget.findFirst.mockResolvedValueOnce(null);
      await expect(service.copy('u1', '2026-06', '2026-07')).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.budget.create).not.toHaveBeenCalled();
    });

    it('copiar para o próprio mês não faz sentido', async () => {
      await expect(service.copy('u1', '2026-07', '2026-07')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ---------- apagar ----------
  describe('remove', () => {
    it('apaga o planejamento do mês', async () => {
      prismaMock.budget.findFirst.mockResolvedValueOnce({ id: 'b1' });
      expect(await service.remove('u1', '2026-07')).toEqual({ month: '2026-07' });
      expect(prismaMock.budget.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    });

    it('mês sem planejamento não é encontrado', async () => {
      await expect(service.remove('u1', '2026-07')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
