// ============================================================
// scripts/gerar-relatorio.js
// ============================================================
// Recorta de `web/index.html` a conta do mês — a mesma de "Resultado mês a
// mês" — e escreve `src/relatorio/relatorio.js`, que o servidor importa.
//
// É o segundo recorte, pelo mesmo motivo do primeiro (ver gerar-fala.js): a
// pergunta "qual meu resultado nesse mês?" no WhatsApp tem de responder o
// número que está na tela. E esse número não sai de uma soma simples — ele
// depende do regime (compra ou fatura), de qual fatura VENCE no mês, do
// rotativo que transporta resto de fatura, de conta oculta, de reembolso que
// abate despesa em vez de somar receita, e de previsto contar junto com
// confirmado. Reescrever isso no servidor seria redescobrir um subsistema
// inteiro de cabeça, e cada descoberta errada apareceria como um centavo de
// diferença que ninguém consegue explicar.
//
// O arquivo gerado É VERSIONADO, e `relatorio.spec.ts` falha quando ele não
// bate com o `index.html` de agora. Quem mexer na conta do mês vê o teste
// vermelho e roda:
//
//     npm run sync:relatorio
// ============================================================

const fs = require('fs');
const path = require('path');
const { scriptDoApp, bloco, linha, funcao } = require('./recorte');

const DESTINO = path.resolve(__dirname, '..', 'src', 'relatorio', 'relatorio.js');

/** Constantes de bloco (lista ou objeto). */
const CONSTANTES_BLOCO = [
  ['[', 'var CORES = '],
  // O nome de cada situação de fatura sai daqui, e não do servidor: "Paga",
  // "Atrasada", "Transportada" são as palavras que a pessoa já leu na tela de
  // Cartões, e ela não deveria encontrar outras no WhatsApp.
  ['{', 'var STATUS_LABEL = '],
];

/** As de uma linha só. Incluem o regime e a memória de faturas: os dois são
 * estado do app, e trazê-los recortados em vez de reescritos é o que garante
 * que o padrão aqui seja o padrão de lá. */
const CONSTANTES_LINHA = [
  'var cacheDeFaturas = ',
  'var CHAVE_RELATORIO = ',
  'var relatorioPor = ',
];

/** As funções. A ordem não importa para o JavaScript (`function` sobe), mas
 * importa para quem lê: estão agrupadas como no app. */
const FUNCOES = [
  // base
  'byId',
  'isoDate',
  'monthKey',
  'parseMonthKey',
  'diaValido',
  'indiceMes',
  'mesDoIndice',
  // o regime, por um caminho só
  'definirRelatorioPor',
  // fatura: datas, períodos, rotativo e status
  'resolveInvoicePeriodFromDate',
  'periodoDaTransacao',
  'fechamentoDaFatura',
  'vencimentoDaFatura',
  'referenciaQueVenceEm',
  'comCacheDeFaturas',
  'faturasDoCartao',
  'aplicarTransporte',
  'totalPagoFatura',
  'statusFatura',
  // o que entra na conta
  'contaEstaOculta',
  'transacaoVisivel',
  'paraRelatorio',
  'contaDoPagamento',
  // a conta do mês
  'totaisDoMes',
  'resultadoDoMes',
  // a tradução do que a API devolve — a MESMA que o app usa ao carregar
  'soData',
  'contaDaApi',
  'cartaoDaApi',
  'lancamentoDaApi',
  'pagamentoDaApi',
];

const CABECALHO = `// ============================================================
// relatorio.js — GERADO. Não edite aqui.
// ============================================================
// Recortado de web/index.html por scripts/gerar-relatorio.js. Para mudar a
// conta do mês, mexa no app e rode:
//
//     npm run sync:relatorio
//
// A conta mora lá porque é lá que ela é lida o dia inteiro, na tela de
// Resumo. Aqui ela existe para o WhatsApp responder o MESMO número.
// ============================================================

/* \`state\` é a variável do navegador: as contas, os cartões e os lançamentos
 * de quem está com o app aberto. No servidor ela é montada por pedido, a
 * partir do banco, e é do dono da mensagem que chegou — ver \`calcularMes\`
 * no fim do arquivo, que é a única porta de entrada.
 *
 * Começa vazia, e não estourando como no fala.js, porque aqui ela é
 * ATRIBUÍDA: o Proxy que estoura serviria para pegar quem esqueceu o
 * contexto, mas impediria a própria atribuição de acontecer. O lugar de
 * cobrar o contexto é a porta de entrada, e ela cobra.
 */
var state = { accounts: [], cards: [], transactions: [] };

/* "Hoje" decide rotativo e status de fatura. No navegador é o relógio da
 * pessoa; aqui é o relógio DELA também, calculado no fuso do app pela porta
 * de entrada. Nasce nulo de propósito: uma conta feita sem data é uma conta
 * feita contra o 1º de janeiro de 1970, e é melhor estourar. */
var HOJE = null;
`;

const RODAPE = `// ------------------------------------------------------------
// a porta de entrada
// ------------------------------------------------------------

/** O estado do app montado a partir do que a API devolve.
 *
 * É o mesmo caminho de \`carregarDoServidor\` no app, com os mesmos
 * tradutores: cada campo do banco (institutionName, closingDay, isRefund,
 * invoiceMonthOverride...) vira o campo que a conta do mês espera em UM
 * lugar só. O servidor entrega o JSON cru das suas próprias rotas e não
 * precisa saber o que a conta faz com ele.
 *
 * \`pagamentos\` chega por cartão porque é assim que ele existe na API: uma
 * rota por cartão (/credit-cards/:id/payments), e é dela que sai o total
 * pago de cada fatura. */
function estadoDaApi(dados) {
  var cartoes = (dados.cartoes || []).map(cartaoDaApi);
  var porCartao = dados.pagamentos || {};
  cartoes.forEach(function (k) {
    k.pagamentos = (porCartao[k.id] || []).map(pagamentoDaApi);
  });
  return {
    accounts: (dados.contas || []).map(contaDaApi),
    cards: cartoes,
    transactions: (dados.lancamentos || []).map(lancamentoDaApi),
  };
}

/**
 * O resultado de um mês, pela conta da tela.
 *
 * **Sobre mexer em \`state\` e \`HOJE\` a cada chamada:** a conta é inteiramente
 * síncrona, e o Node roda um pedido de cada vez até o próximo \`await\`. Entre
 * a atribuição e o \`finally\` não existe ponto de espera, então nenhum outro
 * pedido consegue entrar no meio e ler o estado de outra pessoa. É a mesma
 * garantia por construção que o \`comCacheDeFaturas\` do app usa — e o
 * \`finally\` devolve o vazio para que um estado esquecido não possa ser lido
 * por engano depois.
 *
 * Nada de \`async\` aqui dentro: se um dia esta função precisar esperar algo,
 * a garantia acima deixa de valer, e o jeito será receber o estado pronto em
 * vez de guardá-lo.
 *
 * **O regime entra pelo global, e não como argumento**, porque é assim que a
 * tela funciona: \`resultadoDoMes\` chama \`totaisDoMes\` sem modo nenhum e
 * respeita o que o usuário escolheu. Passar o modo só para \`totaisDoMes\`
 * daria duas respostas na mesma chamada — o total por um regime e a contagem
 * de lançamentos pelo outro, que foi exatamente o que aconteceu aqui antes
 * desta linha existir.
 *
 * E por isso o regime é CONFERIDO em vez de aceito: \`definirRelatorioPor\`
 * ignora valor estranho em silêncio, e silêncio aqui deixaria o global como
 * o pedido anterior o pôs — a resposta de uma pessoa calculada pela
 * preferência de outra.
 */
function comEstado(dados, mes, hoje, regime, contar) {
  if (!(hoje instanceof Date) || isNaN(hoje.getTime())) {
    throw new Error('relatorio.js: passe \`hoje\` (Date) — é ele que decide rotativo e status de fatura.');
  }
  if (!/^\\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) {
    throw new Error('relatorio.js: mês inválido (' + mes + '). Use AAAA-MM.');
  }
  if (regime !== 'compra' && regime !== 'fatura') {
    throw new Error('relatorio.js: regime inválido (' + regime + '). Use "compra" ou "fatura".');
  }
  state = estadoDaApi(dados);
  HOJE = hoje;
  definirRelatorioPor(regime, false);
  try {
    return comCacheDeFaturas(function () {
      return contar(parseMonthKey(mes));
    });
  } finally {
    state = { accounts: [], cards: [], transactions: [] };
    HOJE = null;
    definirRelatorioPor(REGIME_PADRAO, false);
  }
}

/** Uma fatura como quem lê precisa dela: de qual cartão, de qual mês, quanto
 * e quando sai da conta. \`referencia\` e \`vencimento\` vão juntos de propósito
 * — "a fatura de novembro" e "a fatura que vence em novembro" podem ser duas
 * faturas diferentes, e dizer só uma das duas é o jeito de a pessoa conferir
 * o número contra o mês errado. */
function linhaDaFatura(x) {
  return {
    // O id junto do nome: quem filtra por cartao filtra por id, e nao por
    // texto. Dois cartoes podem se chamar parecido, e nome nao e chave.
    cartaoId: x.card.id,
    cartao: x.card.nome,
    referencia: monthKey(x.ref),
    vencimento: isoDate(vencimentoDaFatura(x.card, x.ref.y, x.ref.m)),
    valor: x.linha,
    status: x.status,
    situacao: STATUS_LABEL[x.status] || x.status,
  };
}

function calcularMes(dados, mes, hoje, regime) {
  return comEstado(dados, mes, hoje, regime, function (vm) {
    var tot = totaisDoMes(vm);
    var r = resultadoDoMes(vm);
    return {
      mes: mes,
      regime: relatorioPor,
      entradas: r.entradas,
      saidas: r.saidas,
      resultado: r.resultado,
      vazio: r.vazio,
      // O mesmo número que a tela mostra embaixo de Receitas: lançamento
      // avulso conta um, e cada fatura conta um — porque na tela a fatura
      // é uma linha, não as compras dela.
      lancamentos: tot.avulsos.length + tot.faturas.length,
      faturas: tot.faturas.map(linhaDaFatura),
    };
  });
}

/**
 * As faturas que VENCEM no mês, uma por cartão, com o total.
 *
 * **Por que sempre pelo regime de fatura, seja qual for a preferência:** a
 * lista não depende de regime nenhum. É o que o próprio \`totaisDoMes\` diz,
 * no comentário que veio no recorte — "as faturas são sempre calculadas,
 * mesmo no modo por compra" —, e por um motivo de caixa: o dinheiro sai da
 * conta no vencimento de qualquer jeito. O regime decide em que mês uma
 * compra PESA num relatório, não quando o cartão cobra. Quem pergunta "quanto
 * tenho de fatura em novembro?" está perguntando o que sai da conta, e essa
 * resposta tem de ser a mesma para as duas preferências.
 *
 * O mês é o do VENCIMENTO, e não o da referência: num cartão que fecha 25 e
 * vence 5, a fatura de outubro é cobrada em novembro, e é em novembro que ela
 * aparece aqui. Cada linha diz as duas datas, para a conferência não depender
 * de adivinhar qual das duas eu escolhi.
 */
function faturasDoMes(dados, mes, hoje) {
  return comEstado(dados, mes, hoje, 'fatura', function (vm) {
    var linhas = totaisDoMes(vm).faturas.map(linhaDaFatura);
    return {
      mes: mes,
      // Fatura com saldo credor (estorno maior que as compras) entra
      // negativa, e o total a soma pelo sinal: é dinheiro que volta.
      total: linhas.reduce(function (s, f) { return s + f.valor; }, 0),
      faturas: linhas,
      // Quantos cartões existem, e não quantas faturas: é a diferença entre
      // "nenhuma fatura vence neste mês" e "você não tem cartão cadastrado",
      // que são duas respostas bem diferentes para quem perguntou.
      cartoes: state.cards.length,
    };
  });
}

/** O regime que o app assume quando ninguém escolheu — lido do próprio
 * recorte, para não haver um padrão aqui e outro lá. */
var REGIME_PADRAO = relatorioPor;

module.exports = { calcularMes, faturasDoMes, estadoDaApi, REGIME_PADRAO: REGIME_PADRAO };
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

  partes.push(RODAPE);
  return partes.join('\n\n');
}

module.exports = { gerar, DESTINO };

if (require.main === module) {
  const conteudo = gerar();
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, conteudo, 'utf8');
  console.log('relatorio.js gerado: ' + conteudo.length + ' caracteres');
}
