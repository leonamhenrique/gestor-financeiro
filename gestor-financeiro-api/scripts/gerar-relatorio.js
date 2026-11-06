// ============================================================
// scripts/gerar-relatorio.js
// ============================================================
// Recorta de `web/home.html` a conta do mês — a mesma de "Resultado mês a
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
// bate com o `home.html` de agora. Quem mexer na conta do mês vê o teste
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
  // Os filtros do acompanhamento do planejamento, com o PADRÃO do app:
  // confirmado e previsto juntos, cartão contando, conta oculta de fora.
  //
  // Vêm recortados, e só a linha do padrão — a tela ainda os lê do
  // localStorage, que é do aparelho. O WhatsApp não tem aparelho, e por isso
  // responde pelo padrão; reescrever esses três booleanos aqui seria deixar
  // o WhatsApp contando uma coisa e a tela recém-aberta outra.
  //
  // O previsto é o que a pergunta "quanto ainda posso gastar" pede: o cartão
  // parcelado deste mês e a conta de luz agendada já estão comprometidos, e
  // um teto que os ignora diz que cabe dinheiro que não cabe.
  'var filtrosDoPlano = ',
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
  // O ciclo e uma linha do tempo: os dias saem do periodo que vale PARA
  // aquela fatura, e nao do par de hoje.
  'diasDaFatura',
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
  // as maiores categorias do mês — as mesmas do Resumo. `dataDeRelatorio` é
  // quem faz o regime valer aqui: por compra, o lançamento conta na data
  // dele; por fatura, no dia em que a fatura vence.
  'dataDeRelatorio',
  'movimentoDoMes',
  'rankingCategorias',
  'totalDoGrupo',
  // ---- o planejamento: o teto do mês, a meta de cada categoria e o quanto
  // de cada uma já foi usado.
  //
  // Vem inteiro porque "quanto ainda posso gastar com alimentação" é a conta
  // da tela de Planejamento, linha por linha, e ela tem três regras que não
  // se adivinham: pagamento de fatura não é gasto (as compras que a formaram
  // já contaram), o gasto da filha soma no da pai, e a meta da filha está
  // DENTRO da meta da pai quando a pai tem meta — somar as duas faria o teto
  // caber menos do que ele diz.
  'filhasDe',
  'raizesDe',
  // O mês de hoje é o PISO da herança do planejamento: mês à frente sem
  // decisão própria herda a mais recente, mês passado sem decisão continua
  // sem teto. Ver `planejamentoDoMes`.
  'mesDeHoje',
  'planejamentoDoMes',
  'itemDoPlano',
  'temMeta',
  'comprometidoDoPlano',
  'sobraDoPlano',
  'gastoEntraNoPlano',
  'receitaEntraNoPlano',
  'lancamentosDoPlano',
  'gastoPorCategoriaDoPlano',
  'gastoComFilhas',
  'totalGastoDoPlano',
  'receitasDoPlanoNoMes',
  'nivelDaMeta',
  'pctDaMeta',
  'linhasDoPlanejamento',
  // ---- os objetivos: quanto está guardado, e o que falta para cada um.
  //
  // São três números diferentes e fáceis de confundir, e a tela de Objetivos
  // mostra os três lado a lado: o GUARDADO (que inclui o saldo inicial, o
  // dinheiro que já era da pessoa e nunca passou por uma conta do app), o
  // APLICADO das contas (que continua sendo saldo dela, e é o que o saldo
  // geral soma) e a diferença entre os dois. Escolher um e chamar de "o
  // total" seria responder outra pergunta.
  //
  // `progressoDoObjetivo` recebe o "hoje" por parâmetro SEMPRE: o fallback
  // dele é `dataDeHoje()`, que aqui não existe de propósito — seria o relógio
  // do servidor decidindo o prazo de quem perguntou, e é melhor estourar.
  'movimentosDoObjetivo',
  'saldoDoObjetivo',
  'aplicadoDoObjetivo',
  'emObjetivos',
  'mesesAteOPrazo',
  'progressoDoObjetivo',
  'objetivoConcluido',
  // a tradução do que a API devolve — a MESMA que o app usa ao carregar
  'soData',
  'contaDaApi',
  // A categoria entra porque o ranking agrupa por ela — e pelo tradutor do
  // app, como todo o resto.
  'categoriaDaApi',
  'cartaoDaApi',
  'lancamentoDaApi',
  'pagamentoDaApi',
  'planejamentoDaApi',
  'objetivoDaApi',
  'movimentoDeObjetivoDaApi',
];

const CABECALHO = `// ============================================================
// relatorio.js — GERADO. Não edite aqui.
// ============================================================
// Recortado de web/home.html por scripts/gerar-relatorio.js. Para mudar a
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
    // Sem as categorias o ranking do mês não tem como agrupar: ele pergunta
    // o NOME de cada uma, e um id solto não vira linha de resposta.
    categories: (dados.categorias || []).map(categoriaDaApi),
    // O planejamento de TODOS os meses, como o app o carrega. O do mês
    // perguntado seria o bastante para a conta, mas não para a resposta: sem
    // os outros não há como dizer "você planejou outubro, mas não novembro"
    // — e essa é a diferença entre oferecer copiar e oferecer começar do
    // zero, que é o que a tela faz no mesmo caso.
    planejamentos: (dados.planejamentos || []).map(planejamentoDaApi),
    // Os objetivos vêm com os movimentos dentro, como a rota /goals os
    // entrega: o guardado de cada um É a soma deles sobre o saldo inicial,
    // e um objetivo sem os movimentos apareceria zerado em silêncio.
    objetivos: (dados.objetivos || []).map(objetivoDaApi),
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
    state = { accounts: [], cards: [], transactions: [], categories: [], planejamentos: [], objetivos: [] };
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
 * As maiores categorias do mês — as mesmas cinco que o Resumo mostra em
 * "Maiores despesas" e "Maiores receitas".
 *
 * Por categoria, e não lançamento a lançamento: "maiores gastos" quase sempre
 * quer dizer "em quê", e a lista de lançamentos é o extrato, que é outra
 * pergunta.
 *
 * O regime vale aqui inteiro, e não só no total: por compra, a compra do
 * cartão conta no mês em que foi feita; por fatura, no mês em que a fatura
 * vence. Quem decide isso é o \`dataDeRelatorio\` do app, recortado para cá.
 *
 * O total vem junto porque a soma das cinco primeiras não é o total do grupo
 * quando há mais categorias — e uma porcentagem sem o inteiro dela não diz
 * nada.
 */
function maioresDoMes(dados, mes, hoje, tipo, regime, quantas) {
  var teto = quantas || 5;
  return comEstado(dados, mes, hoje, regime, function (vm) {
    var itens = rankingCategorias(vm, tipo);
    var total = totalDoGrupo(itens);
    return {
      mes: mes,
      tipo: tipo,
      regime: relatorioPor,
      total: total,
      // Quantas ficaram de fora, para a resposta poder dizer "e mais N".
      restantes: Math.max(0, itens.length - teto),
      itens: itens.slice(0, teto).map(function (d) {
        return {
          categoria: d.nome,
          valor: d.valor,
          lancamentos: d.n,
          // A fatia é DENTRO do grupo (despesas com despesas), que é o que
          // responde "quanto das minhas despesas foi moradia".
          parte: total > 0 ? (d.valor / total) * 100 : 0,
        };
      }),
    };
  });
}

/**
 * O planejamento do mês e o quanto dele já foi usado — a tela de
 * Planejamento, que é quem responde "quanto ainda posso gastar".
 *
 * **Por que a conta vem recortada e não somada aqui:** o gasto de uma meta
 * não é "somar os lançamentos da categoria". São quatro regras juntas, e
 * cada uma delas foi um defeito possível:
 *
 *   - pagamento de fatura não é gasto (as compras que a formaram já
 *     contaram), senão o cartão conta duas vezes;
 *   - o gasto da filha soma no da pai, porque é assim que a meta da pai se
 *     reparte;
 *   - mas a META da filha está DENTRO da meta da pai, e somar as duas faria
 *     o teto do mês caber menos do que ele diz;
 *   - e o mês de cada lançamento sai de \`dataDeRelatorio\`, não da data da
 *     compra: por fatura, a compra no cartão pesa no mês do vencimento — o
 *     mesmo regime do resto do app.
 *
 * **\`categoriaId\` é opcional**, e muda a pergunta: com ele, a resposta é de
 * uma categoria ("quanto ainda posso gastar com alimentação"); sem ele, é do
 * mês inteiro. A categoria sai resolvida de fora, por \`acharPorNome\` — a
 * mesma porta que reconhece o nome num lançamento.
 *
 * Quando a categoria pedida não tem meta mas a PAI dela tem, a pai vem junto
 * em \`paiComMeta\`: na árvore de um nível, o gasto da filha já está dentro da
 * meta da pai, e dizer só "não tem meta" esconderia o teto que de fato
 * limita aquele gasto.
 */
function planoDoMes(dados, mes, hoje, regime, categoriaId) {
  return comEstado(dados, mes, hoje, regime, function (vm) {
    var mk = monthKey(vm);
    var pl = planejamentoDoMes(mk);
    // Os meses que a pessoa JÁ planejou. Sem plano no mês perguntado, é o que
    // separa "copie de outubro" de "comece do zero" — as duas ofertas que a
    // própria tela faz nesse caso.
    var planejados = (state.planejamentos || []).map(function (p) { return p.mes; });
    var base = { mes: mk, regime: relatorioPor, planejados: planejados };
    if (!pl) return Object.assign(base, { temPlano: false, linhas: [] });

    // Os filtros do app, no padrão dele: confirmado e previsto, cartão
    // dentro, conta oculta fora. Vão na resposta para a pessoa poder conferir
    // o número contra a tela, que tem os mesmos três botões.
    var f = filtrosDoPlano;
    var acc = gastoPorCategoriaDoPlano(vm, f);
    var gasto = totalGastoDoPlano(acc);

    var r = Object.assign(base, {
      temPlano: true,
      // De onde veio o teto, quando não foi decidido NESTE mês. Sem isto a
      // resposta diria "passou em R$ 1.200,00" contra uma meta que a pessoa
      // não escolheu para este mês — veredito sem procedência.
      herdadoDe: pl.herdadoDe || null,
      teto: pl.total,
      gasto: gasto,
      resta: pl.total - gasto,
      pct: pctDaMeta(gasto, pl.total),
      nivel: nivelDaMeta(gasto, pl.total),
      repartido: comprometidoDoPlano(pl),
      sobraDoTeto: sobraDoPlano(pl),
      receitaEsperada: pl.receita,
      receitaLancada: receitasDoPlanoNoMes(vm, f),
      filtros: { previsto: !!f.previsto, cartao: !!f.cartao, ocultas: !!f.ocultas },
      linhas: linhasDoPlanejamento(vm, f).map(function (l) {
        return {
          id: l.id, nome: l.nome, filha: !!l.filha, outras: !!l.outras,
          meta: l.meta, gasto: l.gasto, resta: l.resta, pct: l.pct, nivel: l.nivel,
        };
      }),
    });

    var c = categoriaId ? byId(state.categories, categoriaId) : null;
    if (c) {
      var item = itemDoPlano(pl, c.id);
      var meta = item ? item.valor : 0;
      var usado = gastoComFilhas(acc, c.id);
      r.categoria = {
        id: c.id, nome: c.nome, temMeta: !!item, meta: meta, gasto: usado,
        resta: meta - usado, pct: pctDaMeta(usado, meta), nivel: nivelDaMeta(usado, meta),
        // Quantas filhas somam nesse gasto: é o que explica um número maior
        // do que a pessoa esperava ver na categoria pai.
        filhas: filhasDe(c.id).length,
      };
      var pai = c.paiId ? byId(state.categories, c.paiId) : null;
      if (!item && pai && temMeta(pl, pai.id)) {
        var itemPai = itemDoPlano(pl, pai.id);
        var usadoPai = gastoComFilhas(acc, pai.id);
        r.paiComMeta = {
          id: pai.id, nome: pai.nome, meta: itemPai.valor, gasto: usadoPai,
          resta: itemPai.valor - usadoPai,
          pct: pctDaMeta(usadoPai, itemPai.valor),
          nivel: nivelDaMeta(usadoPai, itemPai.valor),
        };
      }
    }
    return r;
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

/**
 * O que está guardado nos objetivos — a tela de Objetivos, em números.
 *
 * **Sem mês e sem regime**, e por isso não passa por \`comEstado\`: objetivo
 * não tem competência. "Quanto tenho guardado?" é uma pergunta de HOJE, como
 * a do saldo, e o mês só apareceria aqui como um parâmetro que não muda
 * resposta nenhuma — do tipo que alguém acabaria usando.
 *
 * **Os três números do topo da tela vão juntos, e é de propósito.** Eles se
 * parecem e não são a mesma coisa:
 *
 *   - \`guardado\` é o que está nos objetivos EM ANDAMENTO, saldo inicial
 *     incluído. É o número grande da tela;
 *   - \`dasContas\` é o que saiu de uma conta e continua sendo saldo da
 *     pessoa — é este que o saldo geral soma, e só este;
 *   - \`inicial\` é o que já era dela e nunca passou por uma conta do app.
 *
 * Responder só o primeiro faria a pessoa somar esse dinheiro ao saldo das
 * contas e contar parte dele duas vezes. Responder só o segundo esconderia
 * dinheiro que ela guardou de verdade.
 *
 * \`hoje\` é obrigatório porque o prazo é contado a partir dele: é ele que
 * diz quantos meses faltam e quanto por mês. O fallback do app
 * (\`dataDeHoje()\`) não existe aqui de propósito — seria o relógio do
 * servidor decidindo o prazo de quem perguntou.
 */
function objetivosDeHoje(dados, hoje) {
  if (!(hoje instanceof Date) || isNaN(hoje.getTime())) {
    throw new Error('relatorio.js: passe \`hoje\` (Date) — é ele que conta os meses que faltam até o prazo.');
  }
  state = estadoDaApi(dados);
  HOJE = hoje;
  try {
    var todos = state.objetivos || [];
    var linha = function (o) {
      var p = progressoDoObjetivo(o, hoje);
      return {
        id: o.id,
        nome: o.nome,
        meta: o.meta,
        guardado: p.guardado,
        falta: p.falta,
        // Inteiro, como a tela escreve na barra.
        pct: Math.round(p.pct * 100),
        prazo: o.prazo,
        meses: p.meses,
        // Quanto por mês para chegar no prazo — recalculado, nunca gravado:
        // quem depositou menos vê subir, quem depositou mais vê descer.
        mensal: p.mensal,
        // Fora do prazo e ainda faltando dinheiro.
        atrasado: !p.noPrazo,
        concluido: objetivoConcluido(o),
        // Quanto deste objetivo veio das contas; o resto é saldo inicial.
        dasContas: aplicadoDoObjetivo(o, true),
      };
    };
    var ativos = todos.filter(function (o) { return !objetivoConcluido(o); });
    return {
      guardado: ativos.reduce(function (s, o) { return s + saldoDoObjetivo(o); }, 0),
      dasContas: emObjetivos(),
      // A subtração, e não um campo: resgatar mais do que foi aplicado come o
      // saldo inicial, e um número gravado mentiria depois disso. Sobre TODOS
      // os objetivos, como na tela.
      inicial: todos.reduce(function (s, o) {
        return s + (saldoDoObjetivo(o) - aplicadoDoObjetivo(o));
      }, 0),
      quantos: todos.length,
      ativos: ativos.map(linha),
      concluidos: todos.filter(objetivoConcluido).map(linha),
    };
  } finally {
    state = { accounts: [], cards: [], transactions: [], categories: [], planejamentos: [], objetivos: [] };
    HOJE = null;
  }
}

/** O regime que o app assume quando ninguém escolheu — lido do próprio
 * recorte, para não haver um padrão aqui e outro lá. */
var REGIME_PADRAO = relatorioPor;

module.exports = { calcularMes, faturasDoMes, maioresDoMes, planoDoMes, objetivosDeHoje, estadoDaApi, REGIME_PADRAO: REGIME_PADRAO };
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
