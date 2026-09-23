// ============================================================
// prisma/seed.ts
// ============================================================
// Roda com: npx prisma db seed
// (requer "prisma": { "seed": "ts-node prisma/seed.ts" } no package.json)
//
// Cria as categorias padrão do sistema (userId: null, isDefault: true).
// Usa `upsert` para ser seguro rodar múltiplas vezes sem duplicar —
// importante porque este script normalmente roda em todo deploy, não
// só na primeira vez.
// ============================================================

import { PrismaClient, TransactionType, BillingInterval } from '@prisma/client';

const prisma = new PrismaClient();

// ------------------------------------------------------------
// PLANOS DE ASSINATURA
// ------------------------------------------------------------
// `amount` é o valor cobrado A CADA CICLO, não a mensalidade equivalente.
// No plano anual isso significa o total do ano: guardar 23.90 aqui faria o
// gateway cobrar R$ 23,90 uma vez por ano em vez de R$ 286,80.
//
// `code` é a chave estável usada pelo código e pelo gateway — mudar um code
// depois de existir assinatura órfã a assinatura. O `name` e o `amount` podem
// mudar à vontade; o code, não.
//
// Ajuste os valores aqui antes de ligar um gateway de verdade.
const PLANOS = [
  {
    code: 'free',
    name: 'Gratuito',
    amount: 0,
    interval: BillingInterval.MONTHLY,
  },
  {
    code: 'pro-mensal',
    name: 'Pro',
    amount: 29.9,
    interval: BillingInterval.MONTHLY,
  },
  {
    code: 'pro-anual',
    name: 'Pro Anual',
    amount: 286.8, // 23,90/mês × 12 — o desconto está embutido no total
    interval: BillingInterval.YEARLY,
  },
];

async function seedPlanos() {
  for (const plano of PLANOS) {
    // `update` só mexe no que é seguro mudar. Deixar o code fora do update é
    // proposital: ele é a identidade do plano.
    await prisma.plan.upsert({
      where: { code: plano.code },
      create: plano,
      update: { name: plano.name, amount: plano.amount, interval: plano.interval },
    });
    console.log(`Plano em dia: ${plano.code} — ${plano.name} (R$ ${plano.amount.toFixed(2)})`);
  }
}

const DEFAULT_EXPENSE_CATEGORIES = [
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
  { name: 'Outros', icon: 'more-horizontal', color: '#9CA3AF' }, // usada como destino padrão de reatribuição
];

const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salário', icon: 'briefcase', color: '#22C55E' },
  { name: 'Freelance', icon: 'laptop', color: '#14B8A6' },
  { name: 'Investimentos', icon: 'trending-up', color: '#0EA5E9' },
  { name: 'Presente', icon: 'gift', color: '#F472B6' },
  { name: 'Reembolso', icon: 'rotate-ccw', color: '#A3E635' },
  { name: 'Outros', icon: 'more-horizontal', color: '#9CA3AF' },
];

async function seedCategories(
  categories: { name: string; icon: string; color: string }[],
  type: TransactionType,
) {
  for (const category of categories) {
    // upsert precisa de uma chave única. userId é null aqui, e o
    // @@unique([userId, name, type]) do schema aceita null em userId
    // normalmente (Postgres trata múltiplos NULLs como distintos por
    // padrão), então usamos findFirst + create condicional em vez de
    // upsert direto, para não correr risco de duplicar categoria
    // padrão em reexecuções.
    const existing = await prisma.category.findFirst({
      where: { userId: null, name: category.name, type },
    });

    if (!existing) {
      await prisma.category.create({
        data: {
          userId: null,
          name: category.name,
          type,
          icon: category.icon,
          color: category.color,
          isDefault: true,
        },
      });
      console.log(`Criada categoria padrão: [${type}] ${category.name}`);
    }
  }
}

async function main() {
  console.log('Iniciando seed de categorias padrão...');
  await seedCategories(DEFAULT_EXPENSE_CATEGORIES, TransactionType.EXPENSE);
  await seedCategories(DEFAULT_INCOME_CATEGORIES, TransactionType.INCOME);
  console.log('Iniciando seed de planos...');
  await seedPlanos();
  console.log('Seed concluído.');
}

main()
  .catch((error) => {
    console.error('Erro ao rodar o seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
