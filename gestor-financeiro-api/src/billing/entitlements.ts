// ============================================================
// entitlements.ts — o que cada plano dá
// ============================================================
// UMA tabela, lida pelo servidor e devolvida para a tela. Espalhar "se for
// free então 1 conta" pelos serviços faria a regra existir em sete lugares e
// divergir no primeiro ajuste de preço.
//
// O QUE ESTE ARQUIVO NÃO FAZ
// Não apaga nem esconde nada. Limite é sobre CRIAR: quem já tem cinco contas
// e cai para o grátis continua com as cinco, vendo e editando todas — o que
// ele não pode é criar a sexta. Tirar acesso a dado que a pessoa registrou
// seria cobrar com o dado dela como refém.
//
// O TESTE DE 7 DIAS
// Enquanto corre, o grátis tem os direitos do Pro, com UMA diferença: a
// busca no banco traz 1 mês, e não 12. O teste é para experimentar, e doze
// meses de histórico é o trabalho que o Pro compra.
// ============================================================

/** `null` quer dizer SEM limite. Zero quer dizer que o plano não tem aquilo. */
export interface Direitos {
  /** Quantas contas bancárias dá para criar. */
  contas: number | null;
  /** Quantos cartões. */
  cartoes: number | null;
  /** Quantos objetivos de poupança. */
  objetivos: number | null;
  /** Quantos bancos ligados por Open Finance ao mesmo tempo. */
  bancos: number;
  /** Quantos meses de histórico a busca no banco oferece. Vale em TODA
   * busca, e não só na primeira: é o que o plano alcança, não uma cortesia
   * de estreia. */
  mesesDeHistorico: number;
  /** Mensagens de WhatsApp por mês. */
  whatsappPorMes: number | null;
  /** O planejamento vale só para o mês em foco, ou para qualquer mês. */
  planejamentoCompleto: boolean;
  /** Quantos meses o relatório de categorias alcança. */
  relatorioMeses: number;
  /** O fluxo de caixa do ano inteiro. */
  fluxoDeCaixa: boolean;
  /** Dividir despesa com outras pessoas. */
  compartilhadas: boolean;
  /** Avisos de que há lançamento esperando conferência. */
  avisos: boolean;
  /** O link público de leitura. */
  compartilharPorLink: boolean;
}

/* CADASTRO É LIVRE no pago. O teto de 5 e de 12 é de CONEXÃO de Open
 * Finance, que é o que custa por uso — banco cadastrado à mão, para lançar
 * sem integração, não custa nada e não se limita. */
const PRO: Direitos = {
  contas: null,
  cartoes: null,
  objetivos: null,
  bancos: 5,
  mesesDeHistorico: 12,
  whatsappPorMes: 100,
  planejamentoCompleto: true,
  relatorioMeses: 12,
  fluxoDeCaixa: true,
  compartilhadas: true,
  avisos: true,
  compartilharPorLink: true,
};

/* O Premium se separa do Pro pelo que custa por uso: mais conexões e
 * mensagem sem teto. O cadastro já era livre nos dois. */
const PREMIUM: Direitos = {
  ...PRO,
  bancos: 12,
  whatsappPorMes: null,
};

/* O grátis DEPOIS do teste. Um de cada, e nenhuma função que custe dinheiro
 * por uso: cada consentimento de Open Finance é cobrado na nossa conta do
 * provedor todo mês, e conta que nunca paga não pode gerar custo recorrente. */
const GRATIS: Direitos = {
  contas: 1,
  cartoes: 1,
  objetivos: 1,
  bancos: 0,
  mesesDeHistorico: 0,
  whatsappPorMes: 0,
  planejamentoCompleto: false,
  relatorioMeses: 1,
  fluxoDeCaixa: false,
  compartilhadas: false,
  avisos: false,
  compartilharPorLink: false,
};

/* O grátis DURANTE os 7 dias: o Pro inteiro, menos o histórico longo. */
const TESTE: Direitos = { ...PRO, bancos: 1, mesesDeHistorico: 1 };

/**
 * A tabela inteira, para a tela de planos.
 *
 * Vai daqui para o cliente em vez de ser reescrita lá: duas cópias da mesma
 * tabela divergem no primeiro ajuste, e aí a tela promete o que o servidor
 * não dá. A tela só traduz número em frase.
 */
export const TABELA_DE_PLANOS: Array<{ plano: 'gratis' | 'pro' | 'premium'; direitos: Direitos }> = [
  { plano: 'gratis', direitos: GRATIS },
  { plano: 'pro', direitos: PRO },
  { plano: 'premium', direitos: PREMIUM },
];

/** Em qual coluna da tabela este estado cai. */
export function colunaDoPlano(estado: EstadoDoPlano, agora: Date = new Date()): 'gratis' | 'pro' | 'premium' {
  const d = direitosDe(estado, agora);
  if (d === PREMIUM) return 'premium';
  if (d === PRO) return 'pro';
  /* O teste mostra a coluna do Pro acesa: é o que a pessoa está usando, e é
   * o plano que ela mantém se assinar. */
  if (d === TESTE) return 'pro';
  return 'gratis';
}

/** Os códigos que valem como Pro e como Premium, mensal ou anual. */
const POR_CODIGO: Record<string, Direitos> = {
  'pro-mensal': PRO,
  'pro-anual': PRO,
  'premium-mensal': PREMIUM,
  'premium-anual': PREMIUM,
};

export interface EstadoDoPlano {
  /** Premium de cortesia, pela lista do painel. Ver `quemTemCortesia`. */
  cortesia?: boolean;
  /** O `code` do plano assinado, ou nulo para quem nunca assinou. */
  codigo?: string | null;
  /** Se a assinatura dá acesso agora (paga, em cortesia de cancelamento…). */
  liberada?: boolean;
  /** Quando o teste de 7 dias acaba. Nulo para quem não tem teste. */
  testeAte?: Date | null;
}

/**
 * Os direitos de quem está neste estado, agora.
 *
 * A ordem das perguntas é a regra:
 *
 * 1. assinatura paga e liberada manda, sempre — quem paga Premium no quinto
 *    dia de teste não pode receber os direitos do teste;
 * 2. teste correndo vem depois;
 * 3. e o chão é o grátis.
 *
 * Plano desconhecido cai no GRÁTIS de propósito: um código novo no banco que
 * o código ainda não conhece não pode virar acesso total por omissão.
 */
export function direitosDe(estado: EstadoDoPlano, agora: Date = new Date()): Direitos {
  /* A cortesia vem primeiro e não expira: é a conta de quem mantém o app, e
   * ela não pode perder função no oitavo dia por não ter passado pelo
   * checkout. Não é assinatura — não gera cobrança, fatura nem cancelamento,
   * e some tirando o e-mail da lista. */
  if (estado.cortesia) return PREMIUM;
  if (estado.liberada && estado.codigo && POR_CODIGO[estado.codigo]) {
    return POR_CODIGO[estado.codigo];
  }
  if (estado.testeAte && estado.testeAte.getTime() > agora.getTime()) return TESTE;
  return GRATIS;
}

/** O teste está correndo? A tela mostra quantos dias faltam. */
export function noTeste(estado: EstadoDoPlano, agora: Date = new Date()): boolean {
  if (estado.cortesia) return false;
  if (estado.liberada && estado.codigo && POR_CODIGO[estado.codigo]) return false;
  return !!estado.testeAte && estado.testeAte.getTime() > agora.getTime();
}

/** Quantos dias de teste faltam, arredondando para cima. Zero quando acabou. */
export function diasDeTeste(estado: EstadoDoPlano, agora: Date = new Date()): number {
  if (!noTeste(estado, agora)) return 0;
  const ms = estado.testeAte!.getTime() - agora.getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

/** Quantos dias o teste dura, contados do cadastro. */
export const DIAS_DE_TESTE = 7;

/**
 * Quem tem Premium de cortesia: ids ou e-mails, separados por vírgula, na
 * variável `PREMIUM_USERS`.
 *
 * Mesma forma da lista do Open Finance, e pelo mesmo motivo: quem configura
 * sabe o próprio e-mail e não sabe o próprio id. Fica no painel, e não no
 * código, para ligar e desligar sem deploy e para nenhum e-mail acabar
 * versionado num repositório público.
 *
 * Lista VAZIA quer dizer "ninguém" — ao contrário da do Open Finance, onde
 * vazia quer dizer "todo mundo". A diferença é de propósito: lá a lista
 * RESTRINGE quem enxerga; aqui ela CONCEDE acesso pago. Um default que
 * conceda a todos seria dar o app de graça por esquecimento.
 */
export function quemTemCortesia(): string[] {
  return (process.env.PREMIUM_USERS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/** Este usuário está na lista? */
export function temCortesia(usuario: { id?: string | null; email?: string | null }): boolean {
  const lista = quemTemCortesia();
  if (!lista.length) return false;
  return [usuario.id, usuario.email]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase())
    .some((x) => lista.includes(x));
}

/**
 * Cabe mais um?
 *
 * `null` é sem limite. O `quantos` é o que a pessoa JÁ tem — e a comparação é
 * `>=` porque quem tem o limite cheio não cria mais um.
 */
export function cabeMais(limite: number | null, quantos: number): boolean {
  if (limite === null) return true;
  return quantos < limite;
}
