// ============================================================
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

var PALAVRAS_DE_ESTRUTURA = ["conta", "contas", "banco", "para", "dinheiro", "valor", "saldo", "corrente"];

var TERMOS_CONTA = /debito|em conta|na conta|da conta|conta corrente|poupanca|dinheiro|especie|\bpix\b|transferencia|\bted\b|\bdoc\b|boleto|carteira/;

var TERMOS_CARTAO = /cartao|credito|fatura|parcelad/;

var PASSADO = /\bpaguei\b|\bpago\b|quitei|\bgastei\b|\bcomprei\b|ja foi|debitado|creditado|\bpix\b|\bdebito\b|confirmad|\brecebi\b|\bcaiu\b|\bentrou\b|\bganhei\b|depositaram|me pagaram|\bveio\b|\btransferi\b|transferido|transferida/;

var FUTURO = /previst|agendad|vai vencer|vai sair|vai cair|vai entrar|\ba pagar\b|\ba receber\b|pagarei|vou pagar|sera pago|receberei|vou receber|vao me pagar|sera creditado|sera depositado|vou gastar|gastarei|vou comprar|comprarei|vou quitar|quitarei|vamos gastar|vamos comprar/;

var ENTRADA = /receita|\brecebi\b|recebimento|\ba receber\b|vou receber|vao receber|receberei|\bentrou\b|vai entrar|\bcaiu\b|vai cair|\bganhei\b|salario|rendimento|reembolso|estorno|depositaram|sera depositado|me pagaram|vao me pagar|me pagarao|creditado/;

var TRANSFERENCIA = /transferenc|transferir|transferi\b|transfiro|transferido|transferida/;

var RE_PARCELA = /^(.*?)\s*-\s*Parcela\s+(\d+)\/(\d+)$/i;

var MIN_LOJISTA = 5;

function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }

function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function monthKey(vm) { return vm.y + "-" + String(vm.m + 1).padStart(2, "0"); }

function adicionarDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function diaValido(y, m, dia) { return Math.min(dia, new Date(y, m + 1, 0).getDate()); }

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
    return chaveDeTexto(lojistaDoHistorico(desc));
  }

function regraDoLojista(regras, desc) {
    var k = chaveDeLojista(desc);
    if (!k) return null;
    var melhor = null;
    (regras || []).forEach(function (r) {
      if (!r || !r.lojista || k.indexOf(r.lojista) !== 0) return;
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

function valorDaFala(texto) {
    var m = texto.match(/(?:r\$|brl)\s*([\d.]+(?:,\d{1,2})?)/) ||
      texto.match(/([\d.]+(?:,\d{1,2})?)\s*(?:reais|real|brl|conto|contos|pila)/) ||
      texto.match(/(?:valor|quantia|total)\s*(?:de|em)?\s*([\d.]+(?:,\d{1,2})?)/);
    if (m) return numeroBR(m[1]);
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
    var procura = /\b\d+(?:[.,]\d{1,2})?\b/g;
    var achado;
    while ((achado = procura.exec(texto)) !== null) {
      var bruto = achado[0];
      var n = numeroBR(bruto);
      if (n === null) continue;
      var antes = texto.slice(Math.max(0, achado.index - 20), achado.index);
      var depois = texto.slice(achado.index + bruto.length, achado.index + bruto.length + 14);
      if (/^\d{4}$/.test(bruto) && n > 1900 && n < 2100) continue;              // ano
      if (/\bdia\s*$/.test(antes)) continue;                                    // "dia 12"
      if (/^\s*(?:dias?|semanas?|mes(?:es)?|anos?)\b/.test(depois)) continue;    // prazo
      return n;
    }
    return null;
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

function descricaoDaFala(frase, texto, ctx, semDestino) {
    ctx = ctx || contextoDaFala();
    var doCadastro = palavrasDeCadastroNaFala(texto, ctx);
    var trechos = [], atual = null, aposForma = false;
    String(frase || "").split(/\s+/).forEach(function (bruta) {
      var palavra = semPontuacao(bruta);
      var chave = normalizarFala(palavra);
      var usada = !chave || /\d/.test(chave) || doCadastro[chave] === true ||
        COMANDO_DA_FALA.indexOf(chave) >= 0 || mesPorNome(chave) >= 0 ||
        DIAS_SEMANA[chave] !== undefined;
      if (usada) {
        if (atual) trechos.push(atual);
        atual = null;
        aposForma = FORMA_DA_FALA.indexOf(chave) >= 0;
        return;
      }
      if (!atual) atual = { palavras: [], aposForma: aposForma };
      atual.palavras.push({ palavra: palavra, chave: chave });
    });
    if (atual) trechos.push(atual);

    var melhor = null;
    trechos.forEach(function (trecho) {
      // "no crédito do Fulano" com Fulano fora do cadastro: o destino ficou
      // "não identificado", e essa palavra é o banco que a pessoa disse — não
      // o que ela comprou. Chamá-la de descrição guardaria o erro com nome de
      // compra. Com o destino achado a mesma palavra já saiu por outro
      // caminho, e este corte não tem o que cortar.
      if (semDestino && trecho.aposForma) return;
      var lista = trecho.palavras;
      var i = 0, f = lista.length;
      while (i < f && LIGACAO_DA_FALA.indexOf(lista[i].chave) >= 0) i++;
      while (f > i && LIGACAO_DA_FALA.indexOf(lista[f - 1].chave) >= 0) f--;
      var corte = lista.slice(i, f);
      // Uma letra solta não é o nome de nada, e "ok" no meio da frase também
      // não: sem este piso, qualquer ruído do microfone viraria descrição.
      if (!corte.some(function (x) { return x.chave.length >= 3; })) return;
      if (!melhor || corte.length > melhor.length) melhor = corte;
    });
    if (!melhor) return "";
    var desc = melhor.map(function (x) { return x.palavra; }).join(" ").slice(0, 60).trim();
    return desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "";
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

function interpretarFala(frase, ctx) {
    ctx = ctx || contextoDaFala();
    var texto = normalizarFala(frase).replace(/\s+/g, " ").trim();
    var r = { frase: frase, tipo: "EXPENSE", valor: null, categoriaId: null, contaId: null,
      cartaoId: null, faturaMes: null, data: null, confirmada: false, desc: "", faltando: [] };
    if (!texto) { r.faltando = ["valor", "destino", "categoria"]; return r; }

    // Transferência é outro tipo de lançamento, e sai por outro caminho: não
    // tem categoria, não tem cartão, e o que importa é a ORDEM das contas.
    if (TRANSFERENCIA.test(texto)) return transferenciaDaFala(texto, frase, r, ctx);

    if (ENTRADA.test(texto)) r.tipo = "INCOME";
    if (/despesa|gastei|paguei|comprei|pagamento de|gasto/.test(texto) && !ENTRADA.test(texto)) r.tipo = "EXPENSE";

    r.valor = valorDaFala(texto);
    if (!r.valor) r.faltando.push("valor");

    // Destino: cartão pelo nome, ou a forma de pagamento (débito, pix, dinheiro).
    var destino = destinoDaFala(texto, ctx);
    r.forma = destino.forma;
    r.contaId = destino.contaId || null;
    r.cartaoId = destino.cartaoId || null;
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
    else r.faltando.push("categoria");

    // Data: hoje, ontem, amanhã, depois de amanhã, "dia 12", "12 de setembro",
    // "em 3 dias", "semana que vem", "próxima sexta", "fim do mês".
    var hoje = ctx.hoje;
    r.data = dataDaFala(texto, hoje) || isoDate(hoje);

    // Fatura de destino: "fatura de setembro", "fatura de setembro/2026".
    // O `` em cada pedaço opcional não é enfeite: sem ele, o "de" de
    // "fatura de DEzembro" era comido como se fosse a preposição, e sobrava
    // "zembro" para procurar na lista de meses. Dezembro era o único mês com
    // esse problema, e caía calado — a fatura só não aparecia no resumo.
    var mFat = texto.match(/fatura(?:\s*d[eo]\b)?(?:\s*mes\b)?(?:\s*d[eo]\b)?\s*([a-z]+)\s*(?:de\s*|\/)?\s*(20\d{2})?/);
    if (r.cartaoId && mFat) {
      var mf = mesPorNome(mFat[1]);
      if (mf >= 0) r.faturaMes = monthKey({ y: mFat[2] ? parseInt(mFat[2], 10) : hoje.getFullYear(), m: mf });
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

    return r;
  }

module.exports = { interpretarFala, chaveDeLojista, regraDoLojista, normalizarFala };
