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

import { PrismaClient } from '@prisma/client';
import { garantirCategoriasPadrao } from '../src/categories/default-categories';

const prisma = new PrismaClient();

// ------------------------------------------------------------
// PLANOS DE ASSINATURA
// ------------------------------------------------------------
// A lista mora em `src/billing/default-plans.ts`, e não aqui: ela é
// conferida na SUBIDA da API, porque o `prisma db seed` não roda no deploy
// do Render. Duas listas divergiriam no primeiro ajuste de preço, e o
// catálogo do banco passaria a depender de qual das duas rodou por último.
import { PLANOS_PADRAO } from '../src/billing/default-plans';

async function seedPlanos() {
  for (const plano of PLANOS_PADRAO) {
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
