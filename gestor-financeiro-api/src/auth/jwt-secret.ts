import { Logger } from '@nestjs/common';

const INSEGUROS = new Set(['', 'change-me', 'secret', 'changeme']);

/** Segredo que assina os tokens de acesso. Com o valor de exemplo, qualquer
 * pessoa consegue forjar um token e entrar como qualquer usuário — por isso,
 * em produção, a API se recusa a subir com segredo ausente, conhecido ou curto.
 * Fora de produção só avisa, para não travar o desenvolvimento. */
export function segredoJwt(): string {
  const segredo = process.env.JWT_SECRET ?? '';
  const fraco = INSEGUROS.has(segredo) || segredo.length < 32;
  if (fraco) {
    const mensagem =
      'JWT_SECRET ausente, de exemplo ou com menos de 32 caracteres. ' +
      'Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"';
    if (process.env.NODE_ENV === 'production') throw new Error(mensagem);
    new Logger('Auth').warn(mensagem);
  }
  return segredo || 'dev-only-insecure-secret-change-me';
}
