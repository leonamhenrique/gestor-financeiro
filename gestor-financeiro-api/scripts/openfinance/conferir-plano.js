/* =====================================================================
 * conferir-plano.js — o plano está ativo? E o banco dele dá para conectar?
 *
 * Script de bancada, como os vizinhos desta pasta: nada aqui é importado
 * pelo app. Ele faz só LEITURAS em produção e **não cria consentimento
 * nenhum** — consentimento autorizado é o que a Polp cobra (R$ 3,60/mês na
 * primeira faixa), e criar um sem o dono da conta mandar seria gastar o
 * dinheiro dele.
 *
 * O que ele responde:
 *   1. o plano está valendo? (antes do plano, rota de produção devolvia 402)
 *   2. já existe algum consentimento de produção? (esperado: nenhum)
 *   3. quais instituições estão OPERATIONAL, e a do usuário está na lista?
 *
 * COMO RODAR
 *   node scripts/openfinance/conferir-plano.js
 *   node scripts/openfinance/conferir-plano.js nubank itau   (filtra por nome)
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.polp.com.br/api/v2';

// ---------------------------------------------------------------- credenciais
/** Lê do ambiente ou do .env da API. O segredo nunca é impresso. */
function credenciais() {
  let client = process.env.POLP_API_CLIENT;
  let secret = process.env.POLP_API_SECRET;
  if (!client || !secret) {
    const env = path.resolve(__dirname, '..', '..', '.env');
    if (fs.existsSync(env)) {
      for (const linha of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
        const m = linha.match(/^\s*(POLP_API_CLIENT|POLP_API_SECRET)\s*=\s*(.*)$/);
        if (!m) continue;
        const v = m[2].trim().replace(/^["']|["']$/g, '');
        if (m[1] === 'POLP_API_CLIENT') client = client || v;
        else secret = secret || v;
      }
    }
  }
  if (!client || !secret) {
    console.error(
      'Faltam as credenciais. Ponha POLP_API_CLIENT e POLP_API_SECRET no\n' +
      'arquivo .env da API (gestor-financeiro-api/.env) e rode de novo.',
    );
    process.exit(1);
  }
  return { client, secret };
}

const { client, secret } = credenciais();

/** Devolve { ok, status, corpo } — sem lançar, porque aqui o STATUS é a medida. */
async function pedir(url) {
  const r = await fetch(url, {
    headers: {
      'x-api-client': client,
      'x-api-secret': secret,
      'Content-Type': 'application/json',
    },
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch (e) { corpo = { _bruto: texto }; }
  return { ok: r.ok, status: r.status, corpo };
}

const dados = (x) => (x && x.data) || [];

const SENTIDO = {
  401: 'credenciais erradas',
  402: 'plano inativo ou fatura em atraso',
  403: 'conta pendente de aprovação',
  404: 'rota inexistente',
};

async function main() {
  const filtros = process.argv.slice(2).map((s) => s.toLowerCase());

  console.log('Produção: ' + BASE + '\n');

  // 1. Rota de produção que exige plano. O status é a resposta.
  const consents = await pedir(BASE + '/consents');
  if (!consents.ok) {
    console.log('PLANO: NÃO liberado — HTTP ' + consents.status +
      (SENTIDO[consents.status] ? ' (' + SENTIDO[consents.status] + ')' : ''));
    console.log(JSON.stringify(consents.corpo).slice(0, 400));
    process.exit(1);
  }
  const lista = dados(consents.corpo);
  console.log('PLANO: liberado (GET /consents respondeu 200)');
  /* Quem custa dinheiro é o AUTORIZADO, e só ele. Contar linhas — como esta
   * saída fazia — anuncia "5 cobráveis" num dia em que nenhum está de pé:
   * revogado, recusado e expirado continuam na lista e não custam nada. Um
   * número que assusta à toa é um número que para de ser lido. */
  const cobraveis = lista.filter((c) => c.status === 'AUTHORISED');
  console.log('Consentimentos na lista: ' + lista.length +
    '  |  AUTORIZADOS (os que a Polp cobra): ' + cobraveis.length +
    (cobraveis.length ? '  <-- R$ 3,60/mês cada' : '  (nada sendo cobrado)') + '\n');
  for (const c of lista) {
    console.log('  ' + c.id + '  status=' + c.status + '  inst=' + (c.institution_id || '?'));
  }
  if (lista.length) console.log('');

  // 2. Instituições. Quem não está OPERATIONAL não dá para conectar agora.
  const inst = await pedir(BASE + '/institutions');
  if (!inst.ok) {
    console.log('GET /institutions: HTTP ' + inst.status);
    return;
  }
  const todas = dados(inst.corpo);
  const operacionais = todas.filter((i) => i.status === 'OPERATIONAL');
  console.log('Instituições: ' + todas.length + ' no catálogo, ' +
    operacionais.length + ' OPERATIONAL');

  if (!filtros.length) {
    console.log('\n(Para ver uma: node scripts/openfinance/conferir-plano.js nubank)');
    return;
  }
  console.log('');
  for (const f of filtros) {
    const achadas = todas.filter((i) => String(i.name || '').toLowerCase().includes(f));
    if (!achadas.length) {
      console.log('"' + f + '": nenhuma instituição com esse nome.');
      continue;
    }
    for (const i of achadas) {
      console.log('"' + f + '" -> ' + i.name + '  [' + i.type + ']  status=' + i.status +
        (i.status === 'OPERATIONAL' ? '  OK, dá para conectar' : '  indisponível agora'));
      console.log('      id=' + i.id);
    }
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
