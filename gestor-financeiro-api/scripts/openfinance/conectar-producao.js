/* =====================================================================
 * conectar-producao.js — o cartão de VERDADE, que o sandbox não produz.
 *
 * Bancada, como os vizinhos: não é importado pelo app e não grava nada no
 * banco de dados. A diferença é que este fala com PRODUÇÃO, e produção tem
 * duas consequências que o sandbox não tem:
 *
 *   1. consentimento autorizado é COBRADO (R$ 3,60/mês na primeira faixa);
 *   2. os dados são financeiros de verdade, de uma pessoa de verdade.
 *
 * Por isso ele é explícito em cada passo, cria UM consentimento por vez e
 * nunca cria nada sem o comando `--conectar`.
 *
 * POR QUE ELE EXISTE
 * A dúvida que o sandbox não respondeu: `bill_forecast_date` segue o mês do
 * FECHAMENTO ou o do VENCIMENTO? Em 21 cartões fictícios o vencimento veio
 * sempre 7 dias depois do fechamento, nunca atravessando o mês — os dois
 * candidatos coincidiam. Um cartão real que feche num mês e vença no outro
 * (o Iti fecha 30 e vence 7) separa os dois em uma leitura.
 *
 * O CPF
 * Vem de `POLP_CPF` no `.env` da API, nunca da linha de comando e nunca do
 * chat: `.env` está no .gitignore, e o histórico do terminal não está.
 *
 * COMO RODAR
 *   node scripts/openfinance/conectar-producao.js --bancos iti
 *       lista as instituições que casam com o nome (não cria nada)
 *   node scripts/openfinance/conectar-producao.js --conectar <institutionId>
 *       cria UM consentimento e imprime o link de autorização  [COBRA]
 *   node scripts/openfinance/conectar-producao.js --status <consentId>
 *       mostra em que pé está a autorização
 *   node scripts/openfinance/conectar-producao.js --medir <consentId>
 *       lê os cartões e RESPONDE a pergunta do mês
 *   node scripts/openfinance/conectar-producao.js --revogar <consentId>
 *       revoga na Polp e para a cobrança
 * ===================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.polp.com.br/api/v2';

// ---------------------------------------------------------------- .env
/** Lê chaves e CPF do ambiente ou do .env da API. Nada disso é impresso. */
function doEnv(nomes) {
  const achado = {};
  for (const n of nomes) if (process.env[n]) achado[n] = process.env[n];
  const env = path.resolve(__dirname, '..', '..', '.env');
  if (fs.existsSync(env)) {
    for (const linha of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || !nomes.includes(m[1]) || achado[m[1]]) continue;
      achado[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return achado;
}

const env = doEnv(['POLP_API_CLIENT', 'POLP_API_SECRET', 'POLP_CPF']);
const client = env.POLP_API_CLIENT;
const secret = env.POLP_API_SECRET;

if (!client || !secret) {
  console.error('Faltam POLP_API_CLIENT e POLP_API_SECRET no .env da API.');
  process.exit(1);
}

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
    const dica = { 401: 'credenciais', 402: 'plano/fatura', 403: 'conta pendente' }[r.status];
    throw new Error('HTTP ' + r.status + (dica ? ' (' + dica + ')' : '') + ': ' +
      JSON.stringify(corpo).slice(0, 400));
  }
  return corpo;
}

const dados = (x) => (x && x.data) || [];
/* Corta os 10 primeiros caracteres: as datas chegam como meia-noite de
 * Brasília escrita em UTC (`...T03:00:00Z`), e converter para hora local
 * tira um dia — num cartão que fecha dia 30 isso muda a fatura. */
const dia = (iso) => String(iso || '').slice(0, 10);
const mes = (iso) => String(iso || '').slice(0, 7);

// ---------------------------------------------------------------- bancos
async function bancos(filtro) {
  const todas = dados(await pedir(BASE + '/institutions'));
  const achadas = filtro
    ? todas.filter((i) => String(i.name || '').toLowerCase().includes(filtro.toLowerCase()))
    : todas.filter((i) => i.status === 'OPERATIONAL');
  if (!achadas.length) return console.log('Nenhuma instituição com esse nome.');
  for (const i of achadas) {
    console.log((i.status === 'OPERATIONAL' ? '  ' : '! ') + i.name +
      '  [' + i.type + ']  ' + i.status);
    console.log('      ' + i.id);
  }
  console.log('\nPara conectar:  --conectar <id>   (cria consentimento COBRÁVEL)');
}

// ---------------------------------------------------------------- conectar
async function conectar(institutionId) {
  if (!env.POLP_CPF) {
    console.error(
      'Falta POLP_CPF no .env da API.\n' +
      'Abra gestor-financeiro-api/.env e acrescente a linha:\n' +
      '  POLP_CPF=00000000000\n' +
      'Só dígitos. O .env está no .gitignore e não vai para o GitHub.',
    );
    process.exit(1);
  }
  const cpf = env.POLP_CPF.replace(/\D/g, '');

  const inst = dados(await pedir(BASE + '/institutions'))
    .find((i) => i.id === institutionId);
  if (!inst) throw new Error('Instituição ' + institutionId + ' não existe no catálogo.');
  if (inst.status !== 'OPERATIONAL') {
    console.log('AVISO: ' + inst.name + ' está ' + inst.status + ', a conexão pode falhar.');
  }

  console.log('Criando UM consentimento de produção em ' + inst.name + '.');
  console.log('Isso passa a custar R$ 3,60/mês quando a autorização concluir.\n');

  const criado = await pedir(BASE + '/consents', {
    method: 'POST',
    body: JSON.stringify({
      institution_id: inst.id,
      cpf,
      cliente_user_id: 'saldonline-teste',
      products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
    }),
  });
  const c = criado.data || {};
  console.log('Consentimento: ' + c.id);
  console.log('  status=' + c.status + '  execution=' + (c.execution_status || '—'));
  console.log('\nAUTORIZE NO BANCO, você mesmo, por este link:');
  console.log('  ' + (c.url_to_authenticate || '(a API não devolveu link)'));
  console.log('\nDepois:');
  console.log('  --status ' + c.id + '     (ver se autorizou)');
  console.log('  --medir  ' + c.id + '     (ler os cartões)');
  console.log('  --revogar ' + c.id + '    (desfazer e parar a cobrança)');
}

// ---------------------------------------------------------------- status
async function status(id) {
  const c = (await pedir(BASE + '/consents/' + id)).data || {};
  console.log('Consentimento ' + id);
  console.log('  status=' + c.status + '  execution=' + (c.execution_status || '—'));
  if (c.status !== 'AUTHORISED') {
    console.log('\nAinda não autorizado. O link de autorização é o `url_to_authenticate`');
    console.log('que saiu no --conectar; ele expira, e aí é criar outro.');
    return;
  }
  const contas = dados(await pedir(BASE + '/consents/' + id + '/accounts'));
  const cartoes = dados(await pedir(BASE + '/consents/' + id + '/credit-cards'));
  console.log('  contas=' + contas.length + '  cartões=' + cartoes.length);
  if (!contas.length && !cartoes.length) {
    console.log('\nAutorizado, mas os recursos ainda estão sincronizando. Rode de novo em instantes.');
  }
}

// ---------------------------------------------------------------- medir
/**
 * A resposta da pergunta do mês.
 *
 * Para cada parcela FUTURA (a que só tem `bill_forecast_date`), olha a
 * fatura do mesmo cartão e pergunta: o mês previsto bate com o mês do
 * FECHAMENTO ou com o do VENCIMENTO? Num cartão que atravessa o mês os dois
 * são diferentes, e a resposta sai sozinha.
 */
async function medir(id) {
  const cartoes = dados(await pedir(BASE + '/consents/' + id + '/credit-cards'));
  if (!cartoes.length) return console.log('Nenhum cartão neste consentimento.');

  let votosFechamento = 0;
  let votosVencimento = 0;
  let inconclusivos = 0;

  for (const cartao of cartoes) {
    console.log('\n=== ' + (cartao.name || cartao.product_type || cartao.id));

    const faturas = dados(await pedir(BASE + '/credit-cards/' + cartao.id + '/bills'));
    if (!faturas.length) { console.log('  (sem faturas)'); continue; }

    for (const f of faturas) {
      const fecha = dia(f.bill_closing_date);
      const vence = dia(f.due_date);
      const atravessa = mes(fecha) !== mes(vence);
      console.log('  fatura ' + (f.id || '').slice(0, 8) +
        '  fecha ' + fecha + '  vence ' + vence +
        (atravessa ? '   <-- ATRAVESSA O MÊS' : ''));
    }

    // A fatura mais recente serve de régua: dela saem os dois candidatos.
    const regua = faturas
      .slice()
      .sort((a, b) => String(b.bill_closing_date).localeCompare(String(a.bill_closing_date)))[0];
    const mesFecha = mes(regua.bill_closing_date);
    const mesVence = mes(regua.due_date);

    let parcelamentos = [];
    try {
      parcelamentos = dados(await pedir(BASE + '/credit-cards/' + cartao.id + '/installments'));
    } catch (e) {
      console.log('  installments: ' + e.message.slice(0, 120));
    }

    for (const p of parcelamentos) {
      for (const o of p.occurrences || []) {
        const futura = !o.bill_id;
        if (!futura) continue;
        const prev = mes(o.bill_forecast_date);
        const casaFecha = prev === mesFecha;
        const casaVence = prev === mesVence;
        console.log('  parcela futura "' + (p.description || '').slice(0, 28) +
          '"  forecast=' + prev +
          '  (fechamento=' + mesFecha + ', vencimento=' + mesVence + ')');
        if (mesFecha === mesVence) { inconclusivos++; continue; }
        if (casaFecha && !casaVence) votosFechamento++;
        else if (casaVence && !casaFecha) votosVencimento++;
        else inconclusivos++;
      }
    }
  }

  console.log('\n----------------------------------------------------------');
  console.log('bill_forecast_date segue o FECHAMENTO em ' + votosFechamento + ' parcela(s)');
  console.log('bill_forecast_date segue o VENCIMENTO em ' + votosVencimento + ' parcela(s)');
  console.log('inconclusivas (os dois meses coincidem, ou nenhum bate): ' + inconclusivos);
  if (!votosFechamento && !votosVencimento) {
    console.log('\nINCONCLUSIVO: nenhum cartão deste consentimento atravessa o mês,');
    console.log('ou não há parcela futura. A pergunta continua em aberto.');
  }
}

// ---------------------------------------------------------------- revogar
async function revogar(id) {
  await pedir(BASE + '/consents/' + id, { method: 'DELETE' });
  console.log('Consentimento ' + id + ' revogado. A cobrança para.');
  console.log('Confira com: node scripts/openfinance/conferir-plano.js');
}

// ---------------------------------------------------------------- main
const [comando, arg] = process.argv.slice(2);
const acoes = {
  '--bancos': () => bancos(arg),
  '--conectar': () => conectar(arg),
  '--status': () => status(arg),
  '--medir': () => medir(arg),
  '--revogar': () => revogar(arg),
};

if (!acoes[comando] || (comando !== '--bancos' && !arg)) {
  console.log('Uso:');
  console.log('  --bancos [nome]        lista instituições (não cria nada)');
  console.log('  --conectar <instId>    cria UM consentimento  [COBRA R$ 3,60/mês]');
  console.log('  --status <consentId>   em que pé está');
  console.log('  --medir <consentId>    lê os cartões e responde a pergunta do mês');
  console.log('  --revogar <consentId>  desfaz e para a cobrança');
  process.exit(1);
}

acoes[comando]().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
