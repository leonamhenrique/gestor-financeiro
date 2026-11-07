/* =====================================================================
 * casar.js — o casamento, em memória, sem gravar nada.
 *
 * A pergunta: quando o banco mandar as transações, o app consegue dizer
 * quais delas ele JÁ TEM — de um lançamento digitado, ditado ou de uma
 * parcela que ele mesmo projetou?
 *
 * Nada é gravado e nada é importado pelo app. O script traduz o que a Polp
 * devolve para a forma de lançamento do saldonline e roda o casamento com
 * as MESMAS funções da tela (`chaveDeLancamento`, `seriesDeParcelas`),
 * lidas direto de `web/home.html` — reescrevê-las aqui seria a segunda
 * versão da mesma regra, e o dia em que as duas discordassem seria o dia em
 * que o app importaria em duplicidade.
 *
 * O "estado do app" é um cenário montado A PARTIR das transações que o
 * sandbox devolveu, com a resposta certa anotada em cada caso. Assim o
 * script não só imprime: ele se confere, e diz quando errou.
 *
 *   node scripts/openfinance/casar.js
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const BASE = 'https://api.polp.com.br/api/v2';
const SANDBOX = BASE + '/sandbox';
const CPF = process.env.POLP_CPF_TESTE || '12345678900';
const TOLERANCIA_DIAS = 3;

// ------------------------------------------------------------------
// as funções do app, lidas do app
// ------------------------------------------------------------------
/* O mesmo recorte que o banco de testes da tela usa: o <script> final do
 * HTML, de onde se tiram as funções pelo nome. Enquanto isto for bancada,
 * ler é melhor que copiar — copiado, envelhece calado. */
function doApp() {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'web', 'home.html'), 'utf8',
  );
  const src = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

  function bloco(abre, marcador) {
    const i = src.indexOf(marcador);
    if (i < 0) throw new Error('não achei ' + marcador + ' em web/home.html');
    const comeco = src.indexOf(abre, i);
    const fecha = abre === '{' ? '}' : ']';
    let nivel = 0, j = comeco;
    for (; j < src.length; j++) {
      if (src[j] === abre) nivel++;
      else if (src[j] === fecha) { nivel--; if (!nivel) break; }
    }
    return src.slice(comeco, j + 1);
  }
  function umaLinha(marca) {
    const i = src.indexOf(marca);
    if (i < 0) throw new Error('não achei ' + marca);
    return src.slice(i, src.indexOf('\n', i));
  }

  const nomes = [
    'normalizarNome', 'chaveDeTexto', 'parcelaDoLancamento',
    'textoComparavel', 'chaveDeLancamento', 'seriesDeParcelas',
    'quantasParcelasFaltam',
  ];
  let codigo = umaLinha('var RE_PARCELA = ') + '\n';
  for (const n of nomes) {
    const i = src.indexOf('function ' + n + '(');
    codigo += src.slice(i, src.indexOf('{', i)) + bloco('{', 'function ' + n + '(') + '\n';
  }
  codigo += 'module.exports = { RE_PARCELA, ' + nomes.join(', ') + ' };';

  const m = new Module('app-fns');
  m.paths = module.paths;
  m._compile(codigo, 'app-fns.js');
  return m.exports;
}
const app = doApp();

// ------------------------------------------------------------------
// rede
// ------------------------------------------------------------------
function credenciais() {
  let client = process.env.POLP_API_CLIENT;
  let secret = process.env.POLP_API_SECRET;
  if (!client || !secret) {
    const env = path.resolve(__dirname, '..', '..', '.env');
    if (fs.existsSync(env)) {
      for (const linha of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
        const mm = linha.match(/^\s*(POLP_API_CLIENT|POLP_API_SECRET)\s*=\s*(.*)$/);
        if (!mm) continue;
        const v = mm[2].trim().replace(/^["']|["']$/g, '');
        if (mm[1] === 'POLP_API_CLIENT') client = client || v;
        else secret = secret || v;
      }
    }
  }
  if (!client || !secret) { console.error('Faltam POLP_API_CLIENT / POLP_API_SECRET no .env da API.'); process.exit(1); }
  return { client, secret };
}
const { client, secret } = credenciais();

async function pedir(url, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: {
      'x-api-client': client, 'x-api-secret': secret,
      'Content-Type': 'application/json', ...(opcoes.headers || {}),
    },
  });
  const t = await r.text();
  let c = null;
  try { c = t ? JSON.parse(t) : null; } catch (e) { c = { _bruto: t }; }
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + JSON.stringify(c).slice(0, 300));
  return c;
}
const dados = (x) => (x && x.data) || [];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* A data chega como "2026-09-22T03:00:00.000000Z": meia-noite de Brasília
 * gravada em UTC. Os 10 primeiros caracteres são o dia certo; `new Date`
 * seguido de hora local devolveria o dia anterior. */
const dia = (iso) => String(iso || '').slice(0, 10);
const somaDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const somaMeses = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(d, ultimo)))
    .toISOString().slice(0, 10);
};
const distancia = (a, b) =>
  Math.abs(new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000;

// ------------------------------------------------------------------
// tradução: transação da Polp -> lançamento do saldonline
// ------------------------------------------------------------------
/* A parcela vive em lugares diferentes nas duas pontas: na Polp ela é par de
 * campos (`charge_identificator` / `charge_number`); no app ela está no
 * TEXTO ("Lojista - Parcela 2/6"), que é a forma que o importador de OFX já
 * cria e que `RE_PARCELA` entende. Traduzir aqui é o que permite reusar o
 * casamento do app sem tocar nele. */
function paraLancamento(t) {
  const nome = (t.counterparty && (t.counterparty.alias || t.counterparty.name)) || t.transaction_name || '';
  const n = t.charge_identificator, total = t.charge_number;
  const parcelada = total > 1 && n >= 1;
  return {
    data: dia(t.transaction_date_time),
    valor: Number((t.brazilian_amount || t.amount || {}).amount),
    tipo: t.credit_debit_type === 'CREDITO' ? 'INCOME' : 'EXPENSE',
    desc: parcelada ? nome + ' - Parcela ' + n + '/' + total : nome,
    // Só para o relatório; o casamento não usa.
    _id: t.id,
    _faturada: !!t.bill_id,
    _parcela: parcelada ? n + '/' + total : '',
  };
}

// ------------------------------------------------------------------
// o casamento
// ------------------------------------------------------------------
/**
 * Três passadas, da mais segura para a menos:
 *
 *  1. chave exata do app (data|valor|texto) — é o mesmo lançamento;
 *  2. mesmo valor e mesmo texto, data a até N dias — o caso de quem digitou
 *     à mão e errou o dia, ou lançou como previsto antes de acontecer;
 *  3. mesma série e mesmo número de parcela, IGNORANDO a data — e esta
 *     passada é obrigatória: o banco repete a data da COMPRA em todas as
 *     parcelas, enquanto o app avança um mês a cada uma. Sem ela, a parcela
 *     2/6 que o app projetou nunca casaria com a 2/6 que o banco mandou, e
 *     o extrato ficaria com as duas.
 */
function casar(doBanco, doApp) {
  const porChave = new Map();
  const porSerie = new Map();
  for (const a of doApp) {
    porChave.set(app.chaveDeLancamento(a), a);
    const m = String(a.desc || '').match(app.RE_PARCELA);
    const p = m ? m[2] + '/' + m[3] : app.parcelaDoLancamento(a);
    if (p) {
      const base = m ? m[1] : a.desc;
      porSerie.set(app.chaveDeTexto(base) + '|' + p + '|' + Number(a.valor).toFixed(2), a);
    }
  }
  const usados = new Set();

  return doBanco.map((b) => {
    const chave = app.chaveDeLancamento(b);
    const exato = porChave.get(chave);
    if (exato && !usados.has(exato)) { usados.add(exato); return { b, veredito: 'JA_TENHO', como: 'chave exata', par: exato }; }

    const m = String(b.desc || '').match(app.RE_PARCELA);
    if (m) {
      const k = app.chaveDeTexto(m[1]) + '|' + m[2] + '/' + m[3] + '|' + Number(b.valor).toFixed(2);
      const serie = porSerie.get(k);
      if (serie && !usados.has(serie)) {
        usados.add(serie);
        return { b, veredito: 'PARCELA_PROJETADA', como: 'série ' + m[2] + '/' + m[3] + ', data ignorada', par: serie };
      }
    }

    const texto = app.chaveDeTexto(app.textoComparavel(b));
    for (const a of doApp) {
      if (usados.has(a)) continue;
      if (Number(a.valor).toFixed(2) !== Number(b.valor).toFixed(2)) continue;
      if (app.chaveDeTexto(app.textoComparavel(a)) !== texto) continue;
      if (distancia(a.data, b.data) > TOLERANCIA_DIAS) continue;
      usados.add(a);
      return { b, veredito: 'PROVAVEL', como: 'mesmo valor e texto, ' + distancia(a.data, b.data) + ' dia(s) de diferença', par: a };
    }
    return { b, veredito: 'NOVA', como: '', par: null };
  });
}

// ------------------------------------------------------------------
// o cenário: montado a partir do que o sandbox devolveu
// ------------------------------------------------------------------
/** Devolve { doApp, esperado } — `esperado` é o veredito certo por id. */
function cenario(doBanco) {
  const doApp = [];
  const esperado = {};

  const simples = doBanco.filter((x) => !x._parcela);
  const parceladas = doBanco.filter((x) => x._parcela);

  // (a) duas que a pessoa já lançou igualzinho.
  for (const t of simples.slice(0, 2)) {
    doApp.push({ data: t.data, valor: t.valor, tipo: t.tipo, desc: t.desc });
    esperado[t._id] = 'JA_TENHO';
  }
  // (b) uma lançada à mão: dois dias antes e com o nome abreviado do MESMO
  //     jeito — texto diferente não casa, e é assim que tem de ser.
  const aMao = simples[2];
  if (aMao) {
    doApp.push({ data: somaDias(aMao.data, -2), valor: aMao.valor, tipo: aMao.tipo, desc: aMao.desc });
    esperado[aMao._id] = 'PROVAVEL';
  }
  // (c) a série: o app tem a 1ª parcela e projetou as seguintes, avançando um
  //     mês a cada uma — que é o que ele faz hoje.
  const primeira = parceladas.find((x) => x._parcela.startsWith('1/'));
  if (primeira) {
    const total = Number(primeira._parcela.split('/')[1]);
    const base = String(primeira.desc).replace(app.RE_PARCELA, '$1');
    for (let n = 1; n <= total; n++) {
      doApp.push({
        data: somaMeses(primeira.data, n - 1), valor: primeira.valor, tipo: primeira.tipo,
        desc: base + ' - Parcela ' + n + '/' + total,
      });
    }
    esperado[primeira._id] = 'JA_TENHO';
    for (const p of parceladas) {
      if (p === primeira) continue;
      const mesmaSerie = String(p.desc).replace(app.RE_PARCELA, '$1') === base &&
        p.valor === primeira.valor;
      if (mesmaSerie) esperado[p._id] = 'PARCELA_PROJETADA';
    }
  }
  // (d) o resto o app não tem.
  for (const t of doBanco) if (!(t._id in esperado)) esperado[t._id] = 'NOVA';

  return { doApp, esperado };
}

// ------------------------------------------------------------------
/** As transações de um cartão, já traduzidas. */
async function lancamentosDoCartao(cartao) {
  const txs = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/transactions'))
    .filter((t) => t.transaction_type !== 'PAGAMENTO_FATURA');
  return txs.map(paraLancamento).filter((x) => isFinite(x.valor) && x.valor > 0);
}

/* O caso central deste script é a parcela que o app projetou e o banco
 * manda depois. Um cartão sem nenhuma parcela 2/N não exercita isso, e
 * aprovar nele seria aprovar no vazio — foi o que aconteceu na primeira
 * rodada, com um "50 de 50" que não provava o que importa. */
const temParcelaFutura = (lista) =>
  lista.some((x) => x._parcela && Number(x._parcela.split('/')[0]) >= 2);

async function acharCartao() {
  const instituicoes = dados(await pedir(BASE + '/institutions'))
    .filter((i) => i.type === 'PERSONAL');
  const criados = [];
  let reserva = null;

  for (const inst of instituicoes.slice(0, 6)) {
    let consent;
    try {
      consent = (await pedir(SANDBOX + '/consents', {
        method: 'POST',
        body: JSON.stringify({
          institution_id: inst.id, cpf: CPF,
          cliente_user_id: 'casador-saldonline', products: ['CREDIT_CARD_ACCOUNT'],
        }),
      })).data;
    } catch (e) { continue; }
    criados.push(consent.id);

    let cartoes = [];
    for (let i = 0; i < 12 && !cartoes.length; i++) {
      cartoes = dados(await pedir(SANDBOX + '/consents/' + consent.id + '/credit-cards'));
      if (!cartoes.length) await esperar(2500);
    }
    for (const cartao of cartoes) {
      const lista = await lancamentosDoCartao(cartao);
      const nome = (inst.name || '') + ' / ' + (cartao.name || cartao.id);
      if (temParcelaFutura(lista)) {
        console.log('  ' + nome + ': tem parcela futura — serve.\n');
        return { nome, lista, criados };
      }
      console.log('  ' + nome + ': ' + lista.length + ' transações, nenhuma parcela 2/N');
      if (!reserva) reserva = { nome, lista };
    }
  }
  return reserva ? { ...reserva, criados, semParcelaFutura: true } : { criados, lista: null };
}

async function main() {
  console.log('Procurando um cartão com parcela futura:');
  const achado = await acharCartao();

  try {
    if (!achado.lista) { console.log('\nNenhum cartão utilizável.'); return; }
    const doBanco = achado.lista;
    console.log('Cartão: ' + achado.nome + ' — ' + doBanco.length + ' transações\n');

    const { doApp: estado, esperado } = cenario(doBanco);
    console.log('Cenário montado: o app já tem ' + estado.length + ' lançamentos');
    console.log('  (2 idênticos, 1 digitado com 2 dias de diferença, e uma série parcelada projetada)\n');

    const resultado = casar(doBanco, estado);

    const conta = { JA_TENHO: 0, PARCELA_PROJETADA: 0, PROVAVEL: 0, NOVA: 0 };
    const erros = [];
    for (const r of resultado) {
      conta[r.veredito]++;
      if (esperado[r.b._id] !== r.veredito) {
        erros.push({ desc: r.b.desc, data: r.b.data, esperado: esperado[r.b._id], veio: r.veredito });
      }
    }

    console.log('VEREDITOS (os que não são "nova")');
    for (const r of resultado.filter((x) => x.veredito !== 'NOVA')) {
      console.log('  ' + r.veredito.padEnd(18) + r.b.data + '  ' +
        String(r.b.valor.toFixed(2)).padStart(9) + '  ' +
        String(r.b.desc).slice(0, 34).padEnd(36) + r.como);
    }

    console.log('\nRESUMO');
    console.log('  já tenho (chave exata):    ' + conta.JA_TENHO);
    console.log('  parcela que eu projetei:   ' + conta.PARCELA_PROJETADA);
    console.log('  provável (data diferente): ' + conta.PROVAVEL);
    console.log('  nova:                      ' + conta.NOVA);

    console.log('\nCONFERÊNCIA (o cenário sabe a resposta certa)');
    if (erros.length) {
      console.log('  ' + erros.length + ' divergência(s):');
      for (const e of erros) {
        console.log('    ' + e.data + '  ' + String(e.desc).slice(0, 38).padEnd(40) +
          'esperava ' + e.esperado + ', veio ' + e.veio);
      }
    } else if (!conta.PARCELA_PROJETADA) {
      console.log('  ' + resultado.length + ' de ' + resultado.length + ' bateram, MAS nenhuma');
      console.log('  parcela projetada apareceu: o caso central não foi exercitado.');
      console.log('  Isto NÃO é aprovação. Rode de novo — o sandbox sorteia as compras.');
    } else {
      console.log('  ' + resultado.length + ' de ' + resultado.length + ' como esperado,');
      console.log('  incluindo ' + conta.PARCELA_PROJETADA + ' parcela(s) que o app tinha projetado.');
    }
  } finally {
    for (const id of achado.criados || []) {
      try { await pedir(SANDBOX + '/consents/' + id, { method: 'DELETE' }); } catch (e) {}
    }
    if ((achado.criados || []).length) {
      console.log('\n(' + achado.criados.length + ' consentimento(s) revogado(s))');
    }
  }
}

main().catch((e) => { console.error('\nFalhou: ' + e.message); process.exit(1); });
