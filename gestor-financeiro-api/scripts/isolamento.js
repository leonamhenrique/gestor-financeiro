// ============================================================
// scripts/isolamento.js
// ============================================================
// Prova de que um usuario nao alcanca o dado de outro. Nao e teste de
// unidade: sobe dois usuarios DE VERDADE na API de verdade e ataca.
//
//   npm run build && npm run start:prod   (noutro terminal)
//   node scripts/isolamento.js
//
// Fica fora do `npm test` de proposito: aquele roda com Prisma falso e sem
// banco, e um teste que precisa de Postgres quebraria em qualquer maquina
// que nao tenha um. O valor deste aqui e justamente exercitar a pilha
// inteira -- guard, controller, service e banco -- que o teste de unidade
// nao ve. Rode depois de mexer em qualquer rota.
//
// Um usuario mexer em categoria PADRAO (userId null) nao e vazamento: elas
// sao compartilhadas de proposito. Por isso o teste cria uma categoria
// propria da Alice para atacar.
// ============================================================
const API = "http://localhost:3000";

async function chamar(caminho, { metodo = "GET", token, corpo } = {}) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

async function novoUsuario(nome) {
  const email = `iso-${nome}-${Date.now()}@local.test`;
  const senha = "Iso" + Math.random().toString(36).slice(2, 10) + "!7";
  const r = await chamar("/auth/register", { metodo: "POST", corpo: { name: nome, email, password: senha } });
  if (!r.json?.accessToken) throw new Error("registro falhou: " + JSON.stringify(r));
  return { email, token: r.json.accessToken, id: r.json.user?.id };
}

(async () => {
  const A = await novoUsuario("Alice");
  const B = await novoUsuario("Bruno");

  // A monta a vida dela
  const contaA = (await chamar("/bank-accounts", { metodo: "POST", token: A.token,
    corpo: { institutionName: "Banco da Alice", accountType: "CHECKING", initialBalance: 5000 } })).json;
  // Categoria PROPRIA da Alice. As padrao do sistema tem userId null e sao
  // compartilhadas de proposito -- usar uma delas nao e vazamento.
  const catA = (await chamar("/categories", { metodo: "POST", token: A.token,
    corpo: { name: "Segredo da Alice", type: "EXPENSE" } })).json;
  const cartaoA = (await chamar("/credit-cards", { metodo: "POST", token: A.token,
    corpo: { name: "Cartao da Alice", limitAmount: 4000, closingDay: 10, dueDay: 17, bankAccountId: contaA.id } })).json;
  const lancA = (await chamar("/transactions", { metodo: "POST", token: A.token,
    corpo: { type: "EXPENSE", amount: 123.45, categoryId: catA.id, transactionDate: "2026-09-20",
             bankAccountId: contaA.id, description: "Segredo da Alice" } })).json;

  // Contas de B (para a tentativa de gravar no lugar errado)
  const contaB = (await chamar("/bank-accounts", { metodo: "POST", token: B.token,
    corpo: { institutionName: "Banco do Bruno", accountType: "CHECKING", initialBalance: 10 } })).json;
  const catB = (await chamar("/categories", { metodo: "POST", token: B.token,
    corpo: { name: "Coisa do Bruno", type: "EXPENSE" } })).json;

  const tentativas = [];
  const t = async (o_que, fn, esperado) => {
    const r = await fn();
    const corpoTexto = JSON.stringify(r.json || "").slice(0, 90);
    tentativas.push({ o_que, status: r.status, ok: esperado(r), amostra: corpoTexto });
  };

  const vazio = (r) => {
    const d = Array.isArray(r.json) ? r.json : r.json?.data;
    return Array.isArray(d) && d.every(x => x.id !== lancA?.id && x.id !== contaA?.id && x.id !== cartaoA?.id);
  };
  const negado = (r) => r.status === 403 || r.status === 404 || r.status === 400;

  await t("B lista lancamentos -> nao ve o de A", () => chamar("/transactions", { token: B.token }), vazio);
  await t("B lista contas -> nao ve a de A", () => chamar("/bank-accounts", { token: B.token }), vazio);
  await t("B lista cartoes -> nao ve o de A", () => chamar("/credit-cards", { token: B.token }), vazio);
  await t("B le o lancamento de A pelo id", () => chamar("/transactions/" + lancA.id, { token: B.token }), negado);
  await t("B edita o lancamento de A", () => chamar("/transactions/" + lancA.id, { metodo: "PATCH", token: B.token, corpo: { amount: 1 } }), negado);
  await t("B apaga o lancamento de A", () => chamar("/transactions/" + lancA.id, { metodo: "DELETE", token: B.token }), negado);
  await t("B confirma o lancamento de A", () => chamar("/transactions/" + lancA.id + "/confirm", { metodo: "POST", token: B.token }), negado);
  await t("B le a conta de A pelo id", () => chamar("/bank-accounts/" + contaA.id, { token: B.token }), negado);
  await t("B edita a conta de A", () => chamar("/bank-accounts/" + contaA.id, { metodo: "PATCH", token: B.token, corpo: { institutionName: "Invadido" } }), negado);
  await t("B le o cartao de A", () => chamar("/credit-cards/" + cartaoA.id, { token: B.token }), negado);
  await t("B le os pagamentos de fatura do cartao de A", () => chamar("/credit-cards/" + cartaoA.id + "/payments", { token: B.token }), negado);
  await t("B LANCA na conta de A (o furo classico)", () => chamar("/transactions", { metodo: "POST", token: B.token,
    corpo: { type: "EXPENSE", amount: 999, categoryId: catB.id, transactionDate: "2026-09-20", bankAccountId: contaA.id } }), negado);
  await t("B LANCA no cartao de A", () => chamar("/transactions", { metodo: "POST", token: B.token,
    corpo: { type: "EXPENSE", amount: 999, categoryId: catB.id, transactionDate: "2026-09-20", creditCardId: cartaoA.id } }), negado);
  await t("B usa a categoria PROPRIA de A no lancamento dele", () => chamar("/transactions", { metodo: "POST", token: B.token,
    corpo: { type: "EXPENSE", amount: 5, categoryId: catA.id, transactionDate: "2026-09-20", bankAccountId: contaB.id } }), negado);
  await t("B lista categorias -> nao ve a propria de A", () => chamar("/categories", { token: B.token }),
    (r) => { const d = Array.isArray(r.json) ? r.json : r.json?.data || []; return !d.some(c => c.id === catA.id); });
  await t("B renomeia a categoria propria de A", () => chamar("/categories/" + catA.id, { metodo: "PATCH", token: B.token, corpo: { name: "Invadida" } }), negado);
  await t("B apaga a categoria propria de A", () => chamar("/categories/" + catA.id, { metodo: "DELETE", token: B.token }), negado);
  await t("sem token nenhum", () => chamar("/transactions"), (r) => r.status === 401);

  console.log("\n=== tentativas do usuario B contra os dados do usuario A ===\n");
  for (const x of tentativas) {
    console.log((x.ok ? "  BLOQUEADO " : "  *** PASSOU *** ") + "[" + x.status + "] " + x.o_que);
    if (!x.ok) console.log("      resposta: " + x.amostra);
  }
  const furos = tentativas.filter(x => !x.ok).length;
  console.log("\n" + tentativas.length + " tentativas, " + furos + " passaram.\n");

  // confere que a conta da Alice segue intacta
  const contaDepois = (await chamar("/bank-accounts/" + contaA.id, { token: A.token })).json;
  console.log("saldo da conta da Alice depois de tudo:", contaDepois?.currentBalance, "(esperado 4876.55)");
  console.log("nome da conta da Alice:", contaDepois?.institutionName);
})();
