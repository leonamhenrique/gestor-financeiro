// ============================================================
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

/* `state` é a variável do navegador: as contas, os cartões e os lançamentos
 * de quem está com o app aberto. No servidor ela é montada por pedido, a
 * partir do banco, e é do dono da mensagem que chegou — ver `calcularMes`
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


var CORES = ["#6EA8F0", "#A98CF0", "#F0946E", "#3DD68C", "#F0D66E", "#F06E9E", "#8CF0C4", "#9EA8B8"];

var STATUS_LABEL = { OPEN: "Aberta", CLOSED: "Fechada", OVERDUE: "Atrasada", PAID: "Paga", CARRIED: "Transportada" };

var cacheDeFaturas = null;

var CHAVE_RELATORIO = "gestor-relatorio-por";

var relatorioPor = "fatura";

var filtrosDoPlano = { previsto: true, cartao: true, ocultas: false };

function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function monthKey(vm) { return vm.y + "-" + String(vm.m + 1).padStart(2, "0"); }

function parseMonthKey(k) { var p = k.split("-"); return { y: parseInt(p[0], 10), m: parseInt(p[1], 10) - 1 }; }

function diaValido(y, m, dia) { return Math.min(dia, new Date(y, m + 1, 0).getDate()); }

function indiceMes(vm) { return vm.y * 12 + vm.m; }

function mesDoIndice(i) { return { y: Math.floor(i / 12), m: i - Math.floor(i / 12) * 12 }; }

function definirRelatorioPor(v, guardar) {
    if (v !== "compra" && v !== "fatura") return;
    relatorioPor = v;
    if (guardar) { try { localStorage.setItem(CHAVE_RELATORIO, v); } catch (e) {} }
  }

function diasDaFatura(card, y, m) {
    var ciclos = card.ciclos || [];
    if (!ciclos.length) return { fechamento: card.fechamento, vencimento: card.vencimento };
    var alvo = monthKey({ y: y, m: m });
    var escolhido = null;
    ciclos.forEach(function (c) {
      if (c.inicio > alvo) return;
      if (!escolhido || c.inicio > escolhido.inicio) escolhido = c;
    });
    // Fatura anterior ao primeiro período (importada de antes do cadastro):
    // vale o mais antigo que existe, senão ela ficaria sem dias.
    if (!escolhido) {
      escolhido = ciclos.reduce(function (a, b) { return a.inicio <= b.inicio ? a : b; });
    }
    return { fechamento: escolhido.fechamento, vencimento: escolhido.vencimento };
  }

function resolveInvoicePeriodFromDate(dataIso, card) {
    var d = new Date(dataIso + "T00:00:00");
    var day = d.getDate(), m = d.getMonth(), y = d.getFullYear();
    if (day > diasDaFatura(card, y, m).fechamento) { m++; if (m > 11) { m = 0; y++; } }
    return { y: y, m: m };
  }

function periodoDaTransacao(t, card) {
    return t.faturaMesOverride ? parseMonthKey(t.faturaMesOverride) : resolveInvoicePeriodFromDate(t.data, card);
  }

function fechamentoDaFatura(card, y, m) {
    return new Date(y, m, diaValido(y, m, diasDaFatura(card, y, m).fechamento));
  }

function vencimentoDaFatura(card, y, m) {
    var dia = diasDaFatura(card, y, m).vencimento;
    var noMes = new Date(y, m, diaValido(y, m, dia));
    if (noMes > fechamentoDaFatura(card, y, m)) return noMes;
    var ay = m === 11 ? y + 1 : y, am = (m + 1) % 12;
    return new Date(ay, am, diaValido(ay, am, dia));
  }

function referenciaQueVenceEm(card, vm) {
    var v = vencimentoDaFatura(card, vm.y, vm.m);
    if (v.getFullYear() === vm.y && v.getMonth() === vm.m) return { y: vm.y, m: vm.m };
    return mesDoIndice(indiceMes(vm) - 1);
  }

function comCacheDeFaturas(desenhar) {
    // Só quem abriu o cache o fecha: desenhos aninhados (renderAll chamando
    // renderResumo) compartilham a mesma memória em vez de zerá-la no meio.
    var raiz = cacheDeFaturas === null;
    if (raiz) cacheDeFaturas = {};
    try { return desenhar(); }
    finally { if (raiz) cacheDeFaturas = null; }
  }

function faturasDoCartao(card) {
    if (cacheDeFaturas && cacheDeFaturas[card.id]) return cacheDeFaturas[card.id];
    var porMes = {};
    state.transactions.filter(function (t) { return t.cartaoId === card.id; }).forEach(function (t) {
      var p = periodoDaTransacao(t, card);
      var key = monthKey(p);
      if (!porMes[key]) porMes[key] = { y: p.y, m: p.m, confirmado: 0, previsto: 0, transacoes: [] };
      porMes[key].transacoes.push(t);
      // Receita no cartão é estorno: abate da fatura. Somar sem olhar o tipo
      // fazia um estorno AUMENTAR o valor a pagar.
      var valor = t.tipo === "INCOME" ? -t.valor : t.valor;
      porMes[key].previsto += valor;
      if (t.confirmada) porMes[key].confirmado += valor;
    });
    var faturas = aplicarTransporte(card, porMes);
    if (cacheDeFaturas) cacheDeFaturas[card.id] = faturas;
    return faturas;
  }

function aplicarTransporte(card, porMes) {
    var chaves = Object.keys(porMes).sort();
    if (!chaves.length) return porMes;
    var fim = chaves[chaves.length - 1];
    var cursor = parseMonthKey(chaves[0]);
    var transporte = 0;
    for (var guarda = 0; guarda < 600; guarda++) {
      var key = monthKey(cursor);
      var f = porMes[key];
      if (!f && transporte > 0) {
        f = porMes[key] = { y: cursor.y, m: cursor.m, confirmado: 0, previsto: 0, transacoes: [] };
      }
      if (f) {
        f.transportado = transporte;
        f.confirmado += transporte;
        f.previsto += transporte;
        f.pago = totalPagoFatura(card, key);
        var restante = f.confirmado - f.pago;
        var venceu = HOJE > vencimentoDaFatura(card, cursor.y, cursor.m);
        f.levado = (f.pago > 0 && restante > 0 && venceu) ? restante : 0;
        f.emAberto = f.levado ? 0 : Math.max(0, restante);
        transporte = f.levado;
      } else {
        transporte = 0;
      }
      if (key >= fim && transporte <= 0) break;
      cursor = { y: cursor.m === 11 ? cursor.y + 1 : cursor.y, m: (cursor.m + 1) % 12 };
    }
    return porMes;
  }

function totalPagoFatura(card, key) {
    return (card.pagamentos || []).filter(function (p) { return p.mesKey === key; })
      .reduce(function (s, p) { return s + p.valor; }, 0);
  }

function statusFatura(card, y, m) {
    var key = y + "-" + String(m + 1).padStart(2, "0");
    var f = faturasDoCartao(card)[key] || { confirmado: 0 };
    var pago = totalPagoFatura(card, key);
    if (f.levado > 0) return "CARRIED";
    if (f.confirmado > 0 && pago >= f.confirmado) return "PAID";
    var fechamento = fechamentoDaFatura(card, y, m);
    var vencimento = vencimentoDaFatura(card, y, m);
    // Virada fecha a fatura NO DIA, e o VENCIMENTO não se mexe: ele é
    // calculado comparando com o fechamento do calendário, e trocar um pelo
    // outro adiantaria o vencimento em um mês num cartão que fecha depois do
    // dia de vencer (fecha 25, vence 20: virar dia 17 faria vencer dia 20
    // deste mês, e não do seguinte).
    var virada = (card.viradas || {})[key];
    if (virada ? isoDate(HOJE) < virada : HOJE < fechamento) return "OPEN";
    if (HOJE > vencimento) return "OVERDUE";
    return "CLOSED";
  }

function contaEstaOculta(contaId) {
    var a = byId(state.accounts, contaId);
    return a ? !!a.oculto : false;
  }

function transacaoVisivel(t) {
    if (t.contaId) return !contaEstaOculta(t.contaId);
    return true;
  }

function paraRelatorio(t) {
    if (!t.reembolso) return t;
    return Object.assign({}, t, { tipo: "EXPENSE", valor: -t.valor });
  }

function contaDoPagamento(p) {
    if (!p) return null;
    if (p.contaId) return byId(state.accounts, p.contaId);
    var t = byId(state.transactions, p.transacaoId);
    return t && t.contaId ? byId(state.accounts, t.contaId) : null;
  }

function totaisDoMes(vm, modo) {
    var mk = monthKey(vm);
    // Por compra, o lançamento de cartão vira uma linha como qualquer outra e
    // a fatura deixa de ter linha — senão o mesmo dinheiro apareceria duas
    // vezes, uma na compra e outra na fatura.
    var porCompra = (modo || relatorioPor) === "compra";
    var avulsos = state.transactions.filter(function (t) {
      if (t.pagamentoFaturaCartaoId) return false;
      if (!porCompra && t.cartaoId) return false;
      return t.data.slice(0, 7) === mk && transacaoVisivel(t);
    });
    var entradas = 0, saidas = 0;
    // Pelo olhar de relatório: reembolso abate despesa, não soma receita.
    avulsos.map(paraRelatorio).forEach(function (t) { if (t.tipo === "INCOME") entradas += t.valor; else saidas += t.valor; });

    // As faturas são sempre calculadas, mesmo no modo por compra: quem precisa
    // delas ali é o SALDO previsto, que é caixa e não muda de regime — o
    // dinheiro vai sair da conta no vencimento de qualquer jeito.
    //
    // A fatura entra no mês em que VENCE, não no mês de referência dela. Num
    // cartão que fecha 25 e vence 5, a fatura de setembro sai da conta em
    // outubro, e é em outubro que ela pesa.
    var faturas = [];
    state.cards.forEach(function (card) {
      var ref = referenciaQueVenceEm(card, vm);
      var refKey = monthKey(ref);
      var f = faturasDoCartao(card)[refKey];
      var pago = totalPagoFatura(card, refKey);
      if (!f && pago <= 0) return;
      f = f || { confirmado: 0, previsto: 0, transacoes: [] };
      var pagamentos = (card.pagamentos || []).filter(function (p) { return p.mesKey === refKey; });
      var contas = [];
      pagamentos.forEach(function (p) {
        var a = contaDoPagamento(p);
        if (a && contas.indexOf(a.nome) < 0) contas.push(a.nome);
      });
      var status = statusFatura(card, ref.y, ref.m);
      faturas.push({
        ref: ref,
        card: card, f: f, pago: pago, contas: contas,
        dataPagamento: pagamentos.length ? pagamentos[pagamentos.length - 1].data : null,
        status: status,
        // Transportada conta pelo que foi pago: o resto vai ser cobrado no mês
        // seguinte, e somar o total aqui cobraria o mesmo dinheiro duas vezes.
        linha: (status === "PAID" || status === "CARRIED") ? pago : f.previsto
      });
    });
    if (!porCompra) {
      faturas.forEach(function (x) {
        if (x.linha < 0) entradas += -x.linha; else saidas += x.linha;
      });
    }
    return {
      avulsos: avulsos, faturas: porCompra ? [] : faturas,
      entradas: entradas, saidas: saidas,
      abertoFaturas: faturas.reduce(function (s, x) { return s + (x.f.emAberto || 0); }, 0)
    };
  }

function resultadoDoMes(vm) {
    var tot = totaisDoMes(vm);
    return { entradas: tot.entradas, saidas: tot.saidas, resultado: tot.entradas - tot.saidas,
             vazio: tot.entradas === 0 && tot.saidas === 0 };
  }

function dataDeRelatorio(t) {
    if (relatorioPor === "compra" || !t.cartaoId) return t.data;
    var card = byId(state.cards, t.cartaoId);
    if (!card) return t.data;
    var p = periodoDaTransacao(t, card);
    return isoDate(vencimentoDaFatura(card, p.y, p.m));
  }

function movimentoDoMes(vm) {
    var mk = monthKey(vm);
    return state.transactions.filter(function (t) {
      return dataDeRelatorio(t).slice(0, 7) === mk && transacaoVisivel(t);
    }).map(paraRelatorio);
  }

function rankingCategorias(vm, tipo) {
    var acc = {};
    movimentoDoMes(vm).forEach(function (t) {
      if (t.tipo !== tipo || !t.categoriaId) return;
      var c = byId(state.categories, t.categoriaId);
      if (!c) return;
      if (!acc[c.id]) acc[c.id] = { id: c.id, nome: c.nome, cor: c.cor, valor: 0, n: 0 };
      acc[c.id].valor += t.valor; acc[c.id].n++;
    });
    return Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) { return b.valor - a.valor; });
  }

function totalDoGrupo(itens) {
    return itens.reduce(function (s, d) { return s + d.valor; }, 0);
  }

function filhasDe(id, categorias) {
    return (categorias || state.categories).filter(function (c) { return c.paiId === id; });
  }

function raizesDe(tipo) { return state.categories.filter(function (c) { return c.tipo === tipo && !c.paiId; }); }

function planejamentoDoMes(mk) {
    return (state.planejamentos || []).filter(function (p) { return p.mes === mk; })[0] || null;
  }

function itemDoPlano(pl, catId) {
    if (!pl) return null;
    return pl.itens.filter(function (i) { return i.categoriaId === catId; })[0] || null;
  }

function temMeta(pl, catId) { return !!itemDoPlano(pl, catId); }

function comprometidoDoPlano(pl) {
    if (!pl) return 0;
    return pl.itens.reduce(function (s, i) {
      var c = byId(state.categories, i.categoriaId);
      if (c && c.paiId && temMeta(pl, c.paiId)) return s;
      return s + i.valor;
    }, 0);
  }

function sobraDoPlano(pl) {
    return pl ? Math.max(0, pl.total - comprometidoDoPlano(pl)) : 0;
  }

function gastoEntraNoPlano(t, f) {
    if (t.tipo !== "EXPENSE" || t.pagamentoFaturaCartaoId) return false;
    if (!f.previsto && !t.confirmada) return false;
    if (!f.cartao && t.cartaoId) return false;
    if (!f.ocultas && !transacaoVisivel(t)) return false;
    return true;
  }

function receitaEntraNoPlano(t, f) {
    if (t.tipo !== "INCOME") return false;
    if (!f.previsto && !t.confirmada) return false;
    if (!f.cartao && t.cartaoId) return false;
    if (!f.ocultas && !transacaoVisivel(t)) return false;
    return true;
  }

function lancamentosDoPlano(vm, f) {
    var mk = monthKey(vm);
    return state.transactions.filter(function (t) { return dataDeRelatorio(t).slice(0, 7) === mk; });
  }

function gastoPorCategoriaDoPlano(vm, f) {
    var acc = { "": 0 };
    lancamentosDoPlano(vm, f).forEach(function (t) {
      if (!gastoEntraNoPlano(t, f)) return;
      var k = t.categoriaId || "";
      acc[k] = (acc[k] || 0) + t.valor;
    });
    return acc;
  }

function gastoComFilhas(acc, catId) {
    return filhasDe(catId).reduce(function (s, f) { return s + (acc[f.id] || 0); }, acc[catId] || 0);
  }

function totalGastoDoPlano(acc) {
    return Object.keys(acc).reduce(function (s, k) { return s + acc[k]; }, 0);
  }

function receitasDoPlanoNoMes(vm, f) {
    return lancamentosDoPlano(vm, f).reduce(function (s, t) {
      return receitaEntraNoPlano(t, f) ? s + t.valor : s;
    }, 0);
  }

function nivelDaMeta(gasto, meta) {
    if (meta <= 0) return gasto > 0 ? "caro" : "accent";
    var pct = gasto / meta;
    if (pct > 1) return "caro";
    if (pct >= 0.8) return "warn";
    return "accent";
  }

function pctDaMeta(gasto, meta) {
    if (meta > 0) return Math.round((gasto / meta) * 100);
    return gasto > 0 ? 100 : 0;
  }

function linhasDoPlanejamento(vm, f) {
    var pl = planejamentoDoMes(monthKey(vm));
    if (!pl) return [];
    var acc = gastoPorCategoriaDoPlano(vm, f);
    var linhas = [];
    var gastoDosGalhos = 0;

    function linha(c, filha) {
      var item = itemDoPlano(pl, c.id);
      var meta = item ? item.valor : 0;
      var gasto = gastoComFilhas(acc, c.id);
      linhas.push({
        id: c.id, nome: c.nome, cor: c.cor, filha: !!filha,
        meta: meta, gasto: gasto, resta: meta - gasto,
        pct: pctDaMeta(gasto, meta), nivel: nivelDaMeta(gasto, meta),
        somaFilhas: !!(item && item.somaFilhas)
      });
    }

    raizesDe("EXPENSE").forEach(function (raiz) {
      var filhasComMeta = filhasDe(raiz.id).filter(function (c) { return temMeta(pl, c.id); });
      if (!temMeta(pl, raiz.id) && !filhasComMeta.length) return;
      if (temMeta(pl, raiz.id)) {
        linha(raiz, false);
        gastoDosGalhos += gastoComFilhas(acc, raiz.id);
      }
      filhasComMeta.forEach(function (c) {
        linha(c, temMeta(pl, raiz.id));
        // Com meta na pai, o gasto da filha já entrou pelo galho dela.
        if (!temMeta(pl, raiz.id)) gastoDosGalhos += gastoComFilhas(acc, c.id);
      });
    });

    var sobra = sobraDoPlano(pl);
    var resto = Math.max(0, totalGastoDoPlano(acc) - gastoDosGalhos);
    linhas.push({
      id: null, nome: "Outras categorias", cor: null, filha: false, outras: true,
      meta: sobra, gasto: resto, resta: sobra - resto,
      pct: pctDaMeta(resto, sobra), nivel: nivelDaMeta(resto, sobra)
    });
    return linhas;
  }

function soData(v) { return String(v || "").slice(0, 10); }

function contaDaApi(j) {
    return {
      id: j.id, nome: j.institutionName, tipo: j.accountType,
      saldo: Number(j.currentBalance), saldoInicial: Number(j.initialBalance),
      cor: j.color || CORES[0], isActive: j.isActive, oculto: !!j.isHidden
    };
  }

function categoriaDaApi(j) {
    return { id: j.id, nome: j.name, tipo: j.type, cor: j.color || CORES[0], padrao: !!j.isDefault, paiId: j.parentId || null };
  }

function cartaoDaApi(j) {
    return {
      id: j.id, nome: j.name, limite: Number(j.limitAmount), fechamento: j.closingDay,
      vencimento: j.dueDay, cor: j.color || CORES[0], contaId: j.bankAccountId || null, pagamentos: [],
      // Faturas viradas: { '2026-12': '2026-11-23' }. Vêm no próprio cartão
      // porque toda tela de lançamento precisa delas.
      viradas: j.earlyClosures || {},
      // A linha do tempo do ciclo: [{ inicio: '2027-02', fechamento, vencimento }].
      // Sem ela, a tela calcularia as faturas antigas com os dias de hoje.
      ciclos: (j.cycles || []).map(function (c) {
        return {
          inicio: String(c.validFrom).slice(0, 7),
          fechamento: c.closingDay,
          vencimento: c.dueDay
        };
      })
    };
  }

function lancamentoDaApi(j) {
    return {
      id: j.id, tipo: j.type, valor: Number(j.amount), categoriaId: j.categoryId,
      desc: j.description || "", data: soData(j.transactionDate),
      contaId: j.bankAccountId || null, cartaoId: j.creditCardId || null,
      confirmada: !!j.isConfirmed,
      // Dinheiro que entra ABATENDO despesa, em vez de virar receita: ver
      // `paraRelatorio`.
      reembolso: !!j.isRefund,
      faturaMesOverride: j.invoiceMonthOverride ? String(j.invoiceMonthOverride).slice(0, 7) : null,
      serieId: j.seriesId || null, serieIndex: j.seriesIndex == null ? null : j.seriesIndex,
      // "Parcela 2/6" é derivado da série, não gravado na descrição: gravado,
      // ele voltaria colado no texto a cada edição e viraria "(Parcela 2/6)
      // (Parcela 2/6)". Ver rotuloLancamento.
      serieTipo: j.series ? j.series.kind : null,
      serieTotal: j.series ? j.series.count : null,
      // O lote de importação, para "importações recentes" e o desfazer.
      importacaoId: j.importBatchId || null,
      importadoEm: j.importedAt || ""
    };
  }

function pagamentoDaApi(p) {
    return { pagamentoId: p.id, mesKey: p.referenceMonth, valor: Number(p.amount), data: soData(p.paidAt), contaId: p.bankAccountId };
  }

function planejamentoDaApi(b) {
    return {
      mes: b.month,
      receita: Number(b.income || 0),
      total: Number(b.total || 0),
      itens: (b.items || []).map(function (i) {
        return { categoriaId: i.categoryId, valor: Number(i.amount), somaFilhas: !!i.fromChildren };
      })
    };
  }

// ------------------------------------------------------------
// a porta de entrada
// ------------------------------------------------------------

/** O estado do app montado a partir do que a API devolve.
 *
 * É o mesmo caminho de `carregarDoServidor` no app, com os mesmos
 * tradutores: cada campo do banco (institutionName, closingDay, isRefund,
 * invoiceMonthOverride...) vira o campo que a conta do mês espera em UM
 * lugar só. O servidor entrega o JSON cru das suas próprias rotas e não
 * precisa saber o que a conta faz com ele.
 *
 * `pagamentos` chega por cartão porque é assim que ele existe na API: uma
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
  };
}

/**
 * O resultado de um mês, pela conta da tela.
 *
 * **Sobre mexer em `state` e `HOJE` a cada chamada:** a conta é inteiramente
 * síncrona, e o Node roda um pedido de cada vez até o próximo `await`. Entre
 * a atribuição e o `finally` não existe ponto de espera, então nenhum outro
 * pedido consegue entrar no meio e ler o estado de outra pessoa. É a mesma
 * garantia por construção que o `comCacheDeFaturas` do app usa — e o
 * `finally` devolve o vazio para que um estado esquecido não possa ser lido
 * por engano depois.
 *
 * Nada de `async` aqui dentro: se um dia esta função precisar esperar algo,
 * a garantia acima deixa de valer, e o jeito será receber o estado pronto em
 * vez de guardá-lo.
 *
 * **O regime entra pelo global, e não como argumento**, porque é assim que a
 * tela funciona: `resultadoDoMes` chama `totaisDoMes` sem modo nenhum e
 * respeita o que o usuário escolheu. Passar o modo só para `totaisDoMes`
 * daria duas respostas na mesma chamada — o total por um regime e a contagem
 * de lançamentos pelo outro, que foi exatamente o que aconteceu aqui antes
 * desta linha existir.
 *
 * E por isso o regime é CONFERIDO em vez de aceito: `definirRelatorioPor`
 * ignora valor estranho em silêncio, e silêncio aqui deixaria o global como
 * o pedido anterior o pôs — a resposta de uma pessoa calculada pela
 * preferência de outra.
 */
function comEstado(dados, mes, hoje, regime, contar) {
  if (!(hoje instanceof Date) || isNaN(hoje.getTime())) {
    throw new Error('relatorio.js: passe `hoje` (Date) — é ele que decide rotativo e status de fatura.');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) {
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
    state = { accounts: [], cards: [], transactions: [], categories: [], planejamentos: [] };
    HOJE = null;
    definirRelatorioPor(REGIME_PADRAO, false);
  }
}

/** Uma fatura como quem lê precisa dela: de qual cartão, de qual mês, quanto
 * e quando sai da conta. `referencia` e `vencimento` vão juntos de propósito
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
 * vence. Quem decide isso é o `dataDeRelatorio` do app, recortado para cá.
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
 *   - e o mês de cada lançamento sai de `dataDeRelatorio`, não da data da
 *     compra: por fatura, a compra no cartão pesa no mês do vencimento — o
 *     mesmo regime do resto do app.
 *
 * **`categoriaId` é opcional**, e muda a pergunta: com ele, a resposta é de
 * uma categoria ("quanto ainda posso gastar com alimentação"); sem ele, é do
 * mês inteiro. A categoria sai resolvida de fora, por `acharPorNome` — a
 * mesma porta que reconhece o nome num lançamento.
 *
 * Quando a categoria pedida não tem meta mas a PAI dela tem, a pai vem junto
 * em `paiComMeta`: na árvore de um nível, o gasto da filha já está dentro da
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
 * lista não depende de regime nenhum. É o que o próprio `totaisDoMes` diz,
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

module.exports = { calcularMes, faturasDoMes, maioresDoMes, planoDoMes, estadoDaApi, REGIME_PADRAO: REGIME_PADRAO };
