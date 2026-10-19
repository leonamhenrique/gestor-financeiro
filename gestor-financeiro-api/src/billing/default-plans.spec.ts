// ============================================================
// default-plans.spec.ts
// ============================================================
// O catálogo vazio foi encontrado em PRODUÇÃO, com tudo o mais já
// configurado: a tela de assinatura abriria sem nenhum plano para escolher.
// Estes testes existem para isso não voltar em silêncio.
// ============================================================

import { garantirPlanosPadrao, PLANOS_PADRAO } from './default-plans';

function prismaFalso(existentes: Record<string, any> = {}) {
  const banco = { ...existentes };
  return {
    banco,
    plan: {
      findUnique: jest.fn(async ({ where }: any) => banco[where.code] ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        banco[where.code] = banco[where.code] ? { ...banco[where.code], ...update } : { ...create };
        return banco[where.code];
      }),
    },
  };
}

describe('garantirPlanosPadrao()', () => {
  it('cria o catálogo num banco vazio', async () => {
    const p = prismaFalso();
    const criados = await garantirPlanosPadrao(p as any);

    expect(criados).toBe(PLANOS_PADRAO.length);
    expect(Object.keys(p.banco).sort()).toEqual(['free', 'pro-anual', 'pro-mensal']);
  });

  // Roda em toda subida da API: a segunda vez não pode duplicar nem contar
  // como criação, senão o log diria que criou algo a cada reinício.
  it('rodar de novo não cria nada', async () => {
    const p = prismaFalso();
    await garantirPlanosPadrao(p as any);
    const naSegunda = await garantirPlanosPadrao(p as any);

    expect(naSegunda).toBe(0);
    expect(Object.keys(p.banco)).toHaveLength(PLANOS_PADRAO.length);
  });

  // O preço que a tela mostra e o que o gateway cobra saem daqui. Deixar um
  // valor velho no banco seria cobrar um número que ninguém escolheu.
  it('corrige preço e nome que ficaram para trás', async () => {
    const p = prismaFalso({
      'pro-mensal': { code: 'pro-mensal', name: 'Nome antigo', amount: 9.9, interval: 'MONTHLY' },
    });
    await garantirPlanosPadrao(p as any);

    expect(p.banco['pro-mensal'].amount).toBe(29.9);
    expect(p.banco['pro-mensal'].name).toBe('Pro');
  });

  // Mudar um `code` órfa a assinatura que aponta para ele. O upsert atualiza
  // nome e valor; o code nunca entra no `update`.
  it('o code nunca é atualizado: assinatura existente ficaria órfã', async () => {
    const p = prismaFalso();
    await garantirPlanosPadrao(p as any);
    for (const chamada of p.plan.upsert.mock.calls) {
      expect(Object.keys(chamada[0].update)).not.toContain('code');
    }
  });

  // No anual o valor é o TOTAL do ano. Guardar a mensalidade equivalente
  // faria o gateway cobrar R$ 23,90 uma vez por ano.
  it('o plano anual guarda o total do ano, não a mensalidade', () => {
    const anual = PLANOS_PADRAO.find((p) => p.code === 'pro-anual')!;
    expect(anual.interval).toBe('YEARLY');
    expect(anual.amount).toBe(286.8);
    expect(anual.amount).toBeCloseTo(23.9 * 12, 2);
  });
});
