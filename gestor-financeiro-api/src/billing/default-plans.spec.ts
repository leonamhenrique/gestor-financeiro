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
        banco[where.code] = banco[where.code]
          ? { ...banco[where.code], ...update }
          : { isActive: true, ...create };
        return banco[where.code];
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        for (const p of Object.values(banco) as any[]) {
          if (p.isActive !== false && !where.code.notIn.includes(p.code)) Object.assign(p, data);
        }
      }),
    },
  };
}

describe('garantirPlanosPadrao()', () => {
  it('cria o catálogo num banco vazio', async () => {
    const p = prismaFalso();
    const criados = await garantirPlanosPadrao(p as any);

    expect(criados).toBe(PLANOS_PADRAO.length);
    // Derivado da lista, e não escrito à mão: um plano a mais no catálogo
    // não deve quebrar este teste, que é sobre criar tudo que está lá.
    expect(Object.keys(p.banco).sort()).toEqual(PLANOS_PADRAO.map((x) => x.code).sort());
    // Os de sempre têm de estar entre eles.
    for (const fixo of ['free', 'pro-mensal', 'pro-anual']) {
      expect(Object.keys(p.banco)).toContain(fixo);
    }
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

  // O catálogo do código é a verdade: plano que saiu da lista para de ser
  // oferecido. É o que deixa um plano temporário (um teste de cobrança, uma
  // promoção) sumir sozinho quando sai do código.
  it('plano fora da lista é desativado, não apagado', async () => {
    const p = prismaFalso({
      'promo-antiga': { code: 'promo-antiga', name: 'Promo', amount: 1, isActive: true },
    });
    await garantirPlanosPadrao(p as any);

    // Continua existindo: assinatura que aponta para ele não pode ficar órfã.
    expect(p.banco['promo-antiga']).toBeDefined();
    expect(p.banco['promo-antiga'].isActive).toBe(false);
  });

  it('plano que voltou para a lista é reativado', async () => {
    const codigo = PLANOS_PADRAO[1].code;
    const p = prismaFalso({
      [codigo]: { ...PLANOS_PADRAO[1], isActive: false },
    });
    await garantirPlanosPadrao(p as any);
    expect(p.banco[codigo].isActive).toBe(true);
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
