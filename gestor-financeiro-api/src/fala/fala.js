// ============================================================
// fala.js — GERADO. Não edite aqui.
// ============================================================
// Recortado de web/home.html por scripts/gerar-fala.js. Para mudar a leitura
// de uma frase, mexa no app e rode:
//
//     npm run sync:fala
//
// A leitura mora lá porque é lá que ela é usada o dia inteiro, por quem dita
// na tela. Aqui ela existe para o WhatsApp ler a MESMA frase do mesmo jeito.
// ============================================================

/* `state` é a variável do navegador: as contas, os cartões e as categorias de
 * quem está com o app aberto. No servidor ela não existe — a verdade vem do
 * banco, e é do dono da mensagem que chegou.
 *
 * Tocar nela aqui é sempre um bug: significa que alguém chamou a leitura sem
 * o contexto. Por isso ela estoura com nome e sobrenome, em vez de devolver
 * `undefined` e deixar a frase ser lida contra listas vazias — que é como se
 * acaba com "não identifiquei a conta" sem explicação nenhuma.
 */
const state = new Proxy(
  {},
  {
    get() {
      throw new Error('fala.js: faltou passar o contexto (ctx) — no servidor não existe `state`.');
    },
  },
);

/** O contexto é obrigatório fora da tela. Na tela ele sai de `state`; aqui,
 * do banco — e não há padrão possível. */
function contextoDaFala() {
  throw new Error('fala.js: passe o contexto (ctx) com contas, cartões, categorias, regras e hoje.');
}


var MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

var NUMERO_PALAVRA = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
    dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
    sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200,
    trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700,
    oitocentos: 800, novecentos: 900, mil: 1000
  };

var DIAS_SEMANA = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6
  };

var COMANDO_DA_FALA = [
    // o ato de lançar
    "lancamento", "lancamentos", "lancar", "lanca", "lance", "registrar", "registra",
    "registro", "anotar", "anota", "adicionar", "adiciona",
    // despesa e receita, nos tempos em que se fala delas
    "despesa", "despesas", "gasto", "gastos", "gastei", "gastar", "gastarei",
    "receita", "receitas", "recebi", "receber", "recebimento", "receberei",
    "ganhei", "ganhar", "paguei", "pagar", "pago", "paga", "pagamento", "pagarei",
    "quitei", "quitar", "comprei", "comprar", "compra", "compras", "compro",
    "transferi", "transferir", "transferencia", "transfiro", "transferido", "transferida",
    "vou", "vamos", "vai", "vao", "sera",
    // situação
    "previsto", "prevista", "previstos", "previstas", "agendado", "agendada",
    "confirmado", "confirmada", "confirmar", "debitado", "creditado", "depositado",
    "depositaram", "caiu", "entrou", "saiu", "vence", "vencimento", "vencer",
    // onde o dinheiro entra ou sai
    "cartao", "cartoes", "credito", "debito", "pix", "dinheiro", "especie",
    "boleto", "ted", "doc", "conta", "contas", "banco", "bancos", "corrente", "poupanca",
    "fatura", "faturas", "parcela", "parcelas", "parcelado", "parcelada", "vezes",
    // os rótulos que a própria frase usa
    "categoria", "categorias", "descricao", "valor", "quantia", "total",
    "reais", "real", "brl", "conto", "contos", "pila",
    // tempo
    "hoje", "ontem", "anteontem", "amanha", "dia", "dias", "semana", "semanas",
    "mes", "meses", "ano", "anos", "proxima", "proximo", "passada", "passado",
    "ultima", "ultimo", "fim", "final", "inicio", "comeco", "daqui", "dentro", "vem"
  ];

var LIGACAO_DA_FALA = [
    "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "ao", "aos",
    "a", "o", "os", "as", "um", "uma", "uns", "umas", "e", "com", "por", "pelo",
    "pela", "para", "pra", "pro", "que"
  ];

var FORMA_DA_FALA = [
    "cartao", "cartoes", "credito", "debito", "pix", "conta", "contas", "banco", "bancos"
  ];

var ANUNCIA_CONTA = ["conta", "contas", "banco", "corrente", "poupanca"];

var PREPOSICAO_DE_LUGAR = ["da", "do", "na", "no", "em", "pela", "pelo"];

var ANUNCIA_CARTAO = ["cartao", "cartoes"];

var PALAVRAS_DE_ESTRUTURA = ["conta", "contas", "banco", "para", "dinheiro", "valor", "saldo", "corrente"];

var FIM_DA_DIVISAO = [
    "cartao", "cartoes", "credito", "debito", "pix", "dinheiro", "especie",
    "boleto", "ted", "doc", "conta", "contas", "banco", "bancos", "corrente",
    "poupanca", "fatura", "faturas",
    "categoria", "categorias", "descricao",
    "parcela", "parcelas", "parcelado", "parcelada", "vezes",
    "hoje", "ontem", "anteontem", "amanha", "dia", "dias", "semana", "semanas",
    "mes", "meses", "ano", "anos"
  ];

var REPETE_FREQ = [
    [/\bquinzenal(?:mente)?\b|\ba cada (?:15|quinze) dias\b/, "BIWEEKLY"],
    [/\btrimestral(?:mente)?\b|\ba cada (?:3|tres) meses\b/, "QUARTERLY"],
    [/\banual(?:mente)?\b|\btodo ano\b|\btodos os anos\b|\ba cada ano\b/, "YEARLY"],
    [/\bmensal(?:mente)?\b|\btodo mes\b|\btodos os meses\b|\ba cada mes\b/, "MONTHLY"]
  ];

var MOEDA = "\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";

var TERMOS_CONTA = /debito|em conta|na conta|da conta|conta corrente|poupanca|dinheiro|especie|\bpix\b|transferencia|\bted\b|\bdoc\b|boleto|carteira/;

var TERMOS_CARTAO = /cartao|credito|fatura|parcelad/;

var PASSADO = /\bpaguei\b|\bpago\b|quitei|\bgastei\b|\bcomprei\b|ja foi|debitado|creditado|\bpix\b|\bdebito\b|confirmad|\brecebi\b|\bcaiu\b|\bentrou\b|\bganhei\b|depositaram|me pagaram|\bveio\b|\btransferi\b|transferido|transferida/;

var FUTURO = /previst|agendad|vai vencer|vai sair|vai cair|vai entrar|\ba pagar\b|\ba receber\b|pagarei|vou pagar|sera pago|receberei|vou receber|vao me pagar|sera creditado|sera depositado|vou gastar|gastarei|vou comprar|comprarei|vou quitar|quitarei|vamos gastar|vamos comprar/;

var ENTRADA = /receita|\brecebi\b|recebimento|\ba receber\b|vou receber|vao receber|receberei|\bentrou\b|vai entrar|\bcaiu\b|vai cair|\bganhei\b|salario|rendimento|reembolso|estorno|depositaram|sera depositado|me pagaram|vao me pagar|me pagarao|creditado/;

var TRANSFERENCIA = /transferenc|transferir|transferi\b|transfiro|transferido|transferida/;

var OBJETIVO_ENTRA = /\bapliquei\b|\baplicar\b|\baplica[çc][ãa]o\b|\baplicacao\b|\bguardei\b|\bguardar\b|\bpoupei\b|\bpoupar\b|\bjuntei\b|\bjuntar\b|\bseparei\b|\bseparar\b/;

var OBJETIVO_SAI = /\bresgatei\b|\bresgatar\b|\bresgate\b|\btirei\b|\btirar\b|\bretirei\b|\bretirar\b|\bsaquei\b|\bsacar\b/;

var DIZ_OBJETIVO = /\bobjetivos?\b/;

var DIVIDE = /\bdividid[oa]s?\b|\bdividi\b|\bdividir\b|\bdivide\b|\bdividindo\b|\brachei\b|\brachar\b|\brachad[oa]s?\b|\brachando\b/;

var RE_REPETE_TEXTO = /\b(?:quinzenal(?:mente)?|trimestral(?:mente)?|anual(?:mente)?|mensal(?:mente)?|todos?\s+os?\s+(?:m[eê]s(?:es)?|anos?)|todo\s+(?:m[eê]s|ano)|a\s+cada\s+(?:15|quinze)\s+dias|a\s+cada\s+(?:3|tr[eê]s)\s+meses|a\s+cada\s+(?:m[eê]s|ano))\b/gi;

var RE_QUANTAS_VEZES = /\b(?:por|durante|pelos|pelas)\s+(\d{1,2}|um|uma|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|dezoito|vinte|trinta)\s*(?:m[eê]s(?:es)?|vezes|anos?|ocorr[eê]ncias?|quinzenas?|trimestres?)\b/i;

var RE_PARCELA = /^(.*?)\s*-\s*Parcela\s+(\d+)\/(\d+)$/i;

var RE_PARCELA_DE = /\b(\d{1,2}|[a-z]+)\s*(?:x|vezes|parcelas?)\s+de\s+(?:r\$\s*)?([\d.]+(?:,\d{1,2})?)/;

var RE_PARCELA_EM = /\b(?:em|de)\s*(\d{1,2}|[a-z]+)\s*(?:x|vezes|parcelas?)\b/;

var RE_PARCELA_X = /\b(\d{1,2})\s*x\b/;

var MIN_LOJISTA = 5;

var GENERICO_LOJISTA = /^(a|as|o|os)?\s*lojas?\s+(d[aeo]s?|de)?\s*/;

function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function monthKey(vm) { return vm.y + "-" + String(vm.m + 1).padStart(2, "0"); }

function adicionarDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function adicionarMeses(d, n) {
    var dia = d.getDate();
    var alvo = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(dia, ultimo));
    return alvo;
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

function faturaPelaData(dataIso, card) {
    var p = resolveInvoicePeriodFromDate(dataIso, card);
    if (new Date(dataIso + "T00:00:00").getDate() === card.fechamento) {
      var d = adicionarMeses(new Date(p.y, p.m, 1), 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    }
    return p;
  }

function depoisDaVirada(p, dataIso, card) {
    var viradas = card.viradas || {};
    for (var guarda = 0; guarda < 24; guarda++) {
      var virada = viradas[monthKey(p)];
      if (!virada || dataIso < virada) return p;
      var d = adicionarMeses(new Date(p.y, p.m, 1), 1);
      p = { y: d.getFullYear(), m: d.getMonth() };
    }
    return p;
  }

function faturaSugerida(dataIso, card) {
    return depoisDaVirada(faturaPelaData(dataIso, card), dataIso, card);
  }

function diaValido(y, m, dia) { return Math.min(dia, new Date(y, m + 1, 0).getDate()); }

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

function dataDeHoje() { return new Date(); }

function normalizarNome(s) {
    return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

function filhasDe(id, categorias) {
    return (categorias || state.categories).filter(function (c) { return c.paiId === id; });
  }

function temFilhas(id, categorias) { return filhasDe(id, categorias).length > 0; }

function categoriasLancaveis(tipo, categorias) {
    var lista = categorias || state.categories;
    return lista.filter(function (c) { return c.tipo === tipo && !temFilhas(c.id, lista); });
  }

function chaveDeTexto(s) {
    return normalizarNome(s).replace(/[^a-z0-9]+/g, "");
  }

function lojistaDoHistorico(desc) {
    var s = String(desc || "").trim();
    var m = s.match(RE_PARCELA);
    return (m ? m[1] : s).trim();
  }

function chaveDeLojista(desc) {
    var nome = normalizarNome(lojistaDoHistorico(desc));
    var curta = chaveDeTexto(nome.replace(GENERICO_LOJISTA, ""));
    return curta.length >= MIN_LOJISTA ? curta : chaveDeTexto(nome);
  }

function chavesDeLojista(desc) {
    var inteira = chaveDeTexto(lojistaDoHistorico(desc));
    var curta = chaveDeLojista(desc);
    return curta === inteira ? [curta] : [curta, inteira];
  }

function regraDoLojista(regras, desc) {
    var chaves = chavesDeLojista(desc).filter(Boolean);
    if (!chaves.length) return null;
    var melhor = null;
    (regras || []).forEach(function (r) {
      if (!r || !r.lojista) return;
      var casa = chaves.some(function (k) { return k.indexOf(r.lojista) === 0; });
      if (!casa) return;
      if (!melhor || r.lojista.length > melhor.lojista.length) melhor = r;
    });
    return melhor;
  }

function regraParaDigitado(regras, texto) {
    var k = chaveDeLojista(texto);
    if (k.length < MIN_LOJISTA) return null;

    // O texto já contém a regra inteira: é o mesmo casamento da importação, e
    // a mais específica vence.
    var pronta = regraDoLojista(regras, texto);
    if (pronta) return pronta;

    var comecam = (regras || []).filter(function (r) {
      return r && r.lojista && r.lojista.indexOf(k) === 0;
    });
    if (!comecam.length) return null;
    var categorias = {};
    comecam.forEach(function (r) { categorias[r.categoriaId] = true; });
    return Object.keys(categorias).length === 1 ? comecam[0] : null;
  }

function normalizarFala(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

function valorPorExtenso(texto) {
    var palavras = texto.split(/[\s,]+/).filter(function (p) { return p in NUMERO_PALAVRA || p === "e"; });
    if (!palavras.length) return null;
    var total = 0, parcial = 0, viu = false;
    palavras.forEach(function (p) {
      if (p === "e") return;
      var n = NUMERO_PALAVRA[p];
      viu = true;
      if (n === 1000) { total += (parcial || 1) * 1000; parcial = 0; }
      else parcial += n;
    });
    return viu ? total + parcial : null;
  }

function numeroBR(bruto) {
    var s = String(bruto).replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

function comMil(n, depois) {
    return /^\s*mil\b/.test(depois) ? n * 1000 : n;
  }

function valorDaFala(texto) {
    var marcado = new RegExp(
      "(?:r\\$|brl)\\s*(" + MOEDA + ")(\\s*mil\\b)?|" +
      "(" + MOEDA + ")\\s*(mil\\s*)?(?:reais|real|brl|conto|contos|pila)|" +
      "(?:valor|quantia|total)\\s*(?:de|em)?\\s*(" + MOEDA + ")(\\s*mil\\b)?"
    );
    var m = texto.match(marcado);
    if (m) {
      // Qual grupo casou depende de qual das três formas apareceu; o "mil"
      // vem logo depois do número em todas elas.
      var bruto = m[1] || m[3] || m[5];
      var mil = m[2] || m[4] || m[6];
      var n = numeroBR(bruto);
      return n === null ? null : (mil ? n * 1000 : n);
    }
    var extenso = texto.match(/([a-z\s]+?)\s*(?:reais|real)\b/);
    if (extenso) {
      var v = valorPorExtenso(extenso[1]);
      if (v) return v;
    }
    // Último recurso: um número solto que não seja ano, dia do mês nem prazo.
    //
    // O descarte olha a VIZINHANÇA de cada ocorrência, não o valor solto. Antes
    // ele procurava o número no texto inteiro, e em "daqui 10 dias 10 BRL" o
    // segundo 10 era descartado pelo prazo do primeiro: dois números iguais,
    // um só destino. Foi assim que "10 reais" virou "valor não identificado".
    var procura = new RegExp("\\b(?:" + MOEDA + ")", "g");
    var achado;
    while ((achado = procura.exec(texto)) !== null) {
      var palavra = achado[0];
      var valor = numeroBR(palavra);
      if (valor === null) continue;
      var antes = texto.slice(Math.max(0, achado.index - 20), achado.index);
      var depois = texto.slice(achado.index + palavra.length, achado.index + palavra.length + 14);
      if (/^\d{4}$/.test(palavra) && valor > 1900 && valor < 2100) continue;   // ano
      if (/\bdia\s*$/.test(antes)) continue;                                   // "dia 12"
      // A data escrita em números não é dinheiro, de nenhum dos dois lados:
      // em "28/10/2026 de 83,99" o valor é 83,99, e sem isto era 28.
      if (/[/-]\s*$/.test(antes)) continue;                                    // "28/10": o 10
      if (/^\s*[/-]\s*\d/.test(depois)) continue;                              // "28/10": o 28
      // Prazo é "10 dias" — a unidade sozinha. Seguida de número ela é uma
      // DATA ("83,99 dia 28"), e descartar aí fazia o valor sumir da frase.
      if (/^\s*(?:dias?|semanas?|mes(?:es)?|anos?)\b(?!\s*\d)/.test(depois)) continue;   // prazo
      return comMil(valor, depois);
    }
    return null;
  }

function quantidadeDita(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return NUMERO_PALAVRA[s] || 0;
  }

function parcelamentoDaFala(texto, valorLido) {
    var m = texto.match(RE_PARCELA_DE);
    if (m) {
      var nDe = quantidadeDita(m[1]);
      var parcela = numeroBR(m[2]);
      if (nDe >= 2 && nDe <= 60 && parcela) {
        // Aqui a parcela foi DITA, então o total é consequência: não há
        // divisão para sair torta.
        return { quantidade: nDe, parcela: parcela, total: Math.round(parcela * nDe * 100) / 100 };
      }
      return null;
    }
    m = texto.match(RE_PARCELA_EM) || texto.match(RE_PARCELA_X);
    if (!m || !valorLido) return null;
    var n = quantidadeDita(m[1]);
    if (n < 2 || n > 60) return null;
    var cada = Math.round((valorLido * 100) / n) / 100;
    var total = Math.round(cada * n * 100) / 100;
    /* R$ 20,00 em 3x dá 6,666...: parcelas iguais de 6,67 somam 20,01, um
     * centavo a mais do que a pessoa disse. O cartão de verdade resolve
     * fazendo a última parcela diferente, e a série deste app tem um valor
     * só — então o jeito honesto é FALAR do centavo, em vez de mostrar um
     * total que não é o dito e deixar quem lê descobrir sozinho. */
    return { quantidade: n, parcela: cada, total: total, dito: valorLido, exato: total === valorLido };
  }

function mesPorNome(nome) {
    var alvo = normalizarFala(nome);
    for (var i = 0; i < MESES.length; i++) {
      if (normalizarFala(MESES[i]) === alvo) return i;
    }
    return -1;
  }

function escaparRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function posicaoDaPalavra(texto, termo, aPartirDe) {
    if (!termo) return -1;
    var re = new RegExp("(^|[^a-z0-9])(" + escaparRegex(termo) + ")([^a-z0-9]|$)", "g");
    re.lastIndex = aPartirDe || 0;
    var m = re.exec(texto);
    return m ? m.index + m[1].length : -1;
  }

function acharPorNome(lista, texto) {
    var achado = null, tamanho = 0;
    lista.forEach(function (item) {
      var nome = normalizarFala(item.nome);
      if (nome.length > tamanho && posicaoDaPalavra(texto, nome) >= 0) { achado = item; tamanho = nome.length; }
    });
    if (achado) return achado;
    lista.forEach(function (item) {
      normalizarFala(item.nome).split(/\s+/).forEach(function (palavra) {
        if (palavra.length >= 4 && palavra.length > tamanho && posicaoDaPalavra(texto, palavra) >= 0) {
          achado = item; tamanho = palavra.length;
        }
      });
    });
    return achado;
  }

function falaDeFuturo(texto) {
    return FUTURO.test(texto) ||
      /amanh[ãa]|vou lan[çc]ar|pretendo|semana que vem|proxima semana|mes que vem|proximo mes|ano que vem|daqui|dentro de|em \d+ dias|vence|vencimento/.test(texto);
  }

function dataDaFala(texto, agora) {
    // Sem zerar a hora, "pagarei dia 20" dito no próprio dia 20 cairia no mês
    // seguinte: a data do dia 20 à meia-noite é "menor" que agora.
    var hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    function iso(d) { return isoDate(d); }
    function comDia(y, m, dia) {
      return new Date(y, m, Math.min(dia, new Date(y, m + 1, 0).getDate()));
    }
    function quantidade(trecho) {
      var n = trecho.match(/\d+/);
      if (n) return parseInt(n[0], 10);
      var p = valorPorExtenso(trecho);
      return p || 1;
    }

    if (/anteontem/.test(texto)) return iso(adicionarDias(hoje, -2));
    if (/ontem/.test(texto)) return iso(adicionarDias(hoje, -1));
    if (/depois de amanh[ãa]/.test(texto)) return iso(adicionarDias(hoje, 2));
    if (/amanh[ãa]/.test(texto)) return iso(adicionarDias(hoje, 1));
    if (/\bhoje\b/.test(texto)) return iso(hoje);

    /* A data escrita em números — "28/10/2026", "28/10", "28-10". Ela vence
     * todo o resto porque não tem o que interpretar. Sem ela, "despesa na
     * data de 28/10 no cartão" nascia HOJE, e no cartão isso é pior do que
     * uma data errada: muda a fatura em que a compra cai.
     *
     * Dois dígitos de ano são 20xx; nenhum escolhe a ocorrência mais perto de
     * hoje, como o mês por extenso faz. Mês fora de 1–12 não é data: "3/4 do
     * valor" não vira 3 de abril. */
    var mNum = texto.match(/\b(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*(\d{2}|\d{4}))?(?!\d)/);
    if (mNum && +mNum[2] >= 1 && +mNum[2] <= 12 && +mNum[1] >= 1 && +mNum[1] <= 31) {
      var dN = +mNum[1], mN = +mNum[2] - 1;
      if (mNum[3]) {
        var aN = +mNum[3];
        return iso(comDia(aN < 100 ? 2000 + aN : aN, mN, dN));
      }
      var perto = [-1, 0, 1].map(function (k) { return comDia(hoje.getFullYear() + k, mN, dN); });
      if (falaDeFuturo(texto)) perto = perto.filter(function (d) { return d >= hoje; });
      perto.sort(function (a, b) { return Math.abs(a - hoje) - Math.abs(b - hoje); });
      return iso(perto[0]);
    }

    // "daqui a 3 dias" e "daqui 3 dias" são a mesma frase na boca das pessoas;
    // "uns/umas" é só arredondamento falado e não muda a conta.
    var mPrazo = texto.match(/(?:daqui(?:\s+a)?|em|dentro de)\s+(?:uns\s+|umas\s+)?([a-z0-9\s]{1,18}?)\s*(dias?|semanas?|mes(?:es)?)\b/);
    if (mPrazo) {
      var q = quantidade(mPrazo[1]);
      if (/dia/.test(mPrazo[2])) return iso(adicionarDias(hoje, q));
      if (/semana/.test(mPrazo[2])) return iso(adicionarDias(hoje, q * 7));
      return iso(adicionarMeses(hoje, q));
    }
    if (/semana que vem|proxima semana/.test(texto)) return iso(adicionarDias(hoje, 7));

    // "dia 5 do mês que vem" precisa do dia antes de decidir o mês.
    var mesSeguinte = /mes que vem|proximo mes/.test(texto);
    var mDiaMes = texto.match(/dia (\d{1,2})(?:\s*de\s*([a-z]+))?/) || texto.match(/\b(\d{1,2})\s*de\s*([a-z]+)/);
    var anoDito = texto.match(/\b(20\d{2})\b/);

    if (mDiaMes) {
      var dia = parseInt(mDiaMes[1], 10);
      var mesNome = mDiaMes[2] ? mesPorNome(mDiaMes[2]) : -1;
      if (mesNome >= 0) {
        if (anoDito) return iso(comDia(parseInt(anoDito[1], 10), mesNome, dia));
        // Sem ano: escolhe entre o ano passado, este e o que vem o que cair
        // mais perto de hoje — e nunca para trás quando a frase é de futuro.
        var candidatos = [-1, 0, 1].map(function (d) { return comDia(hoje.getFullYear() + d, mesNome, dia); });
        if (falaDeFuturo(texto)) candidatos = candidatos.filter(function (d) { return d >= hoje; });
        candidatos.sort(function (a, b) { return Math.abs(a - hoje) - Math.abs(b - hoje); });
        return iso(candidatos[0]);
      }
      var base = mesSeguinte ? adicionarMeses(hoje, 1) : hoje;
      var d1 = comDia(base.getFullYear(), base.getMonth(), dia);
      // "Pagarei dia 5" no dia 20 é o dia 5 do mês que vem.
      if (!mesSeguinte && falaDeFuturo(texto) && d1 < hoje) d1 = comDia(
        base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear(),
        (base.getMonth() + 1) % 12, dia);
      return iso(d1);
    }
    if (mesSeguinte) return iso(adicionarMeses(hoje, 1));

    if (/fim do mes|final do mes/.test(texto)) {
      return iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0));
    }

    var mSemana = texto.match(/(?:proxima|proximo|na|no)\s+(domingo|segunda|terca|quarta|quinta|sexta|sabado)/);
    if (mSemana) {
      var alvo = DIAS_SEMANA[mSemana[1]];
      var passos = (alvo - hoje.getDay() + 7) % 7;
      if (passos === 0) passos = 7;                       // "na sexta" nunca é hoje
      return iso(adicionarDias(hoje, passos));
    }
    return null;
  }

function formaDePagamentoDaFala(texto) {
    if (TERMOS_CONTA.test(texto)) return "conta";
    if (TERMOS_CARTAO.test(texto)) return "cartao";
    return null;
  }

function contasNaOrdemDaFala(texto, ctx) {
    ctx = ctx || contextoDaFala();
    var contas = ctx.contas.filter(function (a) { return a.isActive !== false; });
    var achados = [];
    var jaTem = function (id) { return achados.some(function (x) { return x.conta.id === id; }); };

    contas.forEach(function (a) {
      var nome = normalizarFala(a.nome);
      if (!nome) return;
      // TODAS as ocorrências, não só a primeira: quem diz "do Nubank para o
      // Nubank" disse a mesma conta duas vezes, e o app precisa poder dizer
      // isso em vez de fingir que não entendeu a segunda.
      for (var i = posicaoDaPalavra(texto, nome); i >= 0; i = posicaoDaPalavra(texto, nome, i + nome.length)) {
        achados.push({ conta: a, posicao: i, forte: true });
      }
    });
    contas.forEach(function (a) {
      if (jaTem(a.id)) return;
      var melhor = -1;
      normalizarFala(a.nome).split(/\s+/).forEach(function (palavra) {
        if (palavra.length < 4 || PALAVRAS_DE_ESTRUTURA.indexOf(palavra) >= 0) return;
        var i = posicaoDaPalavra(texto, palavra);
        if (i >= 0 && (melhor < 0 || i < melhor)) melhor = i;
      });
      if (melhor >= 0) achados.push({ conta: a, posicao: melhor, forte: false });
    });

    return achados.sort(function (x, y) { return x.posicao - y.posicao; })
      .map(function (x) { return x.conta; });
  }

function destinoDaFala(texto, ctx) {
    ctx = ctx || contextoDaFala();
    var contasAtivas = ctx.contas.filter(function (a) { return a.isActive; });
    var cartao = acharPorNome(ctx.cartoes, texto);
    var conta = acharPorNome(contasAtivas, texto);
    var forma = formaDePagamentoDaFala(texto);

    if (forma === "cartao") {
      var k = cartao ||
        (conta ? ctx.cartoes.filter(function (x) { return x.contaId === conta.id; })[0] : null) ||
        (!cartao && !conta && ctx.cartoes.length === 1 ? ctx.cartoes[0] : null);
      return k ? { forma: forma, cartaoId: k.id } : { forma: forma };
    }
    if (forma === "conta") {
      var c = conta ||
        (cartao && cartao.contaId ? byId(contasAtivas, cartao.contaId) : null) ||
        (!cartao && !conta && contasAtivas.length === 1 ? contasAtivas[0] : null);
      return c ? { forma: forma, contaId: c.id } : { forma: forma };
    }
    // Sem forma dita, quem manda é o nome. O do cartão tem preferência por ser
    // mais específico: "Nubank Roxinho" diz mais que "Nubank".
    if (cartao) return { forma: null, cartaoId: cartao.id };
    if (conta) return { forma: null, contaId: conta.id };
    return { forma: null };
  }

function semPontuacao(s) {
    return String(s || "").replace(/^[^0-9A-Za-zÀ-ÿ]+/, "").replace(/[^0-9A-Za-zÀ-ÿ]+$/, "");
  }

function palavrasDeCadastroNaFala(texto, ctx) {
    ctx = ctx || contextoDaFala();
    var fora = {};
    [ctx.contas, ctx.cartoes, ctx.categorias].forEach(function (lista) {
      lista.forEach(function (item) {
        var nome = normalizarFala(item.nome || "");
        if (!nome) return;
        var inteiro = posicaoDaPalavra(texto, nome) >= 0;
        nome.split(/\s+/).forEach(function (p) {
          if (p && (inteiro || (p.length >= 4 && posicaoDaPalavra(texto, p) >= 0))) fora[p] = true;
        });
      });
    });
    return fora;
  }

function trechosDaFala(frase, texto, ctx) {
    var doCadastro = palavrasDeCadastroNaFala(texto, ctx);
    var trechos = [], atual = null, aposForma = false, depoisDe = "", ligacaoAntes = "";
    String(frase || "").split(/\s+/).forEach(function (bruta) {
      var palavra = semPontuacao(bruta);
      var chave = normalizarFala(palavra);
      // Número escrito por extenso conta como número: "em DOIS dias" é data,
      // não nome de lugar. Sem isto sobrava o trecho "em dois", que tem duas
      // palavras e vencia "na padaria", de uma — e a descrição virava "Dois".
      // "um" e "uma" ficam de fora: neste tipo de frase eles são artigo
      // ("comprei uma pizza") muito mais vezes do que quantidade, e como
      // ligação eles são aparados das pontas em vez de cortar o trecho.
      var porExtenso =
        NUMERO_PALAVRA[chave] !== undefined && LIGACAO_DA_FALA.indexOf(chave) < 0;
      // Número COMEÇANDO a palavra: "40", "3x", "12/09" são conta da frase.
      // Dígito no meio ou no fim não tira a palavra do nome — "C6 Bank" e
      // "Casa 3D" são nomes, e cortá-los deixava "Bank" sozinho, que é o
      // cartão de outra pessoa.
      var usada = !chave || /^\d/.test(chave) || porExtenso || doCadastro[chave] === true ||
        COMANDO_DA_FALA.indexOf(chave) >= 0 || mesPorNome(chave) >= 0 ||
        DIAS_SEMANA[chave] !== undefined;
      if (usada) {
        // A ligação logo antes da palavra que fecha o pedaço vai junto: é ela
        // que separa "DA conta PicPay" (o lugar de onde o dinheiro sai) de
        // "A conta de luz" (o que foi pago). As duas têm a palavra "conta" na
        // mesma posição, e sem a preposição elas são indistinguíveis.
        ligacaoAntes = atual && atual.palavras.length
          ? atual.palavras[atual.palavras.length - 1].chave
          : "";
        if (atual) trechos.push(atual);
        atual = null;
        aposForma = FORMA_DA_FALA.indexOf(chave) >= 0;
        depoisDe = chave;
        return;
      }
      if (!atual) {
        atual = { palavras: [], aposForma: aposForma, depoisDe: depoisDe, ligacaoAntes: ligacaoAntes };
      }
      atual.palavras.push({ palavra: palavra, chave: chave });
    });
    if (atual) trechos.push(atual);
    return trechos;
  }

function cortarLigacoes(lista) {
    var i = 0, f = lista.length;
    while (i < f && LIGACAO_DA_FALA.indexOf(lista[i].chave) >= 0) i++;
    while (f > i && LIGACAO_DA_FALA.indexOf(lista[f - 1].chave) >= 0) f--;
    return lista.slice(i, f);
  }

function nomeDoTrecho(corte) {
    var t = corte.map(function (x) { return x.palavra; }).join(" ").slice(0, 60).trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

function categoriaDaFala(frase, texto, ctx) {
    ctx = ctx || contextoDaFala();
    var achado = "";
    trechosDaFala(frase, texto, ctx).forEach(function (trecho) {
      if (achado || trecho.depoisDe !== "categoria") return;
      var corte = cortarLigacoes(trecho.palavras);
      // O mesmo piso da descrição: uma letra solta não é o nome de nada.
      if (!corte.some(function (x) { return x.chave.length >= 3; })) return;
      achado = nomeDoTrecho(corte);
    });
    return achado;
  }

function contaDaFala(frase, texto, ctx) {
    ctx = ctx || contextoDaFala();
    // A varredura roda SEM os cartões, e isso é o miolo da coisa: PicPay é
    // cartão e é conta, e quem diz "no débito DA CONTA PicPay" está falando
    // da conta. Com os cartões na lista, o nome era consumido como cadastro
    // conhecido, não sobrava pedaço nenhum depois de "conta", e a pessoa só
    // recebia "faltou destino" — com o PICPAY dela aparecendo na lista de
    // cartões da própria resposta.
    var semCartoes = {
      contas: ctx.contas, cartoes: [], categorias: ctx.categorias,
      regras: ctx.regras, hoje: ctx.hoje
    };
    var achado = "";
    trechosDaFala(frase, texto, semCartoes).forEach(function (trecho) {
      if (achado || ANUNCIA_CONTA.indexOf(trecho.depoisDe) < 0) return;
      // "conta corrente PicPay": quem anuncia é "corrente", e a preposição
      // ficou lá atrás, antes de "conta". Nesses casos a própria palavra já
      // diz que é conta, e não há o que confundir com pagar uma conta.
      var precisaDePreposicao = trecho.depoisDe === "conta" || trecho.depoisDe === "contas";
      if (precisaDePreposicao && PREPOSICAO_DE_LUGAR.indexOf(trecho.ligacaoAntes) < 0) return;
      var corte = cortarLigacoes(trecho.palavras);
      if (!corte.some(function (x) { return x.chave.length >= 3; })) return;
      achado = nomeDoTrecho(corte);
    });
    return achado;
  }

function cartaoDaFala(frase, texto, ctx) {
    ctx = ctx || contextoDaFala();
    // A varredura roda sem as CONTAS, pelo motivo espelhado do `contaDaFala`:
    // PicPay é conta e é cartão, e quem diz "no CARTÃO PicPay" está falando
    // do cartão.
    var semContas = {
      contas: [], cartoes: ctx.cartoes, categorias: ctx.categorias,
      regras: ctx.regras, hoje: ctx.hoje
    };
    var achado = "";
    trechosDaFala(frase, texto, semContas).forEach(function (trecho) {
      if (achado || ANUNCIA_CARTAO.indexOf(trecho.depoisDe) < 0) return;
      if (PREPOSICAO_DE_LUGAR.indexOf(trecho.ligacaoAntes) < 0) return;
      var corte = cortarLigacoes(trecho.palavras);
      if (!corte.some(function (x) { return x.chave.length >= 2; })) return;
      achado = nomeDoTrecho(corte);
    });
    return achado;
  }

function descricaoDaFala(frase, texto, ctx, semDestino) {
    ctx = ctx || contextoDaFala();
    var melhor = null;
    trechosDaFala(frase, texto, ctx).forEach(function (trecho) {
      // "no crédito do Fulano" com Fulano fora do cadastro: o destino ficou
      // "não identificado", e essa palavra é o banco que a pessoa disse — não
      // o que ela comprou. Chamá-la de descrição guardaria o erro com nome de
      // compra. Com o destino achado a mesma palavra já saiu por outro
      // caminho, e este corte não tem o que cortar.
      if (semDestino && trecho.aposForma) return;
      var corte = cortarLigacoes(trecho.palavras);
      // Uma letra solta não é o nome de nada, e "ok" no meio da frase também
      // não: sem este piso, qualquer ruído do microfone viraria descrição.
      if (!corte.some(function (x) { return x.chave.length >= 3; })) return;
      if (!melhor || corte.length > melhor.length) melhor = corte;
    });
    return melhor ? nomeDoTrecho(melhor) : "";
  }

function transferenciaDaFala(texto, frase, r, ctx) {
    ctx = ctx || contextoDaFala();
    r.transferencia = true;
    r.tipo = "TRANSFER";
    r.categoriaId = null;
    r.contaId = null;
    r.cartaoId = null;
    r.faltando = [];

    r.valor = valorDaFala(texto);
    if (!r.valor) r.faltando.push("valor");

    var contas = contasNaOrdemDaFala(texto, ctx);
    r.deId = contas[0] ? contas[0].id : null;
    r.paraId = contas[1] ? contas[1].id : null;
    if (!r.deId) r.faltando.push("conta de origem");
    if (!r.paraId) r.faltando.push("conta de destino");

    var hoje = ctx.hoje;
    r.data = dataDaFala(texto, hoje) || isoDate(hoje);
    if (PASSADO.test(texto)) r.confirmada = true;
    if (FUTURO.test(texto)) r.confirmada = false;
    if (r.data > isoDate(hoje)) r.confirmada = false;

    // "descrição X" manda, por ser o pedido explícito; sem ele, o que sobrou
    // da frase vira a descrição.
    var mDescT = frase.match(/descri[çc][ãa]o\s+(.+)$/i);
    r.desc = mDescT ? mDescT[1].trim().slice(0, 60) : descricaoDaFala(frase, texto, ctx);
    return r;
  }

function objetivoDaFalaCitado(texto, ctx) {
    return acharPorNome(ctx.objetivos || [], texto);
  }

function movimentoDeObjetivoNaFala(texto, ctx) {
    var sai = OBJETIVO_SAI.test(texto);
    var entra = OBJETIVO_ENTRA.test(texto);
    if (!sai && !entra) return null;
    // Com as duas listas na mesma frase manda a de saída: "resgatei para
    // guardar em outro" tira de um objetivo.
    var tipo = sai ? "WITHDRAW" : "DEPOSIT";
    var alvo = objetivoDaFalaCitado(texto, ctx);
    if (!alvo && !DIZ_OBJETIVO.test(texto)) return null;
    return { tipo: tipo, objetivo: alvo || null };
  }

function objetivoDaFala(texto, frase, r, ctx, achado) {
    ctx = ctx || contextoDaFala();
    r.objetivo = true;
    r.tipo = "GOAL";
    r.movimento = achado.tipo;
    r.categoriaId = null;
    r.cartaoId = null;
    r.faltando = [];

    r.valor = valorDaFala(texto);
    if (!r.valor) r.faltando.push("valor");

    r.objetivoId = achado.objetivo ? achado.objetivo.id : null;
    /* Concluído não recebe mais aplicação — resgatar dele continua valendo,
     * senão o dinheiro ficaria preso em algo que já terminou. Não entra em
     * `faltando` porque nada falta: a frase foi entendida inteira, e o que
     * há é um impedimento. Quem mostra decide a palavra. */
    r.objetivoConcluido = !!(achado.objetivo && achado.objetivo.concluidoEm && r.movimento === "DEPOSIT");
    if (!r.objetivoId) {
      r.faltando.push("objetivo");
      // O nome dito que não é de nenhum objetivo existente. Quem lê não cria
      // nada: só diz o que ouviu, e quem recebe decide o que fazer.
      var dito = categoriaDaFala(frase, texto, ctx);
      if (dito) r.objetivoDito = dito;
    }

    /* De qual conta sai (ou para qual volta). Três tentativas, nesta ordem:
     * a conta DITA na frase; a conta sugerida do objetivo; e, com uma conta
     * só cadastrada, ela. A sugestão do objetivo vem antes do atalho da
     * conta única porque é uma escolha que a pessoa já fez. */
    var ativas = (ctx.contas || []).filter(function (a) { return a.isActive !== false; });
    var dita = acharPorNome(ativas, texto);
    r.contaId = dita ? dita.id
      : (achado.objetivo && achado.objetivo.contaId ? achado.objetivo.contaId
        : (ativas.length === 1 ? ativas[0].id : null));
    if (!r.contaId) r.faltando.push("conta");

    var hoje = ctx.hoje;
    r.data = dataDaFala(texto, hoje) || isoDate(hoje);
    // Movimento de objetivo não tem "previsto": ele acontece quando acontece.
    r.confirmada = true;

    var mDescO = frase.match(/descri[çc][ãa]o\s+(.+)$/i);
    r.desc = mDescO ? mDescO[1].trim().slice(0, 60) : "";
    return r;
  }

function pessoaDaDivisao(nome, ctx) {
    var alvo = normalizarFala(nome);
    var lista = (ctx && ctx.pessoas) || [];
    var exata = null;
    lista.forEach(function (p) { if (!exata && normalizarFala(p.nome) === alvo) exata = p; });
    return exata || acharPorNome(lista, alvo) || null;
  }

function parteDaDivisao(palavras) {
    var percent = null, valor = null;
    var sobrou = [];
    /* O texto vem da palavra CRUA, e não da `chave`: `semPontuacao` tira o
     * sinal das pontas, e "40%" chega aqui como "40" — o percentual virava
     * valor, e a parte da pessoa passava de 40% para R$ 40,00. */
    var textoDoPedaco = palavras.map(function (x) { return normalizarFala(x.bruta); }).join(" ");
    var mPct = textoDoPedaco.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por cento)/);
    if (mPct) percent = numeroBR(mPct[1]);
    palavras.forEach(function (x) {
      // Qualquer palavra com dígito é número desta parte, não nome: "50",
      // "50%", "R$50". Nome de gente não tem dígito.
      if (/\d/.test(x.chave) || x.chave === "%" || x.chave === "r$") return;
      sobrou.push(x);
    });
    if (percent === null) {
      var semPct = textoDoPedaco.replace(/\s*(?:%|por cento)/g, " ");
      valor = valorDaFala(semPct);
    }
    var corte = cortarLigacoes(sobrou);
    return { nome: nomeDoTrecho(corte), valor: valor || null, percent: percent };
  }

function divisaoDaFala(frase, texto, ctx) {
    ctx = ctx || contextoDaFala();
    if (!DIVIDE.test(texto)) return null;

    var brutas = String(frase || "").split(/\s+/).filter(Boolean);
    var palavras = brutas.map(function (b) {
      return { bruta: b, palavra: semPontuacao(b), chave: normalizarFala(semPontuacao(b)),
               virgula: /[,;]$/.test(b) };
    });

    var v = -1;
    for (var i = 0; i < palavras.length; i++) {
      if (DIVIDE.test(palavras[i].chave)) { v = i; break; }
    }
    if (v < 0) return null;

    // Onde a lista de gente começa: no "com" que vem depois do verbo. Sem
    // ele não há com quem dividir — e é aí que a conversa pergunta.
    var inicio = -1, fim = palavras.length;
    for (var j = v + 1; j < palavras.length; j++) {
      if (FIM_DA_DIVISAO.indexOf(palavras[j].chave) >= 0 || mesPorNome(palavras[j].chave) >= 0 ||
          DIAS_SEMANA[palavras[j].chave] !== undefined) { fim = j; break; }
      if (inicio < 0 && palavras[j].chave === "com") inicio = j + 1;
    }
    /* Sem "com", isto não é divisão nenhuma: "comprei 20 DIVIDIDO EM 3
     * parcelas" é parcelamento, e a palavra é a mesma. Devolver "faltou
     * pessoa" aqui tirava o "dividido em 3 parcelas" da frase e a compra
     * perdia as parcelas -- medido pelo teste da fala, que já cobria essa
     * frase antes de esta leitura existir. */
    if (inicio < 0) return null;
    // Com "com" e sem ninguém depois, a pergunta é legítima: "dividido com"
    // quem? Aí a frase É de divisão, e falta a pessoa.
    if (inicio >= fim) {
      return { modo: "IGUAL", participantes: [], novas: [], faltando: ["pessoa"],
               resto: brutas.slice(0, v).concat(brutas.slice(fim)).join(" ") };
    }

    // A lista parte em "e" e em vírgula: "a Ana, o João e a Maria".
    var pedacos = [], atual = [];
    for (var k = inicio; k < fim; k++) {
      var p = palavras[k];
      if (p.chave === "e") { if (atual.length) { pedacos.push(atual); atual = []; } continue; }
      atual.push(p);
      if (p.virgula && atual.length) { pedacos.push(atual); atual = []; }
    }
    if (atual.length) pedacos.push(atual);

    var participantes = [], novas = [], faltando = [];
    pedacos.forEach(function (pedaco) {
      var parte = parteDaDivisao(pedaco);
      if (!parte.nome) return;
      var pessoa = pessoaDaDivisao(parte.nome, ctx);
      participantes.push({
        pessoaId: pessoa ? pessoa.id : null,
        nome: pessoa ? pessoa.nome : parte.nome,
        valor: parte.valor, percent: parte.percent
      });
      if (!pessoa) novas.push(parte.nome);
    });

    if (!participantes.length) faltando.push("pessoa");

    var comPct = participantes.filter(function (p) { return p.percent !== null; }).length;
    var comValor = participantes.filter(function (p) { return p.valor !== null; }).length;
    var modo = comPct ? "PERCENTUAL" : (comValor ? "VALOR" : "IGUAL");
    // Dito pela metade: parte da gente com número, parte sem.
    if ((comPct && comPct !== participantes.length) ||
        (!comPct && comValor && comValor !== participantes.length)) {
      faltando.push("partes");
    }

    return {
      modo: modo, participantes: participantes, novas: novas, faltando: faltando,
      resto: brutas.slice(0, v).concat(brutas.slice(fim)).join(" ")
    };
  }

function repeticaoDaFala(frase, texto) {
    var freq = null;
    REPETE_FREQ.forEach(function (par) {
      if (!freq && par[0].test(texto)) freq = par[1];
    });
    if (!freq) return null;
    var m = String(frase || "").match(RE_QUANTAS_VEZES);
    var quantas = m ? quantidadeDita(normalizarFala(m[1])) : 0;
    // 2 a 60 é o que o servidor aceita; fora disso é como não ter dito.
    if (!(quantas >= 2 && quantas <= 60)) quantas = 0;
    var resto = String(frase || "")
      .replace(RE_REPETE_TEXTO, " ")
      .replace(RE_QUANTAS_VEZES, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { freq: freq, quantas: quantas, resto: resto };
  }

function interpretarFala(frase, ctx) {
    ctx = ctx || contextoDaFala();
    var texto = normalizarFala(frase).replace(/\s+/g, " ").trim();
    var r = { frase: frase, tipo: "EXPENSE", valor: null, categoriaId: null, contaId: null,
      cartaoId: null, faturaMes: null, data: null, confirmada: false, desc: "", faltando: [] };
    if (!texto) { r.faltando = ["valor", "destino", "categoria"]; return r; }

    // Movimento de objetivo vem ANTES da transferência: "guardei 500 no
    // objetivo viagem" não é conta → conta, e as duas leituras disputariam a
    // palavra "para". Só entra aqui quem tem verbo E objetivo — ver
    // `movimentoDeObjetivoNaFala`.
    var noObjetivo = movimentoDeObjetivoNaFala(texto, ctx);
    if (noObjetivo) return objetivoDaFala(texto, frase, r, ctx, noObjetivo);

    /* A DIVISÃO sai da frase antes de tudo o mais, e o resto segue para a
     * leitura de sempre. Deixá-la na frase faria "Ana" disputar com
     * "mercado" o lugar da descrição — e às vezes ganhar, porque quem ganha
     * é o pedaço maior. Lida e removida, nada mais no app precisa saber que
     * ela existe: destino, categoria, data e parcelas são lidos como sempre. */
    var divisao = divisaoDaFala(frase, texto, ctx);
    if (divisao) {
      frase = divisao.resto;
      texto = normalizarFala(frase).replace(/\s+/g, " ").trim();
      r.frase = divisao.resto;
    }

    /* A repetição FIXA sai da frase pelo mesmo motivo da divisão: "todo mês"
     * ficava na descrição, e o aluguel nascia chamado "Aluguel todo". */
    var repeticao = repeticaoDaFala(frase, texto);
    if (repeticao) {
      frase = repeticao.resto;
      texto = normalizarFala(frase).replace(/\s+/g, " ").trim();
      r.frase = repeticao.resto;
    }

    // Transferência é outro tipo de lançamento, e sai por outro caminho: não
    // tem categoria, não tem cartão, e o que importa é a ORDEM das contas.
    if (TRANSFERENCIA.test(texto)) return transferenciaDaFala(texto, frase, r, ctx);

    if (ENTRADA.test(texto)) r.tipo = "INCOME";
    if (/despesa|gastei|paguei|comprei|pagamento de|gasto/.test(texto) && !ENTRADA.test(texto)) r.tipo = "EXPENSE";

    r.valor = valorDaFala(texto);
    // O parcelamento pode CORRIGIR o valor: em "3x de 30", o primeiro número
    // da frase é a quantidade de parcelas, e é ele que `valorDaFala` acharia.
    var parc = parcelamentoDaFala(texto, r.valor);
    if (parc) {
      r.parcelas = parc.quantidade;
      r.valor = parc.parcela;
      r.valorTotal = parc.total;
      // Só quando houve divisão e ela não fechou: quem disse a parcela
      // ("3x de 20") não tem centavo nenhum para conferir.
      if (parc.exato === false) r.valorDito = parc.dito;
    }
    if (!r.valor) r.faltando.push("valor");

    // Destino: cartão pelo nome, ou a forma de pagamento (débito, pix, dinheiro).
    var destino = destinoDaFala(texto, ctx);
    r.forma = destino.forma;
    r.contaId = destino.contaId || null;
    r.cartaoId = destino.cartaoId || null;

    // O nome de CARTÃO que a frase declarou, pelo mesmo caminho da conta.
    // Cartão não nasce de passagem como ela: ele precisa de fechamento e
    // vencimento, e quem pergunta por eles é o WhatsApp. Aqui só se registra
    // qual cartão foi dito — a tela usa isso para dizer qual não existe.
    if (r.forma === "cartao") {
      var cartaoDito = cartaoDaFala(frase, texto, ctx);
      if (cartaoDito) { r.cartaoDito = cartaoDito; r.cartaoId = null; }
    }

    // O nome de conta que a frase DECLAROU e que não é de nenhuma conta
    // cadastrada. Só quando a forma dita foi conta: num lançamento de cartão
    // o nome que falta é de cartão.
    //
    // E ele MANDA sobre o atalho de "só tenho uma conta": dizer "da conta
    // PicPay" e o lançamento cair no Nubank porque era a única cadastrada é
    // lançar no lugar errado, calado. Nome dito que não existe é destino que
    // falta, e não destino achado.
    if (r.forma === "conta" && !r.cartaoId) {
      var contaDita = contaDaFala(frase, texto, ctx);
      if (contaDita) {
        r.contaDita = contaDita;
        r.contaId = null;
      }
    }
    if (!r.cartaoId && !r.contaId) r.faltando.push("destino");

    // A descrição vem ANTES da categoria, e não por ordem de gosto: é dela
    // que sai o lojista, e é o lojista que lembra a categoria quando a frase
    // não disse nenhuma. Ela não precisa da categoria para ser achada — o que
    // ela descarta são os nomes de TODOS os cadastros citados, o escolhido e
    // os outros.
    //
    // Quem diz "descrição X" está ditando a descrição, e esse pedido ganha de
    // qualquer leitura do resto.
    var mDesc = frase.match(/descri[çc][ãa]o\s+(.+)$/i);
    r.desc = mDesc ? mDesc[1].trim().slice(0, 60)
      : descricaoDaFala(frase, texto, ctx, !r.contaId && !r.cartaoId);

    // Categoria, em duas tentativas. Primeiro o nome dito: quem fala
    // "alimentação" está classificando agora, e isso manda em qualquer
    // memória. Só depois a regra do lojista, que é lembrança — a mesma que o
    // formulário consulta quando se digita a descrição. Na ordem contrária,
    // dizer a categoria em voz alta não adiantaria nada num lojista já
    // conhecido.
    var cat = acharPorNome(categoriasLancaveis(r.tipo, ctx.categorias), texto);
    if (!cat && r.desc) {
      var regra = regraParaDigitado(ctx.regras, r.desc);
      var daRegra = regra ? byId(ctx.categorias, regra.categoriaId) : null;
      // A categoria lembrada tem de servir ao tipo: despesa não vai para
      // categoria de receita, nem com regra mandando. Mesma guarda do
      // formulário.
      var serve = daRegra && categoriasLancaveis(r.tipo, ctx.categorias).some(function (c) { return c.id === daRegra.id; });
      if (serve) { cat = daRegra; r.categoriaDoLojista = true; }
    }
    if (cat) r.categoriaId = cat.id;
    else {
      r.faltando.push("categoria");
      // O nome que a frase DECLAROU e que não é de nenhuma categoria existente.
      // Quem lê a frase não cria nada: ele só diz qual nome foi dito, e quem
      // recebe decide o que fazer com isso — a tela mostra, o WhatsApp
      // pergunta se cria. Criar aqui seria gravar no meio de uma leitura.
      var dita = categoriaDaFala(frase, texto, ctx);
      if (dita) r.categoriaDita = dita;
    }

    // Data: hoje, ontem, amanhã, depois de amanhã, "dia 12", "12 de setembro",
    // "em 3 dias", "semana que vem", "próxima sexta", "fim do mês".
    var hoje = ctx.hoje;
    r.data = dataDaFala(texto, hoje) || isoDate(hoje);

    // Fatura de destino: "fatura de setembro", "fatura de setembro/2026".
    // O `\b` em cada pedaço opcional não é enfeite: sem ele, o "de" de
    // "fatura de DEzembro" era comido como se fosse a preposição, e sobrava
    // "zembro" para procurar na lista de meses. Dezembro era o único mês com
    // esse problema, e caía calado — a fatura só não aparecia no resumo.
    var mFat = texto.match(/fatura(?:\s*d[eo]\b)?(?:\s*mes\b)?(?:\s*d[eo]\b)?\s*([a-z]+)\s*(?:de\s*|\/)?\s*(20\d{2})?/);
    if (r.cartaoId && mFat) {
      var mf = mesPorNome(mFat[1]);
      if (mf >= 0) r.faturaMes = monthKey({ y: mFat[2] ? parseInt(mFat[2], 10) : hoje.getFullYear(), m: mf });
    }
    // Sem fatura dita, vale a MESMA sugestão da tela de lançamento, e não o
    // agrupamento por data. As duas diferem num dia por mês, o do fechamento:
    // pela data, a compra do dia 1 cai na fatura que fecha naquele dia — uma
    // fatura que está fechando agora, e às vezes já fechada. A tela sempre
    // mandou essa compra para a seguinte; a fala mandava para a de trás, e o
    // mesmo gasto ia parar em faturas diferentes conforme a porta usada.
    if (r.cartaoId && !r.faturaMes) {
      var cartaoDoLancamento = byId(ctx.cartoes, r.cartaoId);
      if (cartaoDoLancamento && cartaoDoLancamento.fechamento) {
        r.faturaMes = monthKey(faturaSugerida(r.data, cartaoDoLancamento));
      }
    }

    // Verbo no passado JÁ ACONTECEU: "recebi", "gastei", "comprei" e "paguei"
    // são dinheiro que entrou ou saiu, não promessa. Antes, só a forma de
    // pagamento (pix, débito) confirmava, e "recebi 3.000 de freelance" caía
    // como previsto — o saldo ficava esperando uma confirmação que a frase já
    // tinha dado.
    if (PASSADO.test(texto)) r.confirmada = true;
    // Futuro desmarca, mesmo depois do passado: "recebi o aviso, vou receber
    // dia 10" é promessa.
    if (FUTURO.test(texto)) r.confirmada = false;
    // Compra no cartão nasce confirmada mesmo sem verbo no passado: passar o
    // cartão É o gasto, e "80 no cartão em alimentação" descreve algo que já
    // aconteceu. O mesmo padrão do formulário — indício de futuro ainda
    // desmarca, logo abaixo. Sem isto, a mesma compra nasceria confirmada
    // digitada e prevista falada, que é o app discordando de si mesmo.
    if (r.cartaoId && !FUTURO.test(texto)) r.confirmada = true;
    // Data no futuro manda mais que o verbo: dinheiro que ainda vai sair é
    // previsto, mesmo numa frase como "pago no pix amanhã".
    if (r.data > isoDate(hoje)) r.confirmada = false;

    /* A divisão vai junto do lançamento, e não no lugar dele: o gasto
     * dividido É um gasto — mesmo valor, mesma conta, mesma categoria,
     * mesma fatura. O que a divisão acrescenta é quem deve quanto.
     *
     * Receita não se divide, e a recusa fica aqui em vez de a leitura
     * jogar a divisão fora: "recebi 200 dividido com a Ana" foi entendida
     * inteira, e quem mostra decide a palavra. É a mesma escolha do
     * objetivo concluído. */
    if (divisao) {
      r.divisao = divisao;
      if (r.tipo !== "EXPENSE") r.divisaoEmReceita = true;
      divisao.faltando.forEach(function (f) {
        if (r.faltando.indexOf(f) < 0) r.faltando.push(f);
      });
    }

    if (repeticao) {
      r.repeticao = repeticao;
      // O número é obrigatório, e a falta dele tem nome próprio: "faltou
      // repetição" não diria o que responder.
      if (!repeticao.quantas) r.faltando.push("por quantas vezes");
      /* Parcelar e repetir são duas repetições diferentes na mesma frase:
       * "3x" reparte um valor, "todo mês" repete o valor inteiro. Entendidas
       * as duas, o que há é contradição — e quem mostra decide a palavra. */
      if (r.parcelas >= 2) r.repeticaoEParcela = true;
    }

    return r;
  }

module.exports = { interpretarFala, valorDaFala, chaveDeLojista, lojistaDoHistorico, regraDoLojista, MIN_LOJISTA, normalizarFala, MESES, mesPorNome, categoriasLancaveis, acharPorNome, faturaSugerida, vencimentoDaFatura, monthKey, regraParaDigitado, byId, numeroBR, isoDate };
