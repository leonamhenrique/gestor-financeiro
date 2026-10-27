// ============================================================
// category-rules.service.spec.ts
// ============================================================
// A regra aprendida é memória, e memória errada é pior que memória vazia.
// O que se prova aqui: quem enxerga o quê, que ensinar de novo troca em vez
// de empilhar, e que a categoria apontada serve para lançar.
// ============================================================

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoryRulesService } from './category-rules.service';

describe('CategoryRulesService', () => {
  let service: CategoryRulesService;
  let prismaMock: any;
  let regras: any[];
  let cats: any[];
  let seq: number;

  function cat(id: string, parcial: any = {}) {
    cats.push({ id, userId: 'user-1', filhas: 0, ...parcial });
    return id;
  }

  beforeEach(() => {
    regras = [];
    cats = [];
    seq = 0;
    cat('cat-compras');
    cat('cat-alimentacao');

    prismaMock = {
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      categoryRule: {
        findMany: jest.fn(async ({ where }: any) =>
          regras.filter((r) => r.userId === where.userId).map((r) => ({ ...r })),
        ),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const chave = where.userId_merchant;
          const achada = regras.find(
            (r) => r.userId === chave.userId && r.merchant === chave.merchant,
          );
          if (achada) {
            if (update.categoryId !== undefined) achada.categoryId = update.categoryId;
            if (update.label !== undefined) achada.label = update.label;
            if (update.hits?.increment) achada.hits += update.hits.increment;
            return { ...achada };
          }
          const nova = { id: 'r' + ++seq, hits: 1, updatedAt: new Date(), ...create };
          regras.push(nova);
          return { ...nova };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const antes = regras.length;
          regras = regras.filter((r) => !(r.id === where.id && r.userId === where.userId));
          return { count: antes - regras.length };
        }),
      },
      category: {
        findMany: jest.fn(async ({ where }: any) =>
          cats
            .filter(
              (c) =>
                where.id.in.includes(c.id) &&
                where.OR.some((o: any) => c.userId === o.userId),
            )
            .map((c) => ({ id: c.id, _count: { children: c.filhas } })),
        ),
      },
    };
    service = new CategoryRulesService(prismaMock);
  });

  const ensinar = (merchant: string, categoryId = 'cat-compras', label?: string) =>
    service.upsert('user-1', [{ merchant, categoryId, label }]);

  it('ensina um lojista e devolve a regra', async () => {
    const lista = await ensinar('mercadolivre');
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ merchant: 'mercadolivre', categoryId: 'cat-compras', hits: 1 });
  });

  it('ensinar de novo TROCA a categoria, nao empilha uma segunda regra', async () => {
    await ensinar('mercadolivre', 'cat-compras');
    const lista = await ensinar('mercadolivre', 'cat-alimentacao');
    expect(lista).toHaveLength(1);
    expect(lista[0].categoryId).toBe('cat-alimentacao');
  });

  it('confirmar a mesma regra soma um acerto', async () => {
    await ensinar('mercadolivre');
    const lista = await ensinar('mercadolivre');
    expect(lista[0].hits).toBe(2);
  });

  it('lojista repetido na MESMA leva conta um acerto so', async () => {
    // 44 linhas do mesmo lojista numa importação são um clique, não 44.
    const lista = await service.upsert('user-1', [
      { merchant: 'mercadolivre', categoryId: 'cat-compras' },
      { merchant: 'mercadolivre', categoryId: 'cat-compras' },
      { merchant: 'mercadolivre', categoryId: 'cat-compras' },
    ]);
    expect(lista).toHaveLength(1);
    expect(lista[0].hits).toBe(1);
  });

  it('na leva repetida, vence a ultima', async () => {
    const lista = await service.upsert('user-1', [
      { merchant: 'mercadolivre', categoryId: 'cat-compras' },
      { merchant: 'mercadolivre', categoryId: 'cat-alimentacao' },
    ]);
    expect(lista[0].categoryId).toBe('cat-alimentacao');
  });

  it('a listagem vem da mais especifica para a mais generica', async () => {
    // O cliente casa por prefixo e para no primeiro. Fora de ordem,
    // "mercadolivre" ganharia de "mercadolivreoficial" e a regra mais
    // específica nunca valeria.
    await service.upsert('user-1', [
      { merchant: 'mercado', categoryId: 'cat-compras' },
      { merchant: 'mercadolivreoficial', categoryId: 'cat-compras' },
      { merchant: 'mercadolivre', categoryId: 'cat-compras' },
    ]);
    const lista = await service.listar('user-1');
    expect(lista.map((r) => r.merchant)).toEqual([
      'mercadolivreoficial',
      'mercadolivre',
      'mercado',
    ]);
  });

  it('nao enxerga regra de outro usuario', async () => {
    regras.push({ id: 'r9', userId: 'outro', merchant: 'netflix', categoryId: 'cat-compras', hits: 1 });
    expect(await service.listar('user-1')).toEqual([]);
  });

  it('categoria de outro usuario nao vira regra', async () => {
    cat('cat-alheia', { userId: 'outro' });
    await expect(ensinar('netflix', 'cat-alheia')).rejects.toThrow(NotFoundException);
    expect(regras).toEqual([]);
  });

  it('categoria com filhas nao vira regra', async () => {
    // Mesma regra de lançar: só folha recebe. Uma regra apontando para a pai
    // sugeriria, na importação seguinte, o que o app recusaria ao gravar.
    cat('cat-pai', { filhas: 2 });
    await expect(ensinar('netflix', 'cat-pai')).rejects.toThrow(BadRequestException);
    expect(regras).toEqual([]);
  });

  it('uma categoria invalida na leva nao deixa passar as outras', async () => {
    cat('cat-pai', { filhas: 1 });
    await expect(
      service.upsert('user-1', [
        { merchant: 'mercadolivre', categoryId: 'cat-compras' },
        { merchant: 'netflix', categoryId: 'cat-pai' },
      ]),
    ).rejects.toThrow(BadRequestException);
    expect(regras).toEqual([]);
  });

  it('guarda o nome como o extrato escreveu', async () => {
    // A chave e normalizada de proposito; o NOME e o que se mostra na tela.
    const lista = await ensinar('eddacai', 'cat-compras', 'Edd Acai');
    expect(lista[0]).toMatchObject({ merchant: 'eddacai', label: 'Edd Acai' });
  });

  it('ensinar sem nome nao apaga o nome que ja estava', async () => {
    // Trocar so a categoria pela lista de lojistas manda regra sem rotulo.
    await ensinar('eddacai', 'cat-compras', 'Edd Acai');
    const lista = await ensinar('eddacai', 'cat-alimentacao');
    expect(lista[0]).toMatchObject({ label: 'Edd Acai', categoryId: 'cat-alimentacao' });
  });

  it('ensinar com nome novo corrige o antigo', async () => {
    await ensinar('eddacai', 'cat-compras', 'eddacai');
    const lista = await ensinar('eddacai', 'cat-compras', 'Edd Acai');
    expect(lista[0].label).toBe('Edd Acai');
  });

  it('remover apaga a regra', async () => {
    const lista = await ensinar('mercadolivre');
    expect(await service.remover('user-1', lista[0].id)).toEqual({ removidas: 1 });
    expect(await service.listar('user-1')).toEqual([]);
  });

  it('remover regra de outro usuario nao apaga nada', async () => {
    regras.push({ id: 'r9', userId: 'outro', merchant: 'netflix', categoryId: 'cat-compras', hits: 1 });
    await expect(service.remover('user-1', 'r9')).rejects.toThrow(NotFoundException);
    expect(regras).toHaveLength(1);
  });
});
