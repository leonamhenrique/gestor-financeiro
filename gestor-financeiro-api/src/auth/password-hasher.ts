// ============================================================
// password-hasher.ts
// ============================================================
// Hash de senha com scrypt, que já vem no Node (`crypto`). Não precisa de
// dependência nativa para compilar (bcrypt/argon2 exigem toolchain no
// Windows e no build do container) e é uma função de derivação "cara em
// memória", recomendada pela OWASP para senha.
//
// Formato gravado:  scrypt$N$r$p$<salt base64>$<hash base64>
// Os parâmetros vão junto do hash. Assim, quando o custo subir no futuro, os
// hashes antigos continuam verificáveis e são refeitos no próximo login
// (`precisaRefazer`), sem migração em massa.
// ============================================================

import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

export interface ParametrosScrypt {
  N: number; // custo de CPU/memória (potência de 2)
  r: number; // tamanho do bloco
  p: number; // paralelismo
}

// N=2^15, r=8, p=1: ~32 MB e algumas dezenas de ms por senha. Caro o bastante
// para inviabilizar força bruta em massa, barato o bastante para um login.
export const PARAMETROS_PADRAO: ParametrosScrypt = { N: 32768, r: 8, p: 1 };

const TAMANHO_SAL = 16;
const TAMANHO_HASH = 64;

function derivar(senha: string, sal: Buffer, parametros: ParametrosScrypt): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      senha.normalize('NFKC'),
      sal,
      TAMANHO_HASH,
      // maxmem precisa passar de 128 * N * r, senão o Node recusa o custo.
      { N: parametros.N, r: parametros.r, p: parametros.p, maxmem: 256 * parametros.N * parametros.r },
      (erro, chave) => (erro ? reject(erro) : resolve(chave)),
    );
  });
}

@Injectable()
export class PasswordHasher {
  constructor(private readonly parametros: ParametrosScrypt = PARAMETROS_PADRAO) {}

  async gerar(senha: string): Promise<string> {
    const sal = randomBytes(TAMANHO_SAL);
    const hash = await derivar(senha, sal, this.parametros);
    const { N, r, p } = this.parametros;
    return ['scrypt', N, r, p, sal.toString('base64'), hash.toString('base64')].join('$');
  }

  /** Confere a senha contra o hash gravado. Hash mal formado nunca confere
   * (e nunca lança): para quem chama, é só "senha errada". */
  async conferir(senha: string, gravado: string): Promise<boolean> {
    const partes = String(gravado || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const [, N, r, p, salB64, hashB64] = partes;
    const parametros = { N: Number(N), r: Number(r), p: Number(p) };
    if (![parametros.N, parametros.r, parametros.p].every((n) => Number.isInteger(n) && n > 0)) return false;

    const esperado = Buffer.from(hashB64, 'base64');
    if (esperado.length !== TAMANHO_HASH) return false;
    try {
      const calculado = await derivar(senha, Buffer.from(salB64, 'base64'), parametros);
      // Comparação em tempo constante: não vaza quantos bytes bateram.
      return timingSafeEqual(calculado, esperado);
    } catch {
      return false;
    }
  }

  /** O hash foi feito com um custo diferente do atual e deve ser refeito
   * no próximo login bem-sucedido. */
  precisaRefazer(gravado: string): boolean {
    const partes = String(gravado || '').split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return true;
    return (
      Number(partes[1]) !== this.parametros.N ||
      Number(partes[2]) !== this.parametros.r ||
      Number(partes[3]) !== this.parametros.p
    );
  }
}
