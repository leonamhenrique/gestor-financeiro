// ============================================================
// scripts/gerar-fala.js
// ============================================================
// Recorta de `web/index.html` as funções que leem uma frase e escreve
// `src/fala/fala.js`, que o servidor importa.
//
// Por que recortar em vez de escrever de novo: a mesma frase precisa virar o
// mesmo lançamento na tela e no WhatsApp. Duas implementações da gramática
// divergem — não no primeiro dia, mas no terceiro ajuste —, e aí a pessoa vê
// uma resposta no app e outra no telefone para o que ela disse igual.
//
// Por que recortar em vez de o app importar um arquivo: o `index.html` é
// servido sozinho pelo Cloudflare Pages e também aberto solto (sem os
// arquivos irmãos). Quebrá-lo em dois para o servidor poder importar um deles
// seria pagar, no app de todo dia, o preço de uma integração.
//
// O arquivo gerado É VERSIONADO, e `fala.spec.ts` falha quando ele não bate
// com o `index.html` de agora. É isso que impede o recorte de envelhecer em
// silêncio: quem mexer na leitura da frase vê o teste vermelho e roda
// `npm run sync:fala`.
// ============================================================

const fs = require('fs');
const path = require('path');
const { scriptDoApp, bloco, linha, funcao } = require('./recorte');

const DESTINO = path.resolve(__dirname, '..', 'src', 'fala', 'fala.js');

/** As constantes que a leitura usa, na ordem em que aparecem lá. */
const CONSTANTES_BLOCO = [
  ['[', 'var MESES = '],
  ['{', 'var NUMERO_PALAVRA = '],
  ['{', 'var DIAS_SEMANA = '],
  ['[', 'var COMANDO_DA_FALA = '],
  ['[', 'var LIGACAO_DA_FALA = '],
  ['[', 'var FORMA_DA_FALA = '],
  ['[', 'var PALAVRAS_DE_ESTRUTURA = '],
];

/** As de uma linha só. */
const CONSTANTES_LINHA = [
  'var TERMOS_CONTA = ',
  'var TERMOS_CARTAO = ',
  'var PASSADO = ',
  'var FUTURO = ',
  'var ENTRADA = ',
  'var TRANSFERENCIA = ',
  'var RE_PARCELA = ',
  'var RE_PARCELA_DE = ',
  'var RE_PARCELA_EM = ',
  'var RE_PARCELA_X = ',
  'var MIN_LOJISTA = ',
  'var GENERICO_LOJISTA = ',
];

/** As funções, em ordem de dependência não importa — `function` sobe. */
const FUNCOES = [
  // base
  'byId',
  'isoDate',
  'monthKey',
  'adicionarDias',
  'adicionarMeses',
  'resolveInvoicePeriodFromDate',
  'faturaSugerida',
  'diaValido',
  'dataDeHoje',
  'normalizarNome',
  // categorias
  'filhasDe',
  'temFilhas',
  'categoriasLancaveis',
  // lojista
  'chaveDeTexto',
  'lojistaDoHistorico',
  'chaveDeLojista',
  'chavesDeLojista',
  'regraDoLojista',
  'regraParaDigitado',
  // a leitura da frase
  'normalizarFala',
  'valorPorExtenso',
  'numeroBR',
  'valorDaFala',
  'quantidadeDita',
  'parcelamentoDaFala',
  'mesPorNome',
  'escaparRegex',
  'posicaoDaPalavra',
  'acharPorNome',
  'falaDeFuturo',
  'dataDaFala',
  'formaDePagamentoDaFala',
  'contasNaOrdemDaFala',
  'destinoDaFala',
  'semPontuacao',
  'palavrasDeCadastroNaFala',
  'descricaoDaFala',
  'transferenciaDaFala',
  'interpretarFala',
];

const EXPORTADAS = [
  'interpretarFala',
  // A conversa precisa saber se a frase traz dinheiro: e isso que separa
  // uma pergunta de saldo de um lancamento.
  'valorDaFala',
  // O aprendizado do lojista também roda no servidor, e tem de usar a MESMA
  // chave e a MESMA regra de "já sei isto" da tela — senão os dois lados
  // ensinam coisas diferentes para a mesma tabela.
  'chaveDeLojista',
  'lojistaDoHistorico',
  'regraDoLojista',
  'MIN_LOJISTA',
  'normalizarFala',
  // O nome dos meses e a busca por nome: a pergunta "qual meu resultado em
  // outubro?" tem de entender "outubro" pela MESMA tabela que a tela usa, e
  // a resposta tem de escrever o mês como a tela escreve.
  'MESES',
  'mesPorNome',
  // Quais categorias a pessoa pode usar para aquele tipo: a resposta precisa
  // LISTAR as dela quando a frase pediu uma que nao existe, e "lancavel"
  // tem regra (categoria mae com filhas nao recebe lancamento).
  'categoriasLancaveis',
  // Achar o cartao que a frase nomeia: a pergunta "qual a fatura do Nubank"
  // tem de reconhecer o apelido pelas MESMAS regras que o lancamento usa
  // (sem acento, o nome mais longo primeiro, palavra de quatro letras).
  'acharPorNome',
];

const CABECALHO = `// ============================================================
// fala.js — GERADO. Não edite aqui.
// ============================================================
// Recortado de web/index.html por scripts/gerar-fala.js. Para mudar a leitura
// de uma frase, mexa no app e rode:
//
//     npm run sync:fala
//
// A leitura mora lá porque é lá que ela é usada o dia inteiro, por quem dita
// na tela. Aqui ela existe para o WhatsApp ler a MESMA frase do mesmo jeito.
// ============================================================

/* \`state\` é a variável do navegador: as contas, os cartões e as categorias de
 * quem está com o app aberto. No servidor ela não existe — a verdade vem do
 * banco, e é do dono da mensagem que chegou.
 *
 * Tocar nela aqui é sempre um bug: significa que alguém chamou a leitura sem
 * o contexto. Por isso ela estoura com nome e sobrenome, em vez de devolver
 * \`undefined\` e deixar a frase ser lida contra listas vazias — que é como se
 * acaba com "não identifiquei a conta" sem explicação nenhuma.
 */
const state = new Proxy(
  {},
  {
    get() {
      throw new Error('fala.js: faltou passar o contexto (ctx) — no servidor não existe \`state\`.');
    },
  },
);

/** O contexto é obrigatório fora da tela. Na tela ele sai de \`state\`; aqui,
 * do banco — e não há padrão possível. */
function contextoDaFala() {
  throw new Error('fala.js: passe o contexto (ctx) com contas, cartões, categorias, regras e hoje.');
}
`;

function gerar() {
  const src = scriptDoApp();
  const partes = [CABECALHO];

  CONSTANTES_BLOCO.forEach(([abre, marcador]) => {
    partes.push(marcador + bloco(src, abre, marcador) + ';');
  });
  CONSTANTES_LINHA.forEach((marcador) => {
    partes.push(linha(src, marcador));
  });
  FUNCOES.forEach((nome) => {
    partes.push(funcao(src, nome));
  });

  partes.push('module.exports = { ' + EXPORTADAS.join(', ') + ' };');
  return partes.join('\n\n') + '\n';
}

module.exports = { gerar, DESTINO };

if (require.main === module) {
  const conteudo = gerar();
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, conteudo, 'utf8');
  console.log('fala.js gerado: ' + conteudo.length + ' caracteres');
}
