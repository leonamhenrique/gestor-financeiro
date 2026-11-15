/* =====================================================================
 * medir-forecast.js — a pergunta que o primeiro script não respondeu.
 *
 *   `bill_forecast_date` é o mês em que a fatura FECHA ou em que ela VENCE?
 *
 * A documentação diz só "mês/ano de faturamento", e a fatura traz os dois
 * campos separados (`bill_closing_date` e `due_date`). Como o saldonline
 * chama a fatura pelo mês do VENCIMENTO e a guarda pela chave do
 * FECHAMENTO, errar isso joga cada parcela uma fatura adiante — e duplica
 * contra a parcela que o app já projetou.
 *
 * A resposta só existe num cartão cuja fatura feche num mês e vença no
 * seguinte; onde os dois meses coincidem, coincidência não é prova. Este
 * script varre instituições atrás desse cartão, conta os dois casos de
 * forma INDEPENDENTE (foi um `else if` que estragou a primeira medição) e
 * diz em alto e bom som quando a amostra é inconclusiva. Consentimento que
 * não serve é revogado na hora.
 *
 * Rodado em 07/11/2026: INCONCLUSIVO em 21 cartões de 10 instituições — o
 * vencimento veio sempre fechamento + 7 dias, com fechamento nunca acima do
 * dia 18. Vale rodar de novo se a Polp mudar o gerador.
 *
 * COMO RODAR
 *   node scripts/openfinance/medir-forecast.js
 *   (POLP_MAX_INST muda quantas instituições tentar; o padrão é 10.)
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.polp.com.br/api/v2';
const SANDBOX = BASE + '/sandbox';
const CPF = process.env.POLP_CPF_TESTE || '12345678900';
const QUANTAS_INSTITUICOES = Number(process.env.POLP_MAX_INST || 10);

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
  if (!client || !secret) { console.error('Faltam POLP_API_CLIENT / POLP_API_SECRET.'); process.exit(1); }
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

/* A data vem como "2026-10-16T03:00:00.000000Z": meia-noite de Brasília
 * gravada em UTC. Os 10 primeiros caracteres são o dia certo; converter
 * para hora local devolveria o dia ANTERIOR. */
const dia = (iso) => String(iso || '').slice(0, 10);
const mes = (iso) => String(iso || '').slice(0, 7);

async function main() {
  const instituicoes = dados(await pedir(BASE + '/institutions'))
    .filter((i) => i.type === 'PERSONAL' || i.type === 'BOTH');
  console.log('Instituições candidatas: ' + instituicoes.length +
              ' (vou tentar até ' + QUANTAS_INSTITUICOES + ')\n');

  const criados = [];
  let provaFecha = 0, provaVence = 0, provaNenhum = 0, cartoesUteis = 0;

  try {
    for (const inst of instituicoes.slice(0, QUANTAS_INSTITUICOES)) {
      let consent;
      try {
        consent = (await pedir(SANDBOX + '/consents', {
          method: 'POST',
          body: JSON.stringify({
            institution_id: inst.id, cpf: CPF,
            cliente_user_id: 'medicao-forecast',
            products: ['CREDIT_CARD_ACCOUNT'],
          }),
        })).data;
      } catch (e) {
        console.log((inst.name || inst.id).padEnd(28) + ' — não deu para criar: ' + e.message.slice(0, 60));
        continue;
      }
      criados.push(consent.id);

      let cartoes = [];
      for (let i = 0; i < 10 && !cartoes.length; i++) {
        cartoes = dados(await pedir(SANDBOX + '/consents/' + consent.id + '/credit-cards'));
        if (!cartoes.length) await esperar(2500);
      }

      let achouAqui = false;
      for (const cartao of cartoes) {
        const faturas = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/bills'));
        const atravessa = faturas.filter((f) => mes(f.bill_closing_date) !== mes(f.due_date));
        const nome = (inst.name || inst.id) + ' / ' + (cartao.name || cartao.id);

        if (!atravessa.length) {
          const f = faturas[0];
          console.log('  ' + nome.padEnd(52) +
            (f ? 'fecha ' + dia(f.bill_closing_date) + ' vence ' + dia(f.due_date) + '  (mesmo mês — não prova)'
               : 'sem fatura'));
          continue;
        }

        achouAqui = true;
        cartoesUteis++;
        console.log('\n>>> SERVE: ' + nome);
        const porId = {};
        for (const f of faturas) porId[f.id] = f;
        for (const f of atravessa) {
          console.log('    fatura ' + f.id.slice(0, 8) + '  fecha ' + dia(f.bill_closing_date) +
                      ' (' + mes(f.bill_closing_date) + ')   vence ' + dia(f.due_date) +
                      ' (' + mes(f.due_date) + ')');
        }

        const txs = dados(await pedir(SANDBOX + '/credit-cards/' + cartao.id + '/transactions'));
        // Só as que estão NUMA fatura que atravessa o mês: as outras não
        // distinguem nada.
        const uteis = txs.filter((t) => t.bill_id && porId[t.bill_id] &&
          mes(porId[t.bill_id].bill_closing_date) !== mes(porId[t.bill_id].due_date));
        for (const t of uteis) {
          const f = porId[t.bill_id];
          // Contados de forma INDEPENDENTE — foi o `else if` que estragou
          // a primeira medição.
          if (t.bill_forecast_date === mes(f.bill_closing_date)) provaFecha++;
          if (t.bill_forecast_date === mes(f.due_date)) provaVence++;
          if (t.bill_forecast_date !== mes(f.bill_closing_date) &&
              t.bill_forecast_date !== mes(f.due_date)) provaNenhum++;
        }
        console.log('    transações nessas faturas: ' + uteis.length);
        if (uteis[0]) {
          const f = porId[uteis[0].bill_id];
          console.log('    exemplo: forecast=' + uteis[0].bill_forecast_date +
                      '  fecha=' + mes(f.bill_closing_date) + '  vence=' + mes(f.due_date));
        }
      }
      if (!achouAqui) { await pedir(SANDBOX + '/consents/' + consent.id, { method: 'DELETE' }); criados.pop(); }
      if (cartoesUteis >= 2) break;
    }

    console.log('\n================ VEREDITO ================');
    if (!cartoesUteis) {
      console.log('INCONCLUSIVO: nenhum cartão do sandbox tem fatura que feche num mês');
      console.log('e vença no seguinte. Sem isso os dois candidatos coincidem sempre, e');
      console.log('qualquer número aqui seria coincidência, não prova.');
    } else {
      console.log('bate com o mês do FECHAMENTO: ' + provaFecha);
      console.log('bate com o mês do VENCIMENTO: ' + provaVence);
      console.log('não bate com nenhum:          ' + provaNenhum);
      if (provaFecha && !provaVence) console.log('\n→ `bill_forecast_date` é o mês do FECHAMENTO.');
      else if (provaVence && !provaFecha) console.log('\n→ `bill_forecast_date` é o mês do VENCIMENTO.');
      else console.log('\n→ Ainda ambíguo. Não concluir daqui.');
    }
  } finally {
    for (const id of criados) {
      try { await pedir(SANDBOX + '/consents/' + id, { method: 'DELETE' }); } catch (e) {}
    }
    if (criados.length) console.log('\n(' + criados.length + ' consentimento(s) revogado(s).)');
  }
}

main().catch((e) => { console.error('\nFalhou: ' + e.message); process.exit(1); });
