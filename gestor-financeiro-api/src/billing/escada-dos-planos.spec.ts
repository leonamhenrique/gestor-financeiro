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
function recortar(podeCobrar: boolean): Acao {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'temComoCobrar',
    'esc',
    'NOME_DA_COLUNA',
    'var ESCADA = ' + bloco(src, '{', 'var ESCADA =') + ';\n' +
      'return (' + funcao(src, 'acaoDoPlano') + ');',
  )(
    () => podeCobrar,
    (t: string) => t,
    { gratis: 'Grátis', pro: 'Pro', premium: 'Premium' },
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
