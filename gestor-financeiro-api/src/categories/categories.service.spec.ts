// ============================================================
// categories.service.spec.ts
// ============================================================
// As categorias vivem em memória e o mock respeita o `where` — o que
// precisa ser provado é quem enxerga o quê (padrão × do usuário × de outro
// usuário) e as regras da árvore de um nível.
// ============================================================

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService, normalizarNome } from './categories.service';
import { TransactionType } from '@prisma/client';

const { EXPENSE, INCOME } = TransactionType;

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prismaMock: any;
  let cats: any[];
  let usos: Record<string, number>; // lançamentos por categoria
  let seq: number;

  function casa(c: any, where: any = {}): boolean {
    if (where.id !== undefined && c.id !== where.id) return false;
    if ('userId' in where && c.userId !== where.userId) return false;
    if (where.type !== undefined && c.type !== where.type) return false;
    if ('parentId' in where && (c.parentId ?? null) !== where.parentId) return false;
    if (where.OR && !where.OR.some((o: any) => ('userId' in o ? c.userId === o.userId : o.isDefault ? c.isDefault : false)))
      return false;
    return true;
  }
  const ordenar = (l: any[]) => [...l].sort((a, b) => a.sortOrder - b.sortOrder || a.seq - b.seq);

  function cat(parcial: any) {
    const c = { id: 'c' + ++seq, seq, userId: 'user-1', type: EXPENSE, parentId: null, sortOrder: 0, isDefault: false, ...parcial };
    cats.push(c);
    return c;
  }

  beforeEach(() => {
    cats = [];
    usos = {};
    seq = 0;
    prismaMock = {
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
      category: {
        findFirst: jest.fn(async ({ where, orderBy }: any) => {
          let l = cats.filter((c) => casa(c, where));
          if (orderBy?.sortOrder === 'desc') l = ordenar(l).reverse();
          return l[0] ? { ...l[0] } : null;
        }),
        findMany: jest.fn(async ({ where }: any) => ordenar(cats.filter((c) => casa(c, where))).map((c) => ({ ...c }))),
        count: jest.fn(async ({ where }: any) => cats.filter((c) => casa(c, where)).length),
        create: jest.fn(async ({ data }: any) => cat(data)),
        update: jest.fn(async ({ where, data }: any) => {
          const c = cats.find((x) => x.id === where.id);
          for (const [k, v] of Object.entries(data)) if (v !== undefined) c[k] = v;
          return { ...c };
        }),
        delete: jest.fn(async ({ where }: any) => {
          cats = cats.filter((x) => x.id !== where.id);
        }),
      },
      transaction: {
        count: jest.fn(async ({ where }: any) => usos[where.categoryId] ?? 0),
        updateMany: jest.fn(),
      },
    };
    service = new CategoriesService(prismaMock);
  });

  describe('regras de antes', () => {
    it('nome repetido (sem diferenciar maiúsculas e acentos) é recusado', async () => {
      cat({ name: 'Alimentação' });
      await expect(service.create({ userId: 'user-1', name: 'ALIMENTACAO', type: EXPENSE })).rejects.toThrow(
        ConflictException,
      );
    });

    it('mesmo nome em tipos diferentes é permitido', async () => {
      cat({ name: 'Outros', type: INCOME });
      await expect(service.create({ userId: 'user-1', name: 'Outros', type: EXPENSE })).resolves.toBeTruthy();
    });

    it('nome igual a uma categoria padrão também é recusado', async () => {
      cat({ name: 'Moradia', userId: null, isDefault: true });
      await expect(service.create({ userId: 'user-1', name: 'moradia', type: EXPENSE })).rejects.toThrow(
        ConflictException,
      );
    });

    it('não edita categoria padrão nem de outro usuário', async () => {
      const padrao = cat({ name: 'Moradia', userId: null, isDefault: true });
      const alheia = cat({ name: 'Dele', userId: 'user-2' });
      await expect(service.update('user-1', padrao.id, { name: 'Hackeado' })).rejects.toThrow(NotFoundException);
      await expect(service.update('user-1', alheia.id, { name: 'Hackeado' })).rejects.toThrow(NotFoundException);
      expect(prismaMock.category.update).not.toHaveBeenCalled();
    });

    it('exclusão com lançamentos exige destino do mesmo tipo', async () => {
      const a = cat({ name: 'A' });
      const salario = cat({ name: 'Salário', type: INCOME });
      usos[a.id] = 3;
      await expect(service.delete('user-1', a.id)).rejects.toThrow(BadRequestException);
      await expect(service.delete('user-1', a.id, salario.id)).rejects.toThrow(/mesmo tipo/);
      expect(cats.some((c) => c.id === a.id)).toBe(true);
    });

    it('exclusão reatribui e remove', async () => {
      const a = cat({ name: 'A' });
      const b = cat({ name: 'B' });
      usos[a.id] = 5;
      expect(await service.delete('user-1', a.id, b.id)).toEqual({ deleted: true, reassignedTransactions: 5 });
      expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
        where: { categoryId: a.id },
        data: { categoryId: b.id },
      });
    });
  });

  describe('subcategorias', () => {
    it('cria filha de uma raiz do usuário e de uma categoria padrão', async () => {
      const moradia = cat({ name: 'Moradia' });
      const alimentacao = cat({ name: 'Alimentação', userId: null, isDefault: true });
      const luz = await service.create({ userId: 'user-1', name: 'Luz', type: EXPENSE, parentId: moradia.id });
      const mercado = await service.create({ userId: 'user-1', name: 'Mercado', type: EXPENSE, parentId: alimentacao.id });
      expect([luz.parentId, mercado.parentId]).toEqual([moradia.id, alimentacao.id]);
    });

    it('um nível só: filha não vira pai', async () => {
      const moradia = cat({ name: 'Moradia' });
      const luz = cat({ name: 'Luz', parentId: moradia.id });
      await expect(
        service.create({ userId: 'user-1', name: 'Conta de março', type: EXPENSE, parentId: luz.id }),
      ).rejects.toThrow(/já é uma subcategoria/);
    });

    it('pai de outro tipo ou de outro usuário é recusado', async () => {
      const salario = cat({ name: 'Salário', type: INCOME });
      const alheia = cat({ name: 'Dele', userId: 'user-2' });
      await expect(
        service.create({ userId: 'user-1', name: 'X', type: EXPENSE, parentId: salario.id }),
      ).rejects.toThrow(/mesmo tipo/);
      await expect(
        service.create({ userId: 'user-1', name: 'X', type: EXPENSE, parentId: alheia.id }),
      ).rejects.toThrow(NotFoundException);
    });

    it('mesmo nome em pais diferentes é legítimo; entre irmãs, não', async () => {
      const moradia = cat({ name: 'Moradia' });
      const escritorio = cat({ name: 'Escritório' });
      cat({ name: 'Luz', parentId: moradia.id });
      await expect(
        service.create({ userId: 'user-1', name: 'Luz', type: EXPENSE, parentId: escritorio.id }),
      ).resolves.toBeTruthy();
      await expect(
        service.create({ userId: 'user-1', name: 'LUZ', type: EXPENSE, parentId: moradia.id }),
      ).rejects.toThrow('Já existe "LUZ" dentro de Moradia');
    });

    it('categoria com filhas não vira filha', async () => {
      const moradia = cat({ name: 'Moradia' });
      const casa = cat({ name: 'Casa' });
      cat({ name: 'Luz', parentId: moradia.id });
      await expect(service.update('user-1', moradia.id, { parentId: casa.id })).rejects.toThrow(/já tem filhas/);
    });

    it('mover para outro pai e voltar a ser raiz (null)', async () => {
      const moradia = cat({ name: 'Moradia' });
      const luz = cat({ name: 'Luz' });
      await service.update('user-1', luz.id, { parentId: moradia.id });
      expect(cats.find((c) => c.id === luz.id).parentId).toBe(moradia.id);
      await service.update('user-1', luz.id, { parentId: null });
      expect(cats.find((c) => c.id === luz.id).parentId).toBeNull();
    });

    it('mover para um pai que já tem irmã com o mesmo nome é recusado', async () => {
      const moradia = cat({ name: 'Moradia' });
      cat({ name: 'Luz', parentId: moradia.id });
      const luzSolta = cat({ name: 'luz' });
      await expect(service.update('user-1', luzSolta.id, { parentId: moradia.id })).rejects.toThrow(ConflictException);
    });

    it('não é pai de si mesma', async () => {
      const a = cat({ name: 'A' });
      await expect(service.update('user-1', a.id, { parentId: a.id })).rejects.toThrow(/dela mesma/);
    });

    it('categoria com filhas não é excluída', async () => {
      const moradia = cat({ name: 'Moradia' });
      cat({ name: 'Luz', parentId: moradia.id });
      await expect(service.delete('user-1', moradia.id)).rejects.toThrow('Moradia tem 1 subcategoria');
    });

    it('destino da reatribuição precisa ser folha', async () => {
      const a = cat({ name: 'A' });
      const moradia = cat({ name: 'Moradia' });
      cat({ name: 'Luz', parentId: moradia.id });
      usos[a.id] = 2;
      await expect(service.delete('user-1', a.id, moradia.id)).rejects.toThrow(/escolha uma delas/);
    });
  });

  describe('ordem', () => {
    it('nova categoria entra no fim das irmãs', async () => {
      cat({ name: 'A', sortOrder: 0 });
      cat({ name: 'B', sortOrder: 4 });
      const c = await service.create({ userId: 'user-1', name: 'C', type: EXPENSE });
      expect(c.sortOrder).toBe(5);
    });

    it('reordena irmãs; as não enviadas ficam atrás na ordem de antes', async () => {
      const a = cat({ name: 'A', sortOrder: 0 });
      const b = cat({ name: 'B', sortOrder: 1 });
      const c = cat({ name: 'C', sortOrder: 2 });
      expect(await service.reorder('user-1', [c.id])).toEqual({ order: [c.id, a.id, b.id] });
      expect(ordenar(cats).map((x) => x.name)).toEqual(['C', 'A', 'B']);
    });

    it('não mistura raiz com subcategoria nem com categoria padrão', async () => {
      const moradia = cat({ name: 'Moradia' });
      const luz = cat({ name: 'Luz', parentId: moradia.id });
      const padrao = cat({ name: 'Saúde', userId: null, isDefault: true });
      await expect(service.reorder('user-1', [moradia.id, luz.id])).rejects.toThrow(/irmãs/);
      await expect(service.reorder('user-1', [padrao.id])).rejects.toThrow(NotFoundException);
    });
  });

  it('normalizarNome ignora caixa, acentos e espaços nas pontas', () => {
    expect(normalizarNome('  Educação ')).toBe(normalizarNome('EDUCACAO'));
  });
});
