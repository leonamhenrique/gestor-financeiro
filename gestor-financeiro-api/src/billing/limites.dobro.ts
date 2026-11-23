// ============================================================
// limites.dobro.ts — o dublê da trava de plano, para os testes
// ============================================================
// Os serviços de cadastro passaram a perguntar ao plano antes de criar. Em
// teste isso não é o assunto: quem testa conta bancária quer saber do saldo
// inicial, não do plano. O dublê deixa passar.
//
// Mora em `src/` e não em `test/` porque o Jest deste projeto tem `rootDir`
// em `src` — fora dali ele não é compilado.
//
// Para testar a trava EM SI, não use isto: `entitlements.spec.ts` prova a
// tabela, e `limites.service.spec.ts` prova o 403.
// ============================================================

import { LimitesService } from './limites.service';

/** Um `LimitesService` que nunca recusa. */
export function limitesLiberados(): Partial<LimitesService> {
  return {
    conferirConta: jest.fn().mockResolvedValue(undefined),
    conferirCartao: jest.fn().mockResolvedValue(undefined),
    conferirObjetivo: jest.fn().mockResolvedValue(undefined),
    conferirBanco: jest.fn().mockResolvedValue(undefined),
    conferirMesDoPlanejamento: jest.fn().mockResolvedValue(undefined),
  };
}

/** O provider pronto, para entrar na lista do `createTestingModule`. */
export const PROVIDER_LIMITES_LIBERADOS = {
  provide: LimitesService,
  useFactory: limitesLiberados,
};
