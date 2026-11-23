// ============================================================
// entitlements.spec.ts
// ============================================================
// O que estes testes defendem:
//
// 1. quem PAGA nunca recebe menos do que pagou — nem durante o teste;
// 2. plano que o código não conhece cai no grátis, e não em acesso total;
// 3. o teste dá o Pro, menos o histórico longo, que é o que o Pro vende;
// 4. limite cheio não cria mais um, e `null` não limita nada.
// ============================================================

import { direitosDe, noTeste, diasDeTeste, cabeMais } from './entitlements';

const AGORA = new Date('2026-11-22T12:00:00Z');
const DAQUI_A = (dias: number) => new Date(AGORA.getTime() + dias * 86400000);

describe('direitos do plano', () => {
  it('sem assinatura e sem teste, é o grátis: um de cada e nenhum banco', () => {
    const d = direitosDe({}, AGORA);
    expect(d).toMatchObject({ contas: 1, cartoes: 1, objetivos: 1, bancos: 0 });
    expect(d.fluxoDeCaixa).toBe(false);
    expect(d.compartilhadas).toBe(false);
    expect(d.whatsappPorMes).toBe(0);
  });

  it('no teste, o Pro inteiro — menos o histórico, que é 1 mês', () => {
    const d = direitosDe({ testeAte: DAQUI_A(3) }, AGORA);
    expect(d.fluxoDeCaixa).toBe(true);
    expect(d.compartilhadas).toBe(true);
    expect(d.whatsappPorMes).toBe(100);
    expect(d.bancos).toBe(1);
    expect(d.mesesDeHistorico).toBe(1);
  });

  it('o Pro conecta 5 bancos e traz 12 meses', () => {
    const d = direitosDe({ codigo: 'pro-mensal', liberada: true }, AGORA);
    expect(d.bancos).toBe(5);
    expect(d.mesesDeHistorico).toBe(12);
    expect(d.contas).toBe(10);
  });

  it('o anual dá o mesmo que o mensal', () => {
    expect(direitosDe({ codigo: 'pro-anual', liberada: true }, AGORA)).toEqual(
      direitosDe({ codigo: 'pro-mensal', liberada: true }, AGORA),
    );
  });

  it('o Premium conecta 12 bancos e não limita cadastro nem mensagem', () => {
    const d = direitosDe({ codigo: 'premium-mensal', liberada: true }, AGORA);
    expect(d.bancos).toBe(12);
    expect(d.contas).toBeNull();
    expect(d.cartoes).toBeNull();
    expect(d.whatsappPorMes).toBeNull();
    expect(d.mesesDeHistorico).toBe(12);
  });

  /* O caso que o `if` na ordem errada estragaria: quem assina no meio do
   * teste receberia 1 banco em vez dos 5 que acabou de pagar. */
  it('quem paga no meio do teste recebe o que pagou, e não o teste', () => {
    const d = direitosDe({ codigo: 'pro-mensal', liberada: true, testeAte: DAQUI_A(4) }, AGORA);
    expect(d.bancos).toBe(5);
    expect(d.mesesDeHistorico).toBe(12);
  });

  it('assinatura NÃO liberada (inadimplente) cai no grátis', () => {
    const d = direitosDe({ codigo: 'pro-mensal', liberada: false }, AGORA);
    expect(d.bancos).toBe(0);
  });

  /* Um `code` novo no banco que o código ainda não conhece não pode virar
   * acesso total por omissão. */
  it('plano desconhecido cai no grátis', () => {
    expect(direitosDe({ codigo: 'plano-que-ninguem-escreveu', liberada: true }, AGORA).bancos).toBe(0);
  });

  it('teste vencido é grátis', () => {
    expect(direitosDe({ testeAte: DAQUI_A(-1) }, AGORA).bancos).toBe(0);
  });
});

describe('quanto falta de teste', () => {
  it('conta os dias para cima, e zera quando acaba', () => {
    expect(diasDeTeste({ testeAte: DAQUI_A(6.2) }, AGORA)).toBe(7);
    expect(diasDeTeste({ testeAte: DAQUI_A(0.1) }, AGORA)).toBe(1);
    expect(diasDeTeste({ testeAte: DAQUI_A(-0.1) }, AGORA)).toBe(0);
  });

  it('quem assinou não está mais "em teste", mesmo com a data correndo', () => {
    expect(noTeste({ codigo: 'pro-mensal', liberada: true, testeAte: DAQUI_A(3) }, AGORA)).toBe(false);
    expect(noTeste({ testeAte: DAQUI_A(3) }, AGORA)).toBe(true);
  });
});

describe('cabe mais um?', () => {
  it('limite cheio não cria mais um', () => {
    expect(cabeMais(1, 0)).toBe(true);
    expect(cabeMais(1, 1)).toBe(false);
    expect(cabeMais(10, 9)).toBe(true);
    expect(cabeMais(10, 10)).toBe(false);
  });

  it('`null` não limita, e zero não deixa criar nenhum', () => {
    expect(cabeMais(null, 999)).toBe(true);
    expect(cabeMais(0, 0)).toBe(false);
  });

  /* Quem caiu de plano com mais do que o novo limite continua com tudo: o
   * limite é sobre criar, e `cabeMais` é a única pergunta que o serviço faz. */
  it('acima do limite não cria, mas a pergunta nunca é sobre apagar', () => {
    expect(cabeMais(1, 5)).toBe(false);
  });
});
