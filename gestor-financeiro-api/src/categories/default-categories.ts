// ============================================================
// default-categories.ts
// ============================================================
// As categorias que toda conta enxerga desde o primeiro minuto (userId null,
// isDefault true). Sem elas o app trava logo na entrada: não dá para lançar
// nada sem categoria, e o ditado não tem o que reconhecer.
//
// Por que viver no código e não só no `prisma db seed`: o seed é um comando
// que alguém precisa lembrar de rodar, e esquecer disso num deploy deixa o
// banco de produção sem nenhuma categoria — foi exatamente o que aconteceu.
// Aqui elas são conferidas na subida da API, toda vez, e criadas se faltarem.
// O seed continua existindo e usa esta mesma lista, para não haver duas.
// ============================================================

import { Prisma, PrismaClient, TransactionType } from '@prisma/client';

export interface CategoriaPadrao {
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
}

const DESPESAS = [
  { name: 'Alimentação', icon: 'utensils', color: '#F97316' },
  { name: 'Transporte', icon: 'car', color: '#3B82F6' },
  { name: 'Moradia', icon: 'home', color: '#8B5CF6' },
  { name: 'Saúde', icon: 'heart-pulse', color: '#EF4444' },
  { name: 'Educação', icon: 'graduation-cap', color: '#06B6D4' },
  { name: 'Lazer', icon: 'gamepad-2', color: '#EC4899' },
  { name: 'Compras', icon: 'shopping-bag', color: '#F59E0B' },
  { name: 'Assinaturas', icon: 'refresh-cw', color: '#6366F1' },
  { name: 'Contas e Serviços', icon: 'file-text', color: '#64748B' },
  { name: 'Cuidados Pessoais', icon: 'sparkles', color: '#D946EF' },
  { name: 'Pets', icon: 'paw-print', color: '#84CC16' },
  { name: 'Impostos e Taxas', icon: 'landmark', color: '#78716C' },
  { name: 'Outros', icon: 'more-horizontal', color: '#9CA3AF' }, // destino padrão de reatribuição
];

const RECEITAS = [
  { name: 'Salário', icon: 'briefcase', color: '#22C55E' },
  { name: 'Freelance', icon: 'laptop', color: '#14B8A6' },
  { name: 'Investimentos', icon: 'trending-up', color: '#0EA5E9' },
  { name: 'Presente', icon: 'gift', color: '#F472B6' },
  { name: 'Reembolso', icon: 'rotate-ccw', color: '#A3E635' },
  { name: 'Outros', icon: 'more-horizontal', color: '#9CA3AF' },
];

export const CATEGORIAS_PADRAO: CategoriaPadrao[] = [
  ...DESPESAS.map((c) => ({ ...c, type: TransactionType.EXPENSE })),
  ...RECEITAS.map((c) => ({ ...c, type: TransactionType.INCOME })),
];

/** Cria só o que estiver faltando e devolve quantas criou. Roda a cada subida,
 * então é uma consulta e, no caso normal, nenhuma escrita.
 *
 * Nome + tipo é a identidade aqui: não dá para usar `upsert`, porque a chave
 * única do schema inclui `userId`, e no Postgres dois NULL não colidem — o
 * upsert criaria uma cópia nova a cada execução. */
export async function garantirCategoriasPadrao(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<number> {
  const chave = (c: { name: string; type: TransactionType }) => `${c.type}:${c.name}`;
  const existentes = await prisma.category.findMany({
    where: { userId: null, isDefault: true },
    select: { name: true, type: true },
  });
  const jaExiste = new Set(existentes.map(chave));
  const faltando = CATEGORIAS_PADRAO.filter((c) => !jaExiste.has(chave(c)));
  if (!faltando.length) return 0;

  await prisma.category.createMany({
    data: faltando.map((c) => ({ ...c, userId: null, isDefault: true })),
  });
  return faltando.length;
}
