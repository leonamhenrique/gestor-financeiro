// ============================================================
// default-plans.ts
// ============================================================
// Os planos que o catálogo precisa ter para a tela de assinatura existir.
//
// Por que não só no seed: o `prisma db seed` não roda no deploy do Render —
// o start faz `migrate deploy` e sobe. Medido em produção: a tabela `plans`
// estava VAZIA depois de tudo configurado, e a tela abriria sem plano
// nenhum para escolher. Conferir na subida tira isso de depender de alguém
// lembrar de rodar um comando à mão.
//
// `amount` é o valor cobrado A CADA CICLO, não a mensalidade equivalente.
// No anual isso é o total do ano: guardar 23,90 aqui faria o gateway cobrar
// R$ 23,90 uma vez por ano.
//
// `code` é a chave estável que o código e o gateway usam. Mudar um code
// depois de existir assinatura órfã essa assinatura — por isso o upsert
// atualiza nome e valor, nunca o code.
// ============================================================

import { BillingInterval, PrismaClient } from '@prisma/client';

export const PLANOS_PADRAO = [
  { code: 'free', name: 'Gratuito', amount: 0, interval: BillingInterval.MONTHLY },
  { code: 'pro-mensal', name: 'Pro', amount: 29.9, interval: BillingInterval.MONTHLY },
  { code: 'pro-anual', name: 'Pro Anual', amount: 286.8, interval: BillingInterval.YEARLY },
  // TEMPORÁRIO — só para provar a cobrança em produção com dinheiro de
  // verdade sem gastar 29,90. Sai desta lista depois do teste, e aí é
  // DESATIVADO sozinho na subida seguinte (ver abaixo: o catálogo daqui é a
  // verdade, e plano que sai da lista para de ser oferecido).
  { code: 'teste-cobranca', name: 'Teste de cobrança', amount: 5, interval: BillingInterval.MONTHLY },
];

/**
 * Garante o catálogo. Devolve quantos planos NASCERAM agora — zero quando já
 * estavam todos lá, que é o caso de toda subida depois da primeira.
 *
 * O preço é atualizado junto, de propósito: o valor que a tela mostra e o
 * que o gateway cobra saem daqui, e deixar um plano com preço velho no banco
 * seria cobrar um número que ninguém escolheu.
 */
export async function garantirPlanosPadrao(prisma: PrismaClient | any): Promise<number> {
  let criados = 0;
  for (const plano of PLANOS_PADRAO) {
    const antes = await prisma.plan.findUnique({ where: { code: plano.code } });
    await prisma.plan.upsert({
      where: { code: plano.code },
      create: plano,
      update: { name: plano.name, amount: plano.amount, interval: plano.interval, isActive: true },
    });
    if (!antes) criados++;
  }

  // O catálogo daqui é a VERDADE: plano que saiu desta lista para de ser
  // oferecido. Desativado e não apagado, porque assinatura existente aponta
  // para ele — apagar levaria junto o histórico de quem pagou, e a chave
  // estrangeira recusaria de qualquer forma.
  //
  // Quem já assinou um plano desativado continua com ele: o acesso olha o
  // status da assinatura, não se o plano ainda está à venda.
  await prisma.plan.updateMany({
    where: { isActive: true, code: { notIn: PLANOS_PADRAO.map((p) => p.code) } },
    data: { isActive: false },
  });

  return criados;
}
