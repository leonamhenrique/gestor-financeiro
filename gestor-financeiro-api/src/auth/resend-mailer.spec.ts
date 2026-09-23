import { ResendMailer } from './resend-mailer';
import { REDEFINICAO_MINUTOS } from './auth.service';

const LINK = 'https://gestor-financeiro.pages.dev/?token=abc123';

function comAmbiente(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const antes = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    process.env = antes;
  }
}

describe('ResendMailer', () => {
  const OK = { ok: true, status: 200, text: async () => '' };

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('falha na criação quando a chave ou o remetente não estão configurados', () => {
    comAmbiente({ RESEND_API_KEY: undefined, MAIL_FROM: 'a@b.com' }, () => {
      expect(() => new ResendMailer()).toThrow(/RESEND_API_KEY/);
    });
    comAmbiente({ RESEND_API_KEY: 're_123', MAIL_FROM: undefined }, () => {
      expect(() => new ResendMailer()).toThrow(/MAIL_FROM/);
    });
  });

  it('envia com a chave no cabeçalho e o link no corpo', async () => {
    const fetchFalso = jest.fn().mockResolvedValue(OK);
    (global as any).fetch = fetchFalso;

    await comAmbiente({ RESEND_API_KEY: 're_segredo', MAIL_FROM: 'Gestor <nao-responda@ex.com>' }, async () => {
      await new ResendMailer().enviarRedefinicaoDeSenha({ email: 'ana@ex.com', nome: 'Ana' }, LINK);
    });

    const [url, opcoes] = fetchFalso.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opcoes.headers.Authorization).toBe('Bearer re_segredo');
    const corpo = JSON.parse(opcoes.body);
    expect(corpo).toMatchObject({ from: 'Gestor <nao-responda@ex.com>', to: ['ana@ex.com'] });
    expect(corpo.text).toContain(LINK);
    expect(corpo.html).toContain(LINK);
    expect(corpo.text).toContain(`${REDEFINICAO_MINUTOS} minutos`);
    // Nome vai no texto; e o HTML não carrega imagem nem script de rastreio.
    expect(corpo.text).toContain('Ana');
    expect(corpo.html).not.toMatch(/<img|<script/i);
  });

  it('erro do Resend vira exceção com o motivo, para o log', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => '{"message":"domain is not verified"}',
    });
    await expect(
      comAmbiente({ RESEND_API_KEY: 're_123', MAIL_FROM: 'a@b.com' }, () =>
        new ResendMailer().enviarRedefinicaoDeSenha({ email: 'ana@ex.com', nome: 'Ana' }, LINK),
      ) as Promise<void>,
    ).rejects.toThrow(/403.*domain is not verified/);
  });

  it('escapa o que vem do usuário no HTML', async () => {
    const fetchFalso = jest.fn().mockResolvedValue(OK);
    (global as any).fetch = fetchFalso;
    await comAmbiente({ RESEND_API_KEY: 're_123', MAIL_FROM: 'a@b.com' }, async () => {
      await new ResendMailer().enviarRedefinicaoDeSenha({ email: 'ana@ex.com', nome: '<script>x</script>' }, LINK);
    });
    const corpo = JSON.parse(fetchFalso.mock.calls[0][1].body);
    expect(corpo.html).toContain('&lt;script&gt;');
    expect(corpo.html).not.toContain('<script>');
  });
});
