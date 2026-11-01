// ============================================================
// scripts/recorte.js
// ============================================================
// O bisturi, compartilhado pelos geradores.
//
// `gerar-fala.js` recorta a leitura da frase; `gerar-relatorio.js` recorta a
// conta do mês. Os dois tiram pedaços do MESMO arquivo (`web/index.html`) pelo
// mesmo método — achar o marcador e equilibrar as chaves — e o método mora
// aqui para não existir em duas versões que divergem no primeiro ajuste. É a
// mesma razão que faz o recorte existir: uma regra, um lugar.
// ============================================================

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const ORIGEM = path.join(RAIZ, 'web', 'index.html');

/** O script do app, de dentro do HTML. É o último `<script>` do arquivo. */
function scriptDoApp() {
  const html = fs.readFileSync(ORIGEM, 'utf8');
  const i = html.lastIndexOf('<script>');
  const j = html.lastIndexOf('</script>');
  if (i < 0 || j < 0) throw new Error('não achei o script do app em ' + ORIGEM);
  return html.slice(i + 8, j);
}

/** O bloco delimitado por chaves ou colchetes que começa no marcador. */
function bloco(src, abre, marcador) {
  const i = src.indexOf(marcador);
  if (i < 0) throw new Error('não achei ' + marcador);
  const fecha = abre === '{' ? '}' : ']';
  const inicio = src.indexOf(abre, i);
  let nivel = 0;
  let j = inicio;
  for (; j < src.length; j++) {
    if (src[j] === abre) nivel++;
    else if (src[j] === fecha) {
      nivel--;
      if (!nivel) break;
    }
  }
  return src.slice(inicio, j + 1);
}

function linha(src, marcador) {
  const i = src.indexOf(marcador);
  if (i < 0) throw new Error('não achei ' + marcador);
  return src.slice(i, src.indexOf('\n', i));
}

function funcao(src, nome) {
  const marcador = 'function ' + nome + '(';
  const i = src.indexOf(marcador);
  if (i < 0) throw new Error('não achei a função ' + nome);
  const corpo = bloco(src, '{', marcador);
  return src.slice(i, src.indexOf('{', i)) + corpo;
}

module.exports = { RAIZ, ORIGEM, scriptDoApp, bloco, linha, funcao };
