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

import { direitosDe, noTeste, diasDeTeste, cabeMais, temCortesia } from './entitlements';

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

  /* O teto do pago é de CONEXÃO, não de cadastro: banco que a pessoa cadastra
   * à mão para lançar sem integração não custa nada e não se limita. */
  it('o Pro conecta 5 bancos, traz 12 meses e não limita cadastro', () => {
    const d = direitosDe({ codigo: 'pro-mensal', liberada: true }, AGORA);
    expect(d.bancos).toBe(5);
    expect(d.mesesDeHistorico).toBe(12);
    expect(d.contas).toBeNull();
    expect(d.cartoes).toBeNull();
    expect(d.objetivos).toBeNull();
  });

  it('o anual dá o mesmo que o mensal', () => {
    expect(direitosDe({ codigo: 'pro-anual', liberada: true }, AGORA)).toEqual(
      direitosDe({ codigo: 'pro-mensal', liberada: true }, AGORA),
    );
  });

  /* O que separa Premium de Pro é só o que custa por uso. */
  it('o Premium conecta 12 bancos e não limita mensagem', () => {
    const d = direitosDe({ codigo: 'premium-mensal', liberada: true }, AGORA);
    expect(d.bancos).toBe(12);
    expect(d.whatsappPorMes).toBeNull();
    expect(d.mesesDeHistorico).toBe(12);
  });

  it('Pro e Premium só diferem no que custa por uso', () => {
    const pro: any = direitosDe({ codigo: 'pro-mensal', liberada: true }, AGORA);
    const premium: any = direitosDe({ codigo: 'premium-mensal', liberada: true }, AGORA);
    const diferentes = Object.keys(pro).filter((k) => pro[k] !== premium[k]);
    expect(diferentes.sort()).toEqual(['bancos', 'whatsappPorMes']);
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

/* A conta de quem mantém o app não pode perder função no oitavo dia por
 * nunca ter passado pelo checkout — e também não pode virar uma assinatura
 * de mentira, com fatura e cancelamento que ninguém vai honrar. */
describe('Premium de cortesia', () => {
  const guardado = process.env.PREMIUM_USERS;
  afterEach(() => { process.env.PREMIUM_USERS = guardado; });

  it('sem a lista, ninguém tem cortesia', () => {
    delete process.env.PREMIUM_USERS;
    expect(temCortesia({ email: 'alguem@exemplo.com' })).toBe(false);
  });

  it('reconhece por e-mail e por id, sem ligar para maiúscula', () => {
    process.env.PREMIUM_USERS = ' Dono@Exemplo.com , u-123 ';
    expect(temCortesia({ email: 'dono@exemplo.com' })).toBe(true);
    expect(temCortesia({ id: 'u-123' })).toBe(true);
    expect(temCortesia({ email: 'outro@exemplo.com' })).toBe(false);
  });

  it('cortesia dá Premium, e ganha do teste e da falta de assinatura', () => {
    const d = direitosDe({ cortesia: true }, AGORA);
    expect(d.bancos).toBe(12);
    expect(d.whatsappPorMes).toBeNull();
    expect(noTeste({ cortesia: true, testeAte: DAQUI_A(3) }, AGORA)).toBe(false);
  });

  it('cortesia não expira com o teste vencido', () => {
    expect(direitosDe({ cortesia: true, testeAte: DAQUI_A(-30) }, AGORA).bancos).toBe(12);
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
