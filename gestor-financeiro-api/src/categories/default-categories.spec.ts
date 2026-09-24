import { TransactionType } from '@prisma/client';
import { CATEGORIAS_PADRAO, garantirCategoriasPadrao } from './default-categories';

function prismaFalso(existentes: { name: string; type: TransactionType }[]) {
  const criadas: any[] = [];
  return {
    criadas,
    category: {
      findMany: jest.fn(async () => existentes),
      createMany: jest.fn(async ({ data }: any) => { criadas.push(...data); return { count: data.length }; }),
    },
  } as any;
}

describe('categorias padrão', () => {
  it('cria todas quando o banco está vazio — o caso do deploy sem seed', async () => {
    const p = prismaFalso([]);
    expect(await garantirCategoriasPadrao(p)).toBe(CATEGORIAS_PADRAO.length);
    expect(p.criadas.every((c: any) => c.userId === null && c.isDefault === true)).toBe(true);
    expect(p.criadas.map((c: any) => c.name)).toContain('Alimentação');
  });

  it('não recria o que já existe', async () => {
    const p = prismaFalso(CATEGORIAS_PADRAO.map(({ name, type }) => ({ name, type })));
    expect(await garantirCategoriasPadrao(p)).toBe(0);
    expect(p.category.createMany).not.toHaveBeenCalled();
  });

  it('cria só o que falta, e "Outros" existe nos dois tipos', async () => {
    const p = prismaFalso([{ name: 'Alimentação', type: TransactionType.EXPENSE }]);
    const criadas = await garantirCategoriasPadrao(p);
    expect(criadas).toBe(CATEGORIAS_PADRAO.length - 1);
    expect(p.criadas.find((c: any) => c.name === 'Alimentação')).toBeUndefined();
    // Mesmo nome em tipos diferentes são categorias distintas: a chave é nome+tipo.
    const outros = CATEGORIAS_PADRAO.filter((c) => c.name === 'Outros').map((c) => c.type);
    expect(outros).toEqual([TransactionType.EXPENSE, TransactionType.INCOME]);
  });
});
