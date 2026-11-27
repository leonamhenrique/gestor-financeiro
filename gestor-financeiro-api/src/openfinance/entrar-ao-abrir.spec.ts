// ============================================================
// entrar-ao-abrir.spec.ts
// ============================================================
// O que não tem dúvida passou a entrar ao abrir o APP, e não ao abrir a
// tela de Importar — assim a fatura do cartão já está em dia para quem vai
// direto para ela.
//
// O PERIGO AQUI É PREÇO, não correção. Sincronizar custa baixar o extrato
// inteiro do provedor: centenas de transações, medido. Foi por isso que a
// contagem virou um trabalho diário em vez de uma consulta por abertura.
// Se esta função pedir ao provedor quando não devia, o app passa a pagar
// esse preço em toda abertura — e o sintoma é mudo: tudo continua certo,
// só mais caro e mais lento.
//
// Então os testes vigiam, acima de tudo, QUANDO ela fala com o provedor.
// A função é recortada do próprio `web/home.html`.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

interface Cenario {
  /** Quantos pendentes o nosso banco diz que existem. */
  pendentes: number;
  /** O dia já marcado no aparelho, ou nada. */
  diaMarcado?: string | null;
  /** As conexões, ou um erro para imitar o 404 de quem não tem a função. */
  conexoes?: any[] | Error;
  modoApi?: boolean;
}

interface Resultado {
  contou: number;
  pediuConexoes: boolean;
  buscou: boolean;
  caladoDurante: boolean | null;
  diaGravado: string | null;
}

const HOJE = '2026-11-26';

async function rodar(c: Cenario): Promise<Resultado> {
  const r: Resultado = {
    contou: 0,
    pediuConexoes: false,
    buscou: false,
    caladoDurante: null,
    diaGravado: c.diaMarcado ?? null,
  };

  /* `ofCalado` é uma variável DA função recortada, e o dublê precisa lê-la
   * no instante em que roda. A ponte é criada lá dentro e usada aqui. */
  const ponte: { lerCalado?: () => boolean } = {};

  const ambiente: Record<string, unknown> = {
    MODO_API: c.modoApi !== false,
    isoDate: () => HOJE,
    localStorage: {
      getItem: () => r.diaGravado,
      setItem: (_k: string, v: string) => {
        r.diaGravado = v;
      },
    },
    of: { conexoes: [] as any[], fontes: [] as any[] },
    ofContarPendentes: async () => {
      r.contou++;
      return c.pendentes;
    },
    api: async (caminho: string) => {
      if (caminho !== '/openfinance/connections') throw new Error('rota inesperada: ' + caminho);
      r.pediuConexoes = true;
      if (c.conexoes instanceof Error) throw c.conexoes;
      return c.conexoes ?? [];
    },
    ofBuscarSozinho: async () => {
      r.buscou = true;
      r.caladoDurante = !!ponte.lerCalado?.();
    },
    ponte,
  };

  const nomes = Object.keys(ambiente);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fabricar = new Function(
    ...nomes,
    [
      'var ofCalado = false;',
      'var CHAVE_DIA_AUTOMATICO = "x";',
      'ponte.lerCalado = function () { return ofCalado; };',
      funcao(src, 'ofEntrarSozinhoAoAbrir'),
      'return ofEntrarSozinhoAoAbrir;',
    ].join('\n'),
  );
  await fabricar(...nomes.map((n) => ambiente[n]))();
  return r;
}

describe('a passada da abertura do app', () => {
  it('sem pendente, não fala com o provedor — só conta', async () => {
    const r = await rodar({ pendentes: 0 });
    expect(r.contou).toBe(1);
    expect(r.pediuConexoes).toBe(false);
    expect(r.buscou).toBe(false);
  });

  /* O número do item Importar sai dessa contagem. Se o porteiro do dia
   * viesse antes dela, o numero sumiria da segunda abertura em diante — foi
   * um defeito de verdade, achado antes de subir. */
  it('conta SEMPRE, mesmo com o dia já feito', async () => {
    const r = await rodar({ pendentes: 4, diaMarcado: HOJE });
    expect(r.contou).toBe(1);
    expect(r.pediuConexoes).toBe(false);
    expect(r.buscou).toBe(false);
  });

  it('com pendente e dia novo, busca uma vez e marca o dia', async () => {
    const r = await rodar({ pendentes: 4, conexoes: [{ id: 'cx1' }] });
    expect(r.pediuConexoes).toBe(true);
    expect(r.buscou).toBe(true);
    expect(r.diaGravado).toBe(HOJE);
  });

  it('a passada é calada: nenhum aviso cai em cima de outra tela', async () => {
    const r = await rodar({ pendentes: 4, conexoes: [{ id: 'cx1' }] });
    expect(r.caladoDurante).toBe(true);
  });

  /* 404 é a resposta de quem não tem a integração — a maioria das contas.
   * Não pode virar erro nem marcar o dia como gasto. */
  it('sem Open Finance, para no 404 e não busca', async () => {
    const r = await rodar({ pendentes: 4, conexoes: new Error('Not Found') });
    expect(r.pediuConexoes).toBe(true);
    expect(r.buscou).toBe(false);
    expect(r.diaGravado).toBe(null);
  });

  it('com a integração ligada mas nenhuma conexão, também não busca', async () => {
    const r = await rodar({ pendentes: 4, conexoes: [] });
    expect(r.buscou).toBe(false);
    expect(r.diaGravado).toBe(null);
  });

  it('sem servidor, não faz nada', async () => {
    const r = await rodar({ pendentes: 9, modoApi: false });
    expect(r.contou).toBe(0);
    expect(r.pediuConexoes).toBe(false);
  });

  /* A marca é gravada ANTES de buscar, de propósito: provedor fora do ar
   * custa o dia, mas não vira uma busca a cada abertura. */
  it('o dia é marcado antes da busca, não depois', async () => {
    const fonte = funcao(src, 'ofEntrarSozinhoAoAbrir');
    expect(fonte.indexOf('setItem')).toBeLessThan(fonte.indexOf('ofBuscarSozinho()'));
  });
});

describe('o silêncio alcança quem avisaria', () => {
  it('o erro do provedor não grita durante a passada calada', () => {
    expect(funcao(src, 'ofPerguntar')).toContain('if (!ofCalado) avisar(');
  });

  it('na passada calada, nada de buscar de novo só para repintar', () => {
    expect(funcao(src, 'ofBuscarSozinho')).toContain('if (ofCalado) return;');
  });

  /* O aviso "entraram sozinhos" aponta para o Desfazer, que só está à vista
   * na tela de Importar. Por isso ele fica DEPOIS do corte. */
  it('o aviso de lote fica depois do corte, e some na abertura do app', () => {
    const fonte = funcao(src, 'ofBuscarSozinho');
    expect(fonte.indexOf('if (ofCalado) return;')).toBeLessThan(
      fonte.indexOf('entraram sozinhos'),
    );
  });
});
