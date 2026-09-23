import { createHash, randomBytes } from 'crypto';

/** Token opaco, imprevisível e seguro para URL (256 bits de aleatoriedade). */
export function gerarTokenOpaco(): string {
  return randomBytes(32).toString('base64url');
}

/** O que vai para o banco no lugar do token. Token de 256 bits aleatórios não
 * precisa de sal nem de função lenta: não dá para adivinhar por dicionário. */
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
