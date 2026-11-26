// ============================================================
// camadas-do-app.spec.ts
// ============================================================
// As telas abertas pelo menu do perfil não tinham volta: o X fecha tudo, e
// quem entrava em "Meu perfil" para conferir o e-mail caía no app e
// precisava reabrir o menu pelo nome lá em cima. Agora cada camada aberta
// por outra ganha uma seta, espelho do X, no canto oposto.
//
// O QUE ESTE TESTE DEFENDE
// A lista `COM_VOLTA_PARA_O_PERFIL` é escrita à mão, e é ela que decide
// quem ganha seta. Uma lista à mão ao lado de um menu que cresce fica para
// trás no primeiro item novo — e o sintoma é mudo: a tela abre, funciona, e
// só não tem volta. Então o teste não confere a lista contra outra lista:
// ele lê o DESPACHO do menu, descobre quais ações abrem camada de verdade,
// e exige que sejam exatamente essas.
// ============================================================

import { scriptDoApp, funcao, bloco } from '../scripts/recorte';

const src = scriptDoApp();

/** O corpo do ouvinte que despacha o menu do perfil. */
const despacho = bloco(
  src,
  '{',
  'document.getElementById("dlg-perfil").addEventListener("click"',
);

/** `if (acao === "x") abrirX();` → [['x', 'abrirX'], ...] */
function acoesDoMenu(): Array<[string, string]> {
  const achados: Array<[string, string]> = [];
  const re = /if \(acao === "(\w+)"\) (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(despacho))) achados.push([m[1], m[2]]);
  return achados;
}

/** Esta função abre uma camada? Vale também quem abre por uma intermediária
 * — `abrirMensagem`, por exemplo, que serve Suporte e Ideias. */
function abreCamada(nome: string, profundidade = 2): boolean {
  let corpo: string;
  try {
    corpo = funcao(src, nome);
  } catch {
    return false;
  }
  if (/\babrir\("/.test(corpo)) return true;
  if (profundidade <= 0) return false;
  const chamadas = corpo.match(/\b(abrir[A-Z]\w*)\(/g) || [];
  return chamadas.some((c) => abreCamada(c.slice(0, -1), profundidade - 1));
}

describe('o menu do perfil', () => {
  const acoes = acoesDoMenu();

  it('o despacho foi encontrado e tem ações', () => {
    expect(acoes.length).toBeGreaterThan(5);
  });

  /* O coração do teste. Se alguém acrescentar um item ao menu que abre uma
   * camada e esquecer da lista, isto falha dizendo o nome da ação. */
  it('toda ação que abre camada está na lista que dá a seta de voltar', () => {
    const lista = JSON.parse(
      bloco(src, '{', 'var COM_VOLTA_PARA_O_PERFIL =')
        .replace(/(\w+):/g, '"$1":')
        .replace(/,(\s*})/, '$1'),
    );
    const abremCamada = acoes.filter(([, fn]) => abreCamada(fn)).map(([a]) => a);
    expect(abremCamada.sort()).toEqual(Object.keys(lista).sort());
  });

  /* Confirmação não é camada de conteúdo: ela tem duas respostas, e uma
   * terceira saída confundiria. */
  it('"começar do zero" pede confirmação, e não ganha seta', () => {
    const lista = bloco(src, '{', 'var COM_VOLTA_PARA_O_PERFIL =');
    expect(lista).not.toContain('zerar');
    expect(lista).not.toContain('instalar');
    expect(lista).not.toContain('privacidade');
  });
});

describe('a seta de voltar', () => {
  const abrir = funcao(src, 'abrir');
  const pintar = funcao(src, 'pintarVolta');
  const voltar = funcao(src, 'voltarDaCamada');

  /* A marca é de UMA vez: sobrando, a próxima camada do app — que não veio
   * do perfil nenhum — nasceria com uma seta que volta para o lugar errado. */
  it('a origem é consumida ao abrir, nunca fica guardada', () => {
    expect(abrir).toContain('voltaDaProxima = null');
    expect(despacho).toContain('voltaDaProxima = null');
  });

  it('a camada sem origem fica sem seta — e sem o espaço dela no cabeçalho', () => {
    expect(pintar).toContain('if (!d.dataset.volta)');
    expect(pintar).toContain('classList.remove("com-volta")');
  });

  /* Perfil → Planos → Assinatura desfaz um passo de cada vez: ao reabrir o
   * pai, a volta DELE é restaurada. Sem esta linha, voltar uma vez levava a
   * Planos e a segunda seta não existia mais. */
  it('voltar preserva a volta do pai, para a corrente inteira desfazer', () => {
    expect(voltar).toContain('voltaDaProxima = paiEl.dataset.volta');
  });

  /* A seta NÃO substitui o X. Fechar e voltar são coisas diferentes, e o X
   * continua sendo a saída de toda camada. */
  it('a seta entra no cabeçalho sem tocar no X', () => {
    expect(pintar).toContain('layer-voltar');
    expect(pintar).not.toContain('layer-x');
  });
});
