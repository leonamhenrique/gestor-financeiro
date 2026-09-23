import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { COOKIE_SESSAO, lerCookie } from './session-cookie';

function resposta() {
  const cookies: Record<string, { valor: string; opcoes: any }> = {};
  const apagados: string[] = [];
  return {
    cookies,
    apagados,
    cookie: (nome: string, valor: string, opcoes: any) => (cookies[nome] = { valor, opcoes }),
    clearCookie: (nome: string) => apagados.push(nome),
  } as any;
}

const sessao = {
  accessToken: 'acesso',
  refreshToken: 'r'.repeat(43),
  expiresIn: 900,
  user: { id: 'u1', name: 'Ana', email: 'ana@ex.com' },
};

describe('AuthController — entrega da sessão', () => {
  let auth: any;
  let controller: AuthController;

  beforeEach(() => {
    auth = {
      login: jest.fn().mockResolvedValue(sessao),
      register: jest.fn().mockResolvedValue(sessao),
      refresh: jest.fn().mockResolvedValue({ ...sessao, refreshToken: 'n'.repeat(43) }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AuthController(auth);
  });

  const web = (cookie?: string) => ({ headers: { 'x-client': 'web', ...(cookie ? { cookie } : {}) } }) as any;
  const nativo = { headers: {} } as any;

  it('navegador: refresh token vai para cookie httpOnly e SAI do corpo', async () => {
    const res = resposta();
    const corpo: any = await controller.login(web(), res, { email: 'ana@ex.com', password: 'x' });
    expect(corpo).not.toHaveProperty('refreshToken');
    expect(corpo.accessToken).toBe('acesso');
    expect(res.cookies[COOKIE_SESSAO].valor).toBe(sessao.refreshToken);
    expect(res.cookies[COOKIE_SESSAO].opcoes).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/auth' });
  });

  it('cliente que não é navegador continua recebendo o token no corpo, sem cookie', async () => {
    const res = resposta();
    const corpo: any = await controller.login(nativo, res, { email: 'ana@ex.com', password: 'x' });
    expect(corpo.refreshToken).toBe(sessao.refreshToken);
    expect(res.cookies[COOKIE_SESSAO]).toBeUndefined();
  });

  it('renovar no navegador usa o cookie e grava o token novo', async () => {
    const res = resposta();
    await controller.refresh(web(`outro=1; ${COOKIE_SESSAO}=${sessao.refreshToken}`), res, {});
    expect(auth.refresh).toHaveBeenCalledWith(sessao.refreshToken);
    expect(res.cookies[COOKIE_SESSAO].valor).toBe('n'.repeat(43));
  });

  it('renovar sem token nenhum é 401, sem chegar ao serviço', async () => {
    await expect(controller.refresh(web(), resposta(), {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('renovação recusada apaga o cookie, para não insistir a cada requisição', async () => {
    auth.refresh.mockRejectedValue(new UnauthorizedException());
    const res = resposta();
    await expect(controller.refresh(web(`${COOKIE_SESSAO}=${sessao.refreshToken}`), res, {})).rejects.toBeDefined();
    expect(res.apagados).toContain(COOKIE_SESSAO);
  });

  it('sair encerra a sessão do cookie e apaga o cookie', async () => {
    const res = resposta();
    await controller.logout(web(`${COOKIE_SESSAO}=${sessao.refreshToken}`), res, {});
    expect(auth.logout).toHaveBeenCalledWith(sessao.refreshToken);
    expect(res.apagados).toContain(COOKIE_SESSAO);
  });

  it('lerCookie lida com vários cookies, espaços e valor codificado', () => {
    const req = { headers: { cookie: ` a=1 ;  ${COOKIE_SESSAO}=abc%2Fdef ; b=2` } } as any;
    expect(lerCookie(req, COOKIE_SESSAO)).toBe('abc/def');
    expect(lerCookie(req, 'nao-existe')).toBeUndefined();
    expect(lerCookie({ headers: {} } as any, COOKIE_SESSAO)).toBeUndefined();
  });
});
