// ============================================================
// budget.utils.ts
// ============================================================
// As contas de um planejamento que não dependem do banco.
//
// Uma regra manda em todas elas: as metas por categoria são REPARTIÇÃO do
// teto do mês, nunca soma por cima dele. Disso sai tudo o mais — inclusive a
// parte que engana, que é a categoria pai.
//
// Quando a pai tem meta, a meta da filha está DENTRO dela: é detalhe de como
// a pai se reparte, não dinheiro a mais. Somar as duas contaria o mesmo
// dinheiro duas vezes, e o teto do mês passaria a caber menos do que diz.
// ============================================================

import { Prisma } from '@prisma/client';

export type Dinheiro = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);

export const dec = (v: unknown): Dinheiro =>
  v instanceof Prisma.Decimal ? v : new Prisma.Decimal((v as string | number) ?? 0);

export const emReais = (v: Dinheiro): string => v.toFixed(2);

export interface MetaDeCategoria {
  categoryId: string;
  amount: Dinheiro;
  /** "Usar total das subcategorias": a meta é a soma das filhas. */
  fromChildren?: boolean;
}

export interface CategoriaNaArvore {
  id: string;
  parentId: string | null;
}

const paiDe = (id: string, categorias: CategoriaNaArvore[]): string | null =>
  categorias.find((c) => c.id === id)?.parentId ?? null;

/** As filhas diretas de uma categoria. A árvore tem um nível só, então não há
 * neta para procurar. */
export const filhasDe = (id: string, categorias: CategoriaNaArvore[]): string[] =>
  categorias.filter((c) => c.parentId === id).map((c) => c.id);

/** Soma das metas das filhas de uma categoria. */
export function somaDasFilhas(
  id: string,
  metas: MetaDeCategoria[],
  categorias: CategoriaNaArvore[],
): Dinheiro {
  const filhas = filhasDe(id, categorias);
  return metas
    .filter((m) => filhas.includes(m.categoryId))
    .reduce((s, m) => s.plus(dec(m.amount)), ZERO);
}

/**
 * Recalcula a meta de toda pai marcada como "usar total das subcategorias".
 * Fazer isso aqui, e não na tela, é o que impede a pai ficar com um número
 * velho quando uma filha muda por outro caminho — copiar de outro mês, por
 * exemplo.
 */
export function aplicarTotalDasFilhas(
  metas: MetaDeCategoria[],
  categorias: CategoriaNaArvore[],
): MetaDeCategoria[] {
  return metas.map((m) =>
    m.fromChildren ? { ...m, amount: somaDasFilhas(m.categoryId, metas, categorias) } : m,
  );
}

/**
 * Quanto do teto do mês já está prometido.
 *
 * Conta cada galho UMA vez: a meta da filha só entra quando a pai dela não
 * tem meta. Com meta na pai, a da filha é detalhe de dentro — e somar as duas
 * faria o teto caber menos do que ele diz.
 */
export function comprometido(
  metas: MetaDeCategoria[],
  categorias: CategoriaNaArvore[],
): Dinheiro {
  const comMeta = new Set(metas.map((m) => m.categoryId));
  return metas.reduce((s, m) => {
    const pai = paiDe(m.categoryId, categorias);
    if (pai && comMeta.has(pai)) return s; // já contada dentro da pai
    return s.plus(dec(m.amount));
  }, ZERO);
}

/** O que sobra do teto depois das metas: é a meta implícita de "outras
 * categorias", e por isso nunca é negativa — o serviço recusa antes. */
export function sobraDoTeto(
  total: Dinheiro,
  metas: MetaDeCategoria[],
  categorias: CategoriaNaArvore[],
): Dinheiro {
  return Prisma.Decimal.max(ZERO, dec(total).minus(comprometido(metas, categorias)));
}

/** Mês no formato que o banco aceita: "AAAA-MM". */
export const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const mesValido = (m: string): boolean => MES.test(m);
