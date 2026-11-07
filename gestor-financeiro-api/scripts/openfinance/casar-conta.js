/* =====================================================================
 * casar-conta.js — o casamento na CONTA, que é o caso difícil.
 *
 * No cartão os dois lados dizem o nome do lojista, então o texto casa. Na
 * conta, não: quem lançou um previsto escreveu "Aluguel", e o banco manda
 * "PIX ENVIADO IMOBILIARIA SANTOS LTDA". É o caso que o usuário levantou —
 * a parcela que vai cair dia 7 e ainda não aconteceu.
 *
 * Nada é gravado. O script traduz o que a Polp devolve para a forma de
 * lançamento do saldonline e roda o casamento com as MESMAS funções da
 * tela, lidas de `web/home.html`.
 *
 * A regra que ele obedece, e que é do contrato deste branch: onde o texto
 * não bate, o script NÃO decide. Ele marca como candidata, para o app
 * perguntar. Casar dois lançamentos pelo valor e pela data é um palpite, e
 * palpite silencioso em dinheiro vira saldo errado.
 *
 *   node scripts/openfinance/casar-conta.js
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const BASE = 'https://api.polp.com.br/api/v2';
const SANDBOX = BASE + '/sandbox';
const CPF = process.env.POLP_CPF_TESTE || '12345678900';

/* A janela do previsto é maior que a do cartão: quem agenda "dia 7" e o
 * banco debita no dia 9 (fim de semana, feriado) descreve o mesmo dinheiro.
 * Sete dias é chute explícito — num extrato de verdade isto se recalibra. */
const JANELA_PREVISTO = 7;
const JANELA_TEXTO_IGUAL = 3;

// ------------------------------------------------------------------
// as funções do app, lidas do app
// ------------------------------------------------------------------
function doApp() {
  const html = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'web', 'home.html'), 'utf8',
  );
  const src = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  function bloco(marcador) {
    const i = src.indexOf(marcador);
    if (i < 0) throw new Error('não achei ' + marcador + ' em web/home.html');
    const comeco = src.indexOf('{', i);
    let nivel = 0, j = comeco;
    for (; j < src.length; j++) {
      if (src[j] === '{') nivel++;
      else if (src[j] === '}') { nivel--; if (!nivel) break; }
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
    'textoComparavel', 'chaveDeLancamento',
  ];
  let codigo = umaLinha('var RE_PARCELA = ') + '\n';
  for (const n of nomes) {
    const i = src.indexOf('function ' + n + '(');
    codigo += src.slice(i, src.indexOf('{', i)) + bloco('function ' + n + '(') + '\n';
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
const dia = (iso) => String(iso || '').slice(0, 10);
const somaDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const distancia = (a, b) =>
  Math.round(Math.abs(new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);

// ------------------------------------------------------------------
// tradução
// ------------------------------------------------------------------
/* Pagamento de fatura não é despesa da conta: é a fatura saindo, e o app já
 * tem caminho próprio para isso. Importado como lançamento comum, contaria
 * o mesmo dinheiro duas vezes — a compra no cartão e o pagamento dela.
 * O importador de OFX já exclui isso por texto (`ehPagamentoDeFatura`);
 * aqui a categoria diz, sem adivinhar. */
const EH_PAGAMENTO_DE_FATURA = (t) =>
  t.category_ref === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

function paraLancamento(t) {
  const nome = (t.counterparty && (t.counterparty.alias || t.counterparty.name)) || t.transaction_name || '';
  return {
    data: dia(t.transaction_date_time),
    valor: Number((t.transaction_amount || {}).amount),
    tipo: t.credit_debit_type === 'CREDITO' ? 'INCOME' : 'EXPENSE',
    desc: nome,
    _id: t.id,
    _categoria: t.category_ref || '',
    _fatura: EH_PAGAMENTO_DE_FATURA(t),
  };
}

// ------------------------------------------------------------------
// o casamento
// ------------------------------------------------------------------
/**
 * Quatro saídas, e a diferença entre as duas últimas é o ponto deste script:
 *
 *   JA_TENHO    chave exata do app — é o mesmo lançamento, sem dúvida;
 *   PROVAVEL    mesmo valor e mesmo TEXTO, poucos dias de diferença;
 *   CANDIDATA   mesmo valor e mesma direção perto da data, mas TEXTO
 *               DIFERENTE, casando com um PREVISTO. Não decide: propõe.
 *   NOVA        o app não tem.
 *
 * Candidata só olha previsto. Um lançamento já confirmado com outro texto é
 * outro dinheiro: se já aconteceu e foi conferido, não é este que está
 * chegando agora.
 *
 * Quando mais de um previsto cabe, nenhum é escolhido — a saída vira
 * AMBIGUA. Escolher o primeiro da lista seria sortear com o dinheiro de
 * alguém.
 */
function casar(doBanco, estado) {
  const porChave = new Map();
  for (const a of estado) porChave.set(app.chaveDeLancamento(a), a);
  const usados = new Set();

  return doBanco.map((b) => {
    if (b._fatura) return { b, veredito: 'PAGAMENTO_DE_FATURA', como: 'o app tem caminho próprio', par: null };

    const exato = porChave.get(app.chaveDeLancamento(b));
    if (exato && !usados.has(exato)) { usados.add(exato); return { b, veredito: 'JA_TENHO', como: 'chave exata', par: exato }; }

    const texto = app.chaveDeTexto(app.textoComparavel(b));
    const mesmoValor = (a) => Number(a.valor).toFixed(2) === Number(b.valor).toFixed(2);

    for (const a of estado) {
      if (usados.has(a) || !mesmoValor(a)) continue;
      if (app.chaveDeTexto(app.textoComparavel(a)) !== texto) continue;
      if (distancia(a.data, b.data) > JANELA_TEXTO_IGUAL) continue;
      usados.add(a);
      return { b, veredito: 'PROVAVEL', como: 'mesmo valor e texto, ' + distancia(a.data, b.data) + ' dia(s)', par: a };
    }

    const cabem = estado.filter((a) =>
      !usados.has(a) && a.confirmada === false && mesmoValor(a) &&
      a.tipo === b.tipo && distancia(a.data, b.data) <= JANELA_PREVISTO);

    if (cabem.length === 1) {
      usados.add(cabem[0]);
      return {
        b, veredito: 'CANDIDATA', par: cabem[0],
        como: 'previsto "' + cabem[0].desc + '", ' + distancia(cabem[0].data, b.data) + ' dia(s) — o app pergunta',
      };
    }
    if (cabem.length > 1) {
      return { b, veredito: 'AMBIGUA', par: null, como: cabem.length + ' previstos cabem; nenhum escolhido' };
    }
    return { b, veredito: 'NOVA', como: '', par: null };
  });
}

// ------------------------------------------------------------------
// o cenário
// ------------------------------------------------------------------
/** Como a pessoa chamaria aquilo na mão — propositalmente diferente do
 *  texto do banco, que é o que torna o caso difícil. */
function comoAPessoaEscreveria(t) {
  if (String(t._categoria).startsWith('INCOME_SALARY')) return 'Salário';
  if (String(t._categoria).startsWith('FOOD')) return 'Mercado do mês';
  if (t.tipo === 'INCOME') return 'Entrada prevista';
  return 'Aluguel';
}

function cenario(doBanco) {
  const estado = [];
  const esperado = {};
  const uteis = doBanco.filter((x) => !x._fatura);

  // (a) um lançamento idêntico.
  if (uteis[0]) {
    estado.push({ data: uteis[0].data, valor: uteis[0].valor, tipo: uteis[0].tipo, desc: uteis[0].desc, confirmada: true });
    esperado[uteis[0]._id] = 'JA_TENHO';
  }
  // (b) digitado à mão, dois dias antes, mesmo texto.
  if (uteis[1]) {
    estado.push({ data: somaDias(uteis[1].data, -2), valor: uteis[1].valor, tipo: uteis[1].tipo, desc: uteis[1].desc, confirmada: true });
    esperado[uteis[1]._id] = 'PROVAVEL';
  }
  // (c) O CASO: um PREVISTO com outro texto, quatro dias antes.
  if (uteis[2]) {
    estado.push({
      data: somaDias(uteis[2].data, -4), valor: uteis[2].valor, tipo: uteis[2].tipo,
      desc: comoAPessoaEscreveria(uteis[2]), confirmada: false,
    });
    esperado[uteis[2]._id] = 'CANDIDATA';
  }
  // (d) dois previstos do mesmo valor na mesma janela: tem de dar AMBIGUA,
  //     e não um palpite.
  if (uteis[3]) {
    estado.push({ data: somaDias(uteis[3].data, -1), valor: uteis[3].valor, tipo: uteis[3].tipo, desc: 'Conta de luz', confirmada: false });
    estado.push({ data: somaDias(uteis[3].data, 1), valor: uteis[3].valor, tipo: uteis[3].tipo, desc: 'Conta de água', confirmada: false });
    esperado[uteis[3]._id] = 'AMBIGUA';
  }
  // (e) um previsto LONGE da data: não pode casar com nada.
  if (uteis[4]) {
    estado.push({ data: somaDias(uteis[4].data, -40), valor: uteis[4].valor, tipo: uteis[4].tipo, desc: 'Previsto de outro mês', confirmada: false });
    esperado[uteis[4]._id] = 'NOVA';
  }
  for (const t of doBanco) {
    if (t._id in esperado) continue;
    esperado[t._id] = t._fatura ? 'PAGAMENTO_DE_FATURA' : 'NOVA';
  }
  return { estado, esperado };
}

// ------------------------------------------------------------------
async function main() {
  const inst = dados(await pedir(BASE + '/institutions')).find((i) => i.type === 'PERSONAL');
  const consent = (await pedir(SANDBOX + '/consents', {
    method: 'POST',
    body: JSON.stringify({
      institution_id: inst.id, cpf: CPF,
      cliente_user_id: 'casador-conta', products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
    }),
  })).data;
  console.log('Consentimento sandbox ' + consent.id + ' (' + (inst.name || '') + ')\n');

  try {
    let contas = [];
    for (let i = 0; i < 12 && !contas.length; i++) {
      contas = dados(await pedir(SANDBOX + '/consents/' + consent.id + '/accounts'));
      if (!contas.length) await esperar(2500);
    }
    if (!contas.length) { console.log('Nenhuma conta veio.'); return; }

    const conta = contas[0];
    const txs = dados(await pedir(SANDBOX + '/accounts/' + conta.id + '/transactions'));
    const doBanco = txs.map(paraLancamento).filter((x) => isFinite(x.valor) && x.valor > 0);
    console.log('Conta: ' + (conta.name || conta.id) + ' — ' + doBanco.length + ' transações');

    const pagamentos = doBanco.filter((x) => x._fatura).length;
    console.log('  pagamentos de fatura reconhecidos pela categoria: ' + pagamentos + '\n');

    const { estado, esperado } = cenario(doBanco);
    console.log('Cenário: o app já tem ' + estado.length + ' lançamentos —');
    console.log('  1 idêntico, 1 digitado 2 dias antes, 1 PREVISTO com outro texto,');
    console.log('  2 previstos do mesmo valor na mesma janela, 1 previsto de 40 dias atrás.\n');

    const resultado = casar(doBanco, estado);
    const conta_ = { JA_TENHO: 0, PROVAVEL: 0, CANDIDATA: 0, AMBIGUA: 0, PAGAMENTO_DE_FATURA: 0, NOVA: 0 };
    const erros = [];
    for (const r of resultado) {
      conta_[r.veredito]++;
      if (esperado[r.b._id] !== r.veredito) {
        erros.push({ desc: r.b.desc, data: r.b.data, valor: r.b.valor, esperado: esperado[r.b._id], veio: r.veredito });
      }
    }

    console.log('VEREDITOS (os que não são "nova")');
    for (const r of resultado.filter((x) => x.veredito !== 'NOVA')) {
      console.log('  ' + r.veredito.padEnd(20) + r.b.data + '  ' +
        String(r.b.valor.toFixed(2)).padStart(10) + '  ' +
        String(r.b.desc).slice(0, 28).padEnd(30) + r.como);
    }

    console.log('\nRESUMO');
    for (const k of Object.keys(conta_)) console.log('  ' + k.toLowerCase().padEnd(22) + conta_[k]);

    console.log('\nCONFERÊNCIA (o cenário sabe a resposta certa)');
    const faltou = [];
    if (!conta_.CANDIDATA) faltou.push('o previsto com outro texto');
    if (!conta_.AMBIGUA) faltou.push('os dois previstos empatados');
    if (erros.length) {
      console.log('  ' + erros.length + ' divergência(s):');
      for (const e of erros) {
        console.log('    ' + e.data + '  ' + String(e.valor.toFixed(2)).padStart(10) + '  ' +
          String(e.desc).slice(0, 26).padEnd(28) + 'esperava ' + e.esperado + ', veio ' + e.veio);
      }
    } else if (faltou.length) {
      console.log('  ' + resultado.length + ' de ' + resultado.length + ' bateram, MAS não apareceu ' +
        faltou.join(' nem ') + '.');
      console.log('  Isto NÃO é aprovação: o caso central não foi exercitado.');
    } else {
      console.log('  ' + resultado.length + ' de ' + resultado.length + ' como esperado,');
      console.log('  incluindo o previsto que só casa por valor e data, e o empate que não foi resolvido.');
    }
  } finally {
    try { await pedir(SANDBOX + '/consents/' + consent.id, { method: 'DELETE' }); console.log('\n(consentimento revogado)'); } catch (e) {}
  }
}

main().catch((e) => { console.error('\nFalhou: ' + e.message); process.exit(1); });
