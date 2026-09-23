// ============================================================
// session-cookie.ts
// ============================================================
// Onde o refresh token mora quando o cliente é o app no navegador.
//
// Em JSON, o app teria de guardá-lo em localStorage — e qualquer script
// injetado na página (XSS) o levaria embora, com 30 dias de acesso à conta.
// Em cookie `httpOnly`, o JavaScript da página não consegue ler o token: o
// navegador só o envia de volta para /auth. Clientes que não são navegador
// (app nativo, integração) continuam recebendo o token no corpo.
//
// O app se identifica com o cabeçalho `X-Client: web`.
// ============================================================

import type { Request, Response } from 'express';
import { SESSAO_DIAS } from './auth.service';

export const COOKIE_SESSAO = 'gf_refresh';

export function clienteWeb(req: Request): boolean {
  return String(req.headers['x-client'] ?? '').toLowerCase() === 'web';
}

/** Lê um cookie do cabeçalho, sem depender de cookie-parser. */
export function lerCookie(req: Request, nome: string): string | undefined {
  const bruto = req.headers.cookie;
  if (!bruto) return undefined;
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Strict é o padrão: o navegador não manda o cookie numa requisição iniciada
 * por outro site, o que impede um site malicioso de renovar ou encerrar a
 * sessão de alguém "por baixo dos panos" (CSRF).
 *
 * Só que "outro site" aqui é outro domínio registrável: com o app em
 * gestor.pages.dev e a API em gestor.onrender.com, o próprio app vira "outro
 * site" e o cookie nunca chega — a sessão morre a cada recarga. Dois
 * caminhos: pôr os dois sob o mesmo domínio (app.seudominio.com e
 * api.seudominio.com continuam sendo o MESMO site), ou, quando isso não dá,
 * COOKIE_SAMESITE=none.
 *
 * Com `none`, o que segura o CSRF são duas outras travas que já existem: a
 * API só aceita renovar com o cabeçalho `X-Client: web`, e um cabeçalho fora
 * do comum obriga o navegador a pedir permissão antes (preflight), que o CORS
 * só dá para as origens listadas em CORS_ORIGINS. */
function politicaSameSite(): 'strict' | 'lax' | 'none' {
  const valor = (process.env.COOKIE_SAMESITE ?? 'strict').trim().toLowerCase();
  if (valor === 'strict' || valor === 'lax' || valor === 'none') return valor;
  throw new Error('COOKIE_SAMESITE precisa ser strict, lax ou none.');
}

function opcoes() {
  const sameSite = politicaSameSite();
  return {
    httpOnly: true,
    // Em produção só por HTTPS. Em desenvolvimento a API roda em http://localhost.
    // Com SameSite=None o navegador exige Secure — sem isso ele descarta o cookie.
    secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
    sameSite,
    // Só as rotas de sessão recebem o cookie; o resto da API usa o token curto.
    path: '/auth',
  };
}

export function gravarCookieSessao(res: Response, refreshToken: string) {
  res.cookie(COOKIE_SESSAO, refreshToken, { ...opcoes(), maxAge: SESSAO_DIAS * 24 * 60 * 60 * 1000 });
}

export function apagarCookieSessao(res: Response) {
  res.clearCookie(COOKIE_SESSAO, opcoes());
}
