/* =====================================================================
 * medir-sandbox.js — uma MEDIÇÃO, não uma integração.
 *
 * Nada aqui roda em produção nem é importado pelo app: é um script de
 * bancada, para conferir o que o sandbox da Polp entrega antes de escrever
 * integração. Descartar o experimento é apagar esta pasta.
 *
 * Ele imprime, por cartão fictício:
 *   - as faturas, com fechamento e vencimento lado a lado;
 *   - cada parcelamento, parcela por parcela, com `bill_forecast_date`,
 *     `bill_post_date` e se já tem fatura;
 *   - quantas parcelas FUTURAS o banco já entrega — que é o tamanho exato
 *     da colisão com as parcelas que o app projeta sozinho;
 *   - uma amostra de transações de conta, para ver a forma do lançamento.
 *
 * O QUE ELE NÃO RESPONDE, e por quê: se `bill_forecast_date` segue o mês do
 * fechamento ou o do vencimento. Medido em 07/11/2026, o gerador da Polp faz
 * o vencimento cair sempre 7 dias depois do fechamento, com fechamento nunca
 * acima do dia 18 — a fatura nunca atravessa o mês, e os dois candidatos
 * coincidem. Ver o README desta pasta.
 *
 * COMO RODAR
 *   1. POLP_API_CLIENT e POLP_API_SECRET no .env da API (nunca no git).
 *   2. node scripts/openfinance/medir-sandbox.js
 *   3. Para apagar o consentimento criado:
 *        node scripts/openfinance/medir-sandbox.js --revogar <consentId>
 *
 * O que ele faz na rede: cria UM consentimento no ambiente sandbox (que a
 * documentação diz nunca ser cobrado) e só faz leituras depois. Nenhuma
 * rota de produção é tocada — a base /api/v2/sandbox é isolada, e um
 * recurso do outro ambiente responde 404.
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.polp.com.br/api/v2';
const SANDBOX = BASE + '/sandbox';

/* O CPF é o do exemplo da própria documentação da Polp: no sandbox não há
 * titular de verdade por trás dele, e os dados são gerados pela Polp. */
const CPF_DO_EXEMPLO = process.env.POLP_CPF_TESTE || '12345678900';

// ---------------------------------------------------------------- credenciais
/** Lê do ambiente ou do .env da API. O segredo nunca é impresso. */
function credenciais() {
  let client = process.env.POLP_API_CLIENT;
  let secret = process.env.POLP_API_SECRET;
  if (!client || !secret) {
    // Dois níveis acima: scripts/openfinance/ -> gestor-financeiro-api/
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
      'arquivo .env da API (gestor-financeiro-api/.env) e rode de novo.\n' +
      'Elas não vão para o git: o .env está no .gitignore.',
    );
    process.exit(1);
  }
  return { client, secret };
}

const { client, secret } = credenciais();

async function pedir(url, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: {
      'x-api-client': client,
      'x-api-secret': secret,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch (e) { corpo = { _bruto: texto }; }
  if (!r.ok) {
    // 401/402/403 têm significados distintos — ver a página de Autenticação.
    const dica = { 401: 'credenciais', 402: 'plano/fatura (não deveria ocorrer no sandbox)', 403: 'conta pendente de aprovação' }[r.status];
    throw new Error('HTTP ' + r.status + (dica ? ' (' + dica + ')' : '') + ': ' + JSON.stringify(corpo).slice(0, 400));
  }
  return corpo;
}

const dados = (x) => (x && x.data) || [];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const mesDe = (iso) => String(iso || '').slice(0, 7);

// ---------------------------------------------------------------- revogar
async function revogar(id) {
  await pedir(SANDBOX + '/consents/' + id, { method: 'DELETE' });
  console.log('Consentimento ' + id + ' revogado.');
}

// ---------------------------------------------------------------- medir
async function medir() {
  // 1. A lista de instituições é pública e serve aos dois ambientes.
  const instituicoes = dados(await pedir(BASE + '/institutions'));
  const inst =
    instituicoes.find((i) => i.type === 'PERSONAL') ||
    instituicoes.find((i) => i.type === 'BOTH') ||
    instituicoes[0];
  if (!inst) throw new Error('GET /institutions não devolveu nenhuma instituição.');
  console.log('Instituição: ' + (inst.name || inst.id) + '  [' + inst.type + ']\n');

  // 2. Um consentimento sandbox nasce AUTHORISED, sem tela de banco.
  const criado = await pedir(SANDBOX + '/consents', {
    method: 'POST',
    body: JSON.stringify({
      institution_id: inst.id,
      cpf: CPF_DO_EXEMPLO,
      cliente_user_id: 'medicao-saldonline',
      products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
    }),
  });
  const consent = criado.data;
  console.log('Consentimento: ' + consent.id);
  console.log('  status=' + consent.status + '  execution=' + consent.execution_status);
  console.log('  (para apagar: node medir-polp-sandbox.js --revogar ' + consent.id + ')\n');

  // 3. Os recursos chegam "em instantes", conforme a importação processa.
  let cartoes = [];
  for (let tentativa = 1; tentativa <= 20; tentativa++) {
    cartoes = dados(await pedir(SANDBOX + '/consents/' + consent.id + '/credit-cards'));
    if (cartoes.length) break;
    process.stdout.write('\r  esperando os cartões… ' + tentativa * 3 + 's');
    await esperar(3000);
  }
  console.log('');
  if (!cartoes.length) {
    console.log('Nenhum cartão apareceu. O consentimento segue vivo: rode de novo ou revogue.');
    return;
  }

  for (const cartao of cartoes) {
    console.log('\n================================================================');
    console.log('CARTÃO ' + (cartao.name || cartao.identification_number || cartao.id));
    console.log('================================================================');

    // 4. As faturas: é delas que saem os dois candidatos a "mês".
    const faturas = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/bills'));
    const porId = {};
    console.log('\nFATURAS');
    console.log('  ' + 'fecha'.padEnd(12) + 'vence'.padEnd(12) + 'mês do fecha'.padEnd(14) + 'mês do vence'.padEnd(14) + 'total');
    for (const f of faturas) {
      porId[f.id] = f;
      console.log(
        '  ' + String(f.bill_closing_date).padEnd(12) + String(f.due_date).padEnd(12) +
        mesDe(f.bill_closing_date).padEnd(14) + mesDe(f.due_date).padEnd(14) +
        ((f.bill_total_amount || {}).amount || '—'),
      );
    }

    // 5. A RESPOSTA: para cada parcela já faturada, o forecast bate com o
    //    mês do fechamento ou com o mês do vencimento?
    const transacoes = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/transactions'));
    const faturadas = transacoes.filter((t) => t.bill_id && porId[t.bill_id]);
    let comoFecha = 0, comoVence = 0, nenhum = 0;
    for (const t of faturadas) {
      const f = porId[t.bill_id];
      if (t.bill_forecast_date === mesDe(f.bill_closing_date)) comoFecha++;
      else if (t.bill_forecast_date === mesDe(f.due_date)) comoVence++;
      else nenhum++;
    }
    console.log('\nO QUE É `bill_forecast_date` (sobre ' + faturadas.length + ' transações já faturadas)');
    console.log('  bate com o mês do FECHAMENTO: ' + comoFecha);
    console.log('  bate com o mês do VENCIMENTO: ' + comoVence);
    console.log('  não bate com nenhum dos dois: ' + nenhum);
    if (comoFecha && comoVence) {
      console.log('  ATENÇÃO: os dois contam — provavelmente há fatura que fecha e vence no mesmo mês,');
      console.log('  que é justamente o caso em que os dois nomes coincidem e nada se prova. Veja a tabela abaixo.');
    }

    // 6. As parcelas, que é onde a duplicação mora.
    const parcelamentos = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/installments'));
    console.log('\nPARCELAMENTOS (' + parcelamentos.length + ')');
    const porTx = {};
    for (const t of transacoes) porTx[t.id] = t;
    for (const p of parcelamentos) {
      console.log('\n  ' + p.description + ' — ' + p.totalInstallments + 'x de ' + p.amount);
      console.log('    ' + 'parc'.padEnd(7) + 'compra'.padEnd(12) + 'forecast'.padEnd(10) +
                  'bill_post_date'.padEnd(16) + 'tem fatura?');
      for (const id of p.occurrences) {
        const t = porTx[id];
        if (!t) { console.log('    (transação ' + id + ' fora das 50 mais recentes)'); continue; }
        const qual = t.bill_id ? 'sim' : 'NÃO (futura)';
        console.log(
          '    ' + (t.charge_identificator + '/' + t.charge_number).padEnd(7) +
          String(t.transaction_date_time).slice(0, 10).padEnd(12) +
          String(t.bill_forecast_date).padEnd(10) +
          String(t.bill_post_date).padEnd(16) + qual,
        );
      }
    }

    // 7. Quantas parcelas FUTURAS vêm no pacote: é o tamanho exato da
    //    colisão com as parcelas que o app projeta sozinho.
    const futuras = transacoes.filter((t) => !t.bill_id && t.charge_number > 1);
    console.log('\n  Parcelas futuras que o banco já entrega: ' + futuras.length);
    if (futuras.length) {
      const meses = Array.from(new Set(futuras.map((t) => t.bill_forecast_date))).sort();
      console.log('  Nas faturas previstas: ' + meses.join(', '));
    }
  }

  // 8. Uma amostra da conta, só para ver a forma do lançamento.
  const contas = dados(await pedir(SANDBOX + '/consents/' + consent.id + '/accounts'));
  if (contas.length) {
    const tx = dados(await pedir(SANDBOX + '/accounts/' + contas[0].id + '/transactions'));
    console.log('\n================================================================');
    console.log('CONTA — 5 primeiras transações (forma do lançamento)');
    console.log('================================================================');
    for (const t of tx.slice(0, 5)) {
      console.log(
        '  ' + String(t.transaction_date_time).slice(0, 10) + '  ' +
        String(t.credit_debit_type).padEnd(8) +
        String((t.transaction_amount || {}).amount).padStart(10) + '  ' +
        String(t.category_ref || '—').padEnd(28) + (t.transaction_name || ''),
      );
    }
    console.log('\n  (o valor vem como STRING e SEM sinal: quem diz a direção é credit_debit_type)');
  }

  console.log('\nTerminado. Para apagar o que foi criado:');
  console.log('  node medir-polp-sandbox.js --revogar ' + consent.id);
}

// ---------------------------------------------------------------- entrada
const argumento = process.argv[2];
const promessa = argumento === '--revogar'
  ? revogar(process.argv[3])
  : medir();

promessa.catch((e) => {
  console.error('\nFalhou: ' + e.message);
  process.exit(1);
});
