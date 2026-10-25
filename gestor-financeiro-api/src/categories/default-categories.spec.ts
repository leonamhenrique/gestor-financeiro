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

  it('"Presente" existe nos dois tipos: o que se da e despesa, o que se recebe e receita', () => {
    const presentes = CATEGORIAS_PADRAO.filter((c) => c.name === 'Presente').map((c) => c.type);
    expect(presentes).toEqual([TransactionType.EXPENSE, TransactionType.INCOME]);
  });

  it('o "Presente" de despesa entra num banco que ja tinha so o de receita', () => {
    // O caso real de quem já usa o app: o banco tem a lista antiga, e a
    // subida da API precisa criar só a nova — sem tropeçar no nome repetido.
    const antigas = CATEGORIAS_PADRAO.filter(
      (c) => !(c.name === 'Presente' && c.type === TransactionType.EXPENSE),
    ).map(({ name, type }) => ({ name, type }));
    const p = prismaFalso(antigas);
    return garantirCategoriasPadrao(p).then((n) => {
      expect(n).toBe(1);
      expect(p.criadas).toHaveLength(1);
      expect(p.criadas[0]).toMatchObject({ name: 'Presente', type: TransactionType.EXPENSE });
    });
  });

  it('nenhuma despesa padrao repete a cor de outra', () => {
    // Cor é identidade nos relatórios: duas categorias da mesma cor na barra
    // de participação viram uma fatia só aos olhos de quem lê.
    const cores = CATEGORIAS_PADRAO.filter((c) => c.type === TransactionType.EXPENSE).map((c) => c.color);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it('a cor de uma despesa nova fica longe das que ja existem', () => {
    // Medida, não estimada. OKLab ×100; 8 é o piso para cor categórica, e
    // abaixo disso duas fatias vizinhas deixam de se distinguir.
    const f = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const oklab = (hex: string) => {
      const r = f(parseInt(hex.slice(1, 3), 16) / 255);
      const g = f(parseInt(hex.slice(3, 5), 16) / 255);
      const b = f(parseInt(hex.slice(5, 7), 16) / 255);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ];
    };
    const dist = (a: string, b: string) => {
      const A = oklab(a);
      const B = oklab(b);
      return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 100;
    };

    const despesas = CATEGORIAS_PADRAO.filter((c) => c.type === TransactionType.EXPENSE);
    const presente = despesas.find((c) => c.name === 'Presente')!;
    const perto = despesas
      .filter((c) => c !== presente)
      .map((c) => ({ nome: c.name, d: dist(presente.color, c.color) }))
      .sort((a, b) => a.d - b.d)[0];

    expect(perto.d).toBeGreaterThanOrEqual(8);
  });
});
