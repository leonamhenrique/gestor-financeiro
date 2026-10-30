// ============================================================
// telefone.ts
// ============================================================
// Como o número de quem manda a mensagem entra no banco — que é: não entra.
// ============================================================

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Só os dígitos, como o WhatsApp manda (E.164 sem o "+"): 5531988887777.
 *
 * Normalizar é obrigatório antes de comparar: o mesmo número escrito
 * "+55 31 98888-7777" e "5531988887777" tem de achar o mesmo dono, senão a
 * pessoa parearia uma vez e seria estranha na mensagem seguinte. */
export function normalizarTelefone(bruto: string): string {
  return String(bruto || '').replace(/\D/g, '');
}

/**
 * O que vai para a coluna no lugar do telefone.
 *
 * HMAC, e não SHA-256 puro como nos tokens: telefone tem pouca entropia. Um
 * celular brasileiro cabe em cerca de 10^11 possibilidades, e varrer isso
 * contra um hash simples é trabalho de minutos numa placa de vídeo — o banco
 * vazado entregaria a lista de números. Com um segredo que só o servidor tem,
 * não entrega.
 *
 * Sem `WHATSAPP_PHONE_PEPPER` definido, isto ESTOURA em vez de cair num
 * padrão: um padrão aqui seria guardar números recuperáveis sem ninguém
 * perceber, e a falha ficaria escondida até o dia do vazamento.
 */
export function hashDoTelefone(telefone: string): string {
  const segredo = process.env.WHATSAPP_PHONE_PEPPER;
  if (!segredo || segredo.length < 16) {
    throw new Error(
      'WHATSAPP_PHONE_PEPPER ausente ou curto: sem ele o telefone ficaria recuperável no banco.',
    );
  }
  return createHmac('sha256', segredo).update(normalizarTelefone(telefone)).digest('hex');
}

/** Os quatro últimos dígitos, que é o que a tela mostra. */
export function ultimos4(telefone: string): string {
  return normalizarTelefone(telefone).slice(-4);
}

/* Alfabeto sem as letras que se confundem com números na hora de ler em voz
 * alta ou de digitar: sem O, I, L, U, nem 0 e 1. O código passa pelos olhos
 * de alguém antes de virar mensagem. */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const TAMANHO = 8;

/** O código do pareamento, em claro. Ele aparece uma vez só, na resposta que
 * o criou — depois existe apenas o hash.
 *
 * Oito caracteres de um alfabeto de 30 dão ~6,5 × 10^11 combinações. Seis
 * dígitos (10^6) seriam curtos demais para uma porta que atende qualquer
 * número do mundo sem autenticação. */
export function gerarCodigo(): string {
  const bytes = randomBytes(TAMANHO);
  let saida = '';
  for (let i = 0; i < TAMANHO; i++) saida += ALFABETO[bytes[i] % ALFABETO.length];
  return saida;
}

/** O código como ele chega da mensagem pode vir com espaço, hífen e em
 * minúscula: "saldo-k7p2 m9qx". O que importa são os caracteres do alfabeto. */
export function normalizarCodigo(bruto: string): string {
  return String(bruto || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^SALDO/, '');
}

export function hashDoCodigo(codigo: string): string {
  return createHash('sha256').update(normalizarCodigo(codigo)).digest('hex');
}

/** Comparação de hashes em tempo constante.
 *
 * O banco acha o pareamento pelo hash — e isso já é uma busca por igualdade,
 * feita pelo índice. Esta função existe para a comparação que acontece DEPOIS,
 * quando um pareamento é conferido contra um código vindo de fora. */
export function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Onde o código aparece na mensagem que a pessoa manda. O texto inteiro é
 * sugerido pelo app; aqui só se extrai o que importa dele. */
export function codigoNaMensagem(texto: string): string | null {
  const m = String(texto || '')
    .toUpperCase()
    .match(/SALDO[\s-]*([0-9A-Z][\s-]*){8}/);
  if (!m) return null;
  const codigo = normalizarCodigo(m[0]);
  return codigo.length === TAMANHO ? codigo : null;
}
