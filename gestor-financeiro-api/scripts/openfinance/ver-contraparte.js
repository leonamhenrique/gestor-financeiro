/* =====================================================================
 * ver-contraparte.js — o que o banco diz sobre o OUTRO LADO
 *
 * A pergunta: num Pix ou numa TED, a Polp diz de qual BANCO o dinheiro
 * veio (ou para qual foi)? O app hoje lê só `counterparty.alias` e
 * `counterparty.name`; o que mais existe nesse objeto, ninguém olhou.
 *
 * Sem a resposta não dá para desenhar o passo seguinte: com dois bancos
 * ligados, saber a instituição da contraparte é o que permitiria o app
 * já sugerir a outra conta em vez de perguntar.
 *
 * LEITURA PURA. Não cria consentimento, não revoga, não grava, não
 * importa. Só lê as transações de um consentimento que JÁ EXISTE.
 *
 *   node scripts/openfinance/ver-contraparte.js --consent <id>
 *
 * O id do consentimento sai do painel da Polp.
 *
 * O QUE ELE IMPRIME: as CHAVES de `counterparty` e dos campos vizinhos, com
 * um exemplo de valor por chave. Documento (CPF/CNPJ) e número de conta
 * saem MASCARADOS — a pergunta é "este campo existe e o que ele carrega?",
 * e para respondê-la os últimos dígitos bastam. O que sai no terminal fica
 * no terminal.
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.polp.com.br/api/v2';

const CONSENT = (() => {
  const i = process.argv.indexOf('--consent');
  return i > 0 ? process.argv[i + 1] : null;
})();
if (!CONSENT) {
  console.error('Use: node scripts/openfinance/ver-contraparte.js --consent <id>');
  process.exit(1);
}

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
  if (!client || !secret) {
    console.error('Faltam POLP_API_CLIENT / POLP_API_SECRET no .env da API.');
    process.exit(1);
  }
  return { client, secret };
}
const { client, secret } = credenciais();

async function pedir(url) {
  const r = await fetch(url, {
    headers: { 'x-api-client': client, 'x-api-secret': secret, 'Content-Type': 'application/json' },
  });
  const t = await r.text();
  let c = null;
  try { c = t ? JSON.parse(t) : null; } catch (e) { c = { _bruto: t }; }
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + JSON.stringify(c).slice(0, 300));
  return c;
}
const dados = (x) => (x && x.data) || [];

/* Documento e conta saem mascarados: para saber se o CAMPO existe, os
 * últimos dígitos bastam, e o resto não precisa ser lido por ninguém. */
function mascarar(chave, valor) {
  if (valor == null) return null;
  const texto = String(valor);
  const sensivel = /document|cpf|cnpj|account|agency|branch|ispb|number/i.test(chave);
  if (!sensivel || texto.length <= 4) return texto;
  return '…' + texto.slice(-4) + ' (' + texto.length + ' caracteres)';
}

function achatar(obj, prefixo, saida) {
  if (!obj || typeof obj !== 'object') return saida;
  for (const [k, v] of Object.entries(obj)) {
    const chave = prefixo ? prefixo + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) achatar(v, chave, saida);
    else if (!saida.has(chave)) saida.set(chave, mascarar(chave, Array.isArray(v) ? v.length + ' itens' : v));
  }
  return saida;
}

(async () => {
  const contas = dados(await pedir(BASE + '/consents/' + CONSENT + '/accounts'));
  console.log(contas.length + ' conta(s) no consentimento.\n');

  const vistas = new Map();
  let comContraparte = 0;
  let total = 0;

  for (const conta of contas) {
    const txs = dados(await pedir(BASE + '/accounts/' + conta.id + '/transactions'));
    for (const t of txs) {
      total++;
      if (t.counterparty) comContraparte++;
      /* Só as linhas que o banco chama de transferência: é delas que a
       * pergunta trata, e são as que teriam a outra ponta. */
      const ehTransferencia = /^TRANSFER/i.test(String(t.category_ref || ''));
      if (!ehTransferencia) continue;
      achatar({ counterparty: t.counterparty }, '', vistas);
      for (const k of ['category_ref', 'transaction_type', 'transaction_name', 'credit_debit_type']) {
        if (!vistas.has(k)) vistas.set(k, mascarar(k, t[k]));
      }
    }
  }

  console.log(total + ' transação(ões) lidas, ' + comContraparte + ' com `counterparty`.\n');
  if (!vistas.size) {
    console.log('NENHUMA linha de transferência neste consentimento — nada a dizer sobre a contraparte.');
    return;
  }
  console.log('Campos encontrados nas linhas de transferência (um exemplo por campo):\n');
  for (const [chave, exemplo] of [...vistas.entries()].sort()) {
    console.log('  ' + chave.padEnd(34) + ' = ' + JSON.stringify(exemplo));
  }
  console.log(
    '\nA pergunta que isto responde: existe algum campo com o BANCO da ' +
      'contraparte (ispb, bank_name, institution)? Se não aparecer na lista ' +
      'acima, a Polp não manda, e o app não tem como saber de qual banco veio.',
  );
})().catch((e) => {
  console.error('falhou: ' + e.message);
  process.exit(1);
});
