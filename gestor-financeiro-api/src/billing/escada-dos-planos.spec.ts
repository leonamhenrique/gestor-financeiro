// ============================================================
// escada-dos-planos.spec.ts
// ============================================================
// Quem está no teste PRECISA conseguir assinar antes do prazo acabar.
//
// Medido em produção: na tela de Planos de uma conta em teste não havia
// botão nenhum. Duas causas somadas. O único botão de assinar vivia no
// rodapé do `dialog`, e o `dialog` inteiro é que rola (só o cabeçalho é
// `sticky`) — o botão nascia três blocos abaixo da dobra. E a tela marcava
// o Pro como "seu plano", o que convida a não procurar como pagá-lo.
//
// O botão agora mora no bloco de cada plano, e quem decide onde ele aparece
// é `acaoDoPlano`. A regra tem um detalhe que erra fácil: NO TESTE o Pro não
// é seu, é emprestado — tratar o teste como "já tem Pro" apaga exatamente o
// botão de quem mais precisa dele. Este teste recorta a função de verdade do
// `web/home.html` e prova a escada inteira.
// ============================================================

import { scriptDoApp, funcao, bloco } from '../../scripts/recorte';

const src = scriptDoApp();

type Acao = (coluna: string, meu: string) => string;

/** A função do app, com o que ela usa de fora. `temComoCobrar` entra como
 * interruptor para provar os dois lados sem inventar uma segunda versão. */
function recortar(podeCobrar: boolean, plano: any = null): Acao {
  const fmtDataBR = (iso: string) => {
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  };
  const isoDate = (d: Date) =>
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'temComoCobrar',
    'esc',
    'NOME_DA_COLUNA',
    'planoAtual',
    'fmtDataBR',
    'isoDate',
    'var ESCADA = ' + bloco(src, '{', 'var ESCADA =') + ';\n' +
      funcao(src, 'ofertaDoTeste') + '\n' +
      'return (' + funcao(src, 'acaoDoPlano') + ');',
  )(
    () => podeCobrar,
    (t: string) => t,
    { gratis: 'Grátis', pro: 'Pro', premium: 'Premium' },
    plano,
    fmtDataBR,
    isoDate,
  );
}

const temBotao = (html: string) => /data-assinar-coluna/.test(html);

describe('o botão de assinar, no bloco do plano', () => {
  const acao = recortar(true);

  it('no teste, o Pro é emprestado: os dois pagos ganham botão', () => {
    // `meu` é "gratis" durante o teste — é `desenharPlanos` quem rebaixa.
    expect(temBotao(acao('pro', 'gratis'))).toBe(true);
    expect(temBotao(acao('premium', 'gratis'))).toBe(true);
  });

  it('o grátis nunca ganha botão: não se assina o que já é de graça', () => {
    expect(temBotao(acao('gratis', 'gratis'))).toBe(false);
  });

  it('quem paga o Pro só vê o Premium', () => {
    expect(temBotao(acao('pro', 'pro'))).toBe(false);
    expect(temBotao(acao('premium', 'pro'))).toBe(true);
  });

  it('quem paga o Premium não vê botão nenhum', () => {
    expect(temBotao(acao('pro', 'premium'))).toBe(false);
    expect(temBotao(acao('premium', 'premium'))).toBe(false);
  });

  it('sem gateway, nenhum botão — prometer um clique que falha é pior', () => {
    const semCobranca = recortar(false);
    expect(temBotao(semCobranca('pro', 'gratis'))).toBe(false);
    expect(temBotao(semCobranca('premium', 'gratis'))).toBe(false);
  });

  it('o botão diz QUAL plano, porque há três blocos na tela', () => {
    expect(acao('pro', 'gratis')).toContain('Assinar o Pro');
    expect(acao('premium', 'gratis')).toContain('Assinar o Premium');
  });
});

describe('o teste não se chama "seu plano"', () => {
  it('a etiqueta do bloco atual muda de palavra quando emTeste', () => {
    const desenho = funcao(src, 'desenharPlanos');
    expect(desenho).toContain('planoAtual.emTeste ? "gratis" : planoAtual.coluna');
    expect(desenho).toContain('"no teste"');
  });
});

/* Sem esta frase, o conselho racional para quem está no teste é esperar o
 * último dia — e o último dia é quando a pessoa esquece. O servidor já marca
 * o primeiro débito para o fim do teste; faltava dizer isso ao lado do
 * botão. */
describe('assinar no meio do teste não custa os dias que faltam', () => {
  /* A frase é UMA, no topo do corpo, e não uma por bloco: ela é sobre o
   * TESTE, não sobre um plano, e repetida embaixo de cada botão viravam
   * duas cópias da mesma linha na mesma tela. */
  const oferta = (podeCobrar: boolean, plano: any): string =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(
      'temComoCobrar',
      'esc',
      'planoAtual',
      'fmtDataBR',
      'isoDate',
      'return (' + funcao(src, 'ofertaDoTeste') + ')();',
    )(
      () => podeCobrar,
      (t: string) => t,
      plano,
      (iso: string) => {
        const p = iso.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
      },
      (d: Date) =>
        d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0'),
    );

  it('a frase traz a data do primeiro débito, contada do fim do teste', () => {
    const esperado = new Date();
    esperado.setDate(esperado.getDate() + 27);
    const dd = String(esperado.getDate()).padStart(2, '0');
    const mm = String(esperado.getMonth() + 1).padStart(2, '0');

    const html = oferta(true, { emTeste: true, diasDeTeste: 27 });
    expect(html).toContain('não perde os dias que faltam');
    expect(html).toContain(dd + '/' + mm + '/' + esperado.getFullYear());
  });

  it('fora do teste, nenhuma promessa de data', () => {
    expect(oferta(true, { emTeste: false, diasDeTeste: 0, coluna: 'pro' })).toBe('');
  });

  it('sem plano lido do servidor, a frase some em vez de inventar data', () => {
    expect(oferta(true, null)).toBe('');
  });

  /* Sem gateway não há o que oferecer: prometer um débito futuro para um
   * botão que não existe é pior do que ficar calado. */
  it('sem gateway, a oferta some junto com o botão', () => {
    expect(oferta(false, { emTeste: true, diasDeTeste: 27 })).toBe('');
  });

  it('o botão não carrega mais a frase: ela é uma só, no topo', () => {
    const acao = recortar(true, { emTeste: true, diasDeTeste: 27 });
    expect(acao('pro', 'gratis')).not.toContain('primeiro débito');
    expect(acao('pro', 'gratis')).toContain('Assinar o Pro');
  });

  it('o corpo monta a oferta ANTES dos blocos', () => {
    expect(funcao(src, 'desenharPlanos')).toContain('ofertaDoTeste() + planoAtual.tabela.map');
  });
});

/* O app da Play é um TWA, e TWA é Android. Exigir as duas coisas fechou um
 * falso positivo de desktop em que o botão de assinar sumia JUNTO com a
 * frase que explica a falta — a tela de Planos ficava sem caminho para
 * pagar e sem dizer por quê, que foi como o usuário a encontrou. */
describe('o detector do app da Play', () => {
  const fonte = funcao(src, 'dentroDoAppDaPlay');

  const dentro = (temApi: boolean, ua: string) =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(
      'window',
      'navigator',
      'return (' + fonte + ')();',
    )(
      { getDigitalGoodsService: temApi ? () => undefined : undefined },
      { userAgent: ua },
    );

  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131 Mobile Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36';

  it('dentro do TWA da Play: tem a API E é Android', () => {
    expect(dentro(true, ANDROID)).toBe(true);
  });

  it('desktop com a API exposta NÃO é a Play', () => {
    expect(dentro(true, WINDOWS)).toBe(false);
  });

  it('Android sem a API é navegador comum', () => {
    expect(dentro(false, ANDROID)).toBe(false);
  });
});
