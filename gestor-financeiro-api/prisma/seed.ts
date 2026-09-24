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

import { PrismaClient, BillingInterval } from '@prisma/client';
import { garantirCategoriasPadrao } from '../src/categories/default-categories';

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

async function main() {
  console.log('Iniciando seed de categorias padrão...');
  // Mesma lista que a API confere na subida (src/categories/default-categories):
  // duas cópias divergiriam no primeiro dia em que alguém mexesse em uma delas.
  const criadas = await garantirCategoriasPadrao(prisma);
  console.log(`Categorias padrão criadas: ${criadas}`);
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
