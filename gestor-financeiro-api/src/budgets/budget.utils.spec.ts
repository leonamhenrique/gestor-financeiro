// ============================================================
// budget.utils.spec.ts
// ============================================================
// O que estes testes cobrem, em uma frase: a meta da filha está DENTRO da
// meta da pai, e contá-la de novo faria o teto do mês caber menos do que ele
// diz.
// ============================================================

import { Prisma } from '@prisma/client';
import {
  ZERO,
  aplicarTotalDasFilhas,
  comprometido,
  emReais,
  filhasDe,
  mesValido,
  sobraDoTeto,
  somaDasFilhas,
  type CategoriaNaArvore,
  type MetaDeCategoria,
} from './budget.utils';

const d = (n: number | string) => new Prisma.Decimal(n);
const meta = (categoryId: string, amount: number, fromChildren = false): MetaDeCategoria => ({
  categoryId,
  amount: d(amount),
  fromChildren,
});

/** Alimentação com duas filhas, Assinaturas com uma, Moradia sozinha. */
const arvore: CategoriaNaArvore[] = [
  { id: 'alim', parentId: null },
  { id: 'mercado', parentId: 'alim' },
  { id: 'restaurante', parentId: 'alim' },
  { id: 'assin', parentId: null },
  { id: 'spotify', parentId: 'assin' },
  { id: 'moradia', parentId: null },
];

describe('árvore', () => {
  it('acha as filhas diretas', () => {
    expect(filhasDe('alim', arvore).sort()).toEqual(['mercado', 'restaurante']);
  });
  it('categoria sem filha devolve lista vazia', () => {
    expect(filhasDe('moradia', arvore)).toEqual([]);
  });
});

describe('soma das filhas', () => {
  it('soma só as filhas daquela pai', () => {
    const metas = [meta('mercado', 500), meta('restaurante', 300), meta('spotify', 12)];
    expect(emReais(somaDasFilhas('alim', metas, arvore))).toBe('800.00');
  });
  it('sem filha com meta, é zero', () => {
    expect(emReais(somaDasFilhas('moradia', [meta('mercado', 500)], arvore))).toBe('0.00');
  });
});

describe('usar total das subcategorias', () => {
  it('a pai marcada recebe a soma das filhas', () => {
    const metas = [meta('alim', 10, true), meta('mercado', 500), meta('restaurante', 300)];
    const depois = aplicarTotalDasFilhas(metas, arvore);
    expect(emReais(depois[0].amount)).toBe('800.00');
  });

  it('a pai NÃO marcada fica com o valor que a pessoa digitou', () => {
    const metas = [meta('alim', 1000), meta('mercado', 500)];
    expect(emReais(aplicarTotalDasFilhas(metas, arvore)[0].amount)).toBe('1000.00');
  });

  /** É aqui que o recálculo ganha o lugar: copiar de outro mês ou mexer numa
   * filha por outro caminho deixaria a pai com um número velho. */
  it('mudar uma filha muda a pai marcada, sem ninguém tocar nela', () => {
    const antes = [meta('alim', 0, true), meta('mercado', 500), meta('restaurante', 300)];
    expect(emReais(aplicarTotalDasFilhas(antes, arvore)[0].amount)).toBe('800.00');

    const depois = [meta('alim', 800, true), meta('mercado', 650), meta('restaurante', 300)];
    expect(emReais(aplicarTotalDasFilhas(depois, arvore)[0].amount)).toBe('950.00');
  });

  it('pai marcada sem filha nenhuma vai a zero, não fica com o valor antigo', () => {
    expect(emReais(aplicarTotalDasFilhas([meta('moradia', 700, true)], arvore)[0].amount)).toBe('0.00');
  });
});

describe('quanto do teto já está prometido', () => {
  /** A regra que dá sentido ao resto. */
  it('com meta na pai, a meta da filha NÃO soma de novo', () => {
    const metas = [meta('alim', 800, true), meta('mercado', 500), meta('restaurante', 300)];
    expect(emReais(comprometido(metas, arvore))).toBe('800.00');
  });

  it('sem meta na pai, a filha soma sozinha', () => {
    expect(emReais(comprometido([meta('mercado', 500)], arvore))).toBe('500.00');
  });

  it('galhos diferentes somam entre si', () => {
    const metas = [
      meta('alim', 800, true), meta('mercado', 500), meta('restaurante', 300),
      meta('assin', 12, true), meta('spotify', 12),
      meta('moradia', 1500),
    ];
    expect(emReais(comprometido(metas, arvore))).toBe('2312.00'); // 800 + 12 + 1500
  });

  it('sem meta nenhuma, zero', () => {
    expect(emReais(comprometido([], arvore))).toBe('0.00');
  });

  it('fecha no centavo onde Float erraria', () => {
    const metas = Array.from({ length: 10 }, (_, i) => meta('c' + i, 0.1));
    const soltas: CategoriaNaArvore[] = metas.map((m) => ({ id: m.categoryId, parentId: null }));
    expect(emReais(comprometido(metas, soltas))).toBe('1.00');
  });
});

describe('o que sobra do teto', () => {
  it('é a meta implícita de "outras categorias"', () => {
    const metas = [meta('alim', 800, true), meta('mercado', 800), meta('moradia', 1500)];
    expect(emReais(sobraDoTeto(d(5000), metas, arvore))).toBe('2700.00');
  });

  it('nunca é negativa — quem repartiu demais é recusado antes', () => {
    expect(emReais(sobraDoTeto(d(100), [meta('moradia', 500)], arvore))).toBe('0.00');
  });

  it('teto inteiro livre quando não há meta', () => {
    expect(emReais(sobraDoTeto(d(5000), [], arvore))).toBe('5000.00');
  });

  it('zero quando tudo foi repartido', () => {
    expect(emReais(sobraDoTeto(d(1500), [meta('moradia', 1500)], arvore))).toBe('0.00');
  });
});

describe('mês', () => {
  it('aceita AAAA-MM', () => {
    expect([mesValido('2026-01'), mesValido('2026-12')]).toEqual([true, true]);
  });
  it('recusa mês fora da faixa, sem zero e com formato errado', () => {
    expect([mesValido('2026-00'), mesValido('2026-13'), mesValido('2026-7'), mesValido('julho')])
      .toEqual([false, false, false, false]);
  });
  it('recusa o que só começa parecido', () => {
    expect([mesValido('2026-07-01'), mesValido('x2026-07')]).toEqual([false, false]);
  });
  it('ZERO é zero', () => {
    expect(emReais(ZERO)).toBe('0.00');
  });
});
