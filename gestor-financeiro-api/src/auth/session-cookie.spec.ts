import { COOKIE_SESSAO, gravarCookieSessao } from './session-cookie';

function opcoesGravadas(env: Record<string, string | undefined>) {
  const antes = { ...process.env };
  // Atribuir `undefined` a process.env grava a string "undefined": para
  // testar "não definida" é preciso apagar a chave.
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const res: any = { cookie: jest.fn() };
  try {
    gravarCookieSessao(res, 'token-de-teste');
  } finally {
    process.env = antes;
  }
  return res.cookie.mock.calls[0];
}

describe('cookie de sessão', () => {
  it('padrão: strict, httpOnly, só em /auth', () => {
    const [nome, valor, o] = opcoesGravadas({ COOKIE_SAMESITE: undefined, NODE_ENV: 'development' });
    expect([nome, valor]).toEqual([COOKIE_SESSAO, 'token-de-teste']);
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/auth', secure: false });
  });

  it('em produção exige HTTPS', () => {
    const [, , o] = opcoesGravadas({ COOKIE_SAMESITE: undefined, NODE_ENV: 'production' });
    expect(o.secure).toBe(true);
  });

  // App e API em domínios diferentes: sem none o navegador não manda o cookie.
  it('COOKIE_SAMESITE=none implica Secure mesmo fora de produção', () => {
    const [, , o] = opcoesGravadas({ COOKIE_SAMESITE: 'None', NODE_ENV: 'development' });
    expect(o).toMatchObject({ sameSite: 'none', secure: true });
  });

  it('valor inválido falha na hora, em vez de virar um cookie sem proteção', () => {
    expect(() => opcoesGravadas({ COOKIE_SAMESITE: 'qualquer' })).toThrow(/strict, lax ou none/);
  });
});
