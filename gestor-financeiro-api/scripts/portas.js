// ============================================================
// scripts/portas.js
// ============================================================
// Varredura de portas: bate em toda rota SEM token.
//
//   node scripts/portas.js      (com a API rodando)
//
// Rota de dado tem de responder 401 do guard; rota publica tem de passar
// por ele. Existe para o item 2 nao se desfazer sozinho: o guard e global,
// mas alguem pode pendurar um @Public() a mais sem querer, e isso nao da
// erro nenhum -- so abre a porta.
// ============================================================
const API = "http://localhost:3000";
const bater = async (metodo, caminho, corpo) => {
  const r = await fetch(API + caminho, { method: metodo,
    headers: { "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  const m = Array.isArray(j?.message) ? j.message[0] : (j?.message || "");
  return { status: r.status, msg: String(m) };
};
// 401 do GUARD diz "Unauthorized". 401 do proprio endpoint diz outra coisa --
// "Sessao expirada", "Assinatura invalida" -- e significa que a rota e aberta
// e recusou o CONTEUDO. Sem essa distincao a varredura acusa rota publica de
// fechada, que foi o que aconteceu na primeira versao deste script.
const doGuard = (r) => r.status === 401 && (r.msg === "Unauthorized" || r.msg === "");
const DADO = [
  ["GET", "/transactions"], ["POST", "/transactions", {}], ["GET", "/transactions/x"],
  ["PATCH", "/transactions/x", {}], ["DELETE", "/transactions/x"],
  ["GET", "/bank-accounts"], ["POST", "/bank-accounts", {}], ["GET", "/bank-accounts/x"],
  ["PATCH", "/bank-accounts/x", {}], ["DELETE", "/bank-accounts/x"],
  ["GET", "/categories"], ["POST", "/categories", {}], ["PATCH", "/categories/x", {}], ["DELETE", "/categories/x"],
  ["GET", "/credit-cards"], ["POST", "/credit-cards", {}], ["GET", "/credit-cards/x"],
  ["PATCH", "/credit-cards/x", {}], ["DELETE", "/credit-cards/x"],
  ["GET", "/credit-cards/x/payments"], ["POST", "/credit-cards/x/invoices/2026-09/payments", {}],
  ["PATCH", "/credit-cards/x/payments/y", {}], ["DELETE", "/credit-cards/x/payments/y"],
  ["GET", "/billing/subscription"], ["POST", "/billing/subscribe", {}], ["DELETE", "/billing/subscription"],
  ["GET", "/auth/me"], ["POST", "/auth/change-password", {}],
];
const PUBLICA = [
  ["GET", "/"], ["POST", "/auth/register", {}], ["POST", "/auth/login", {}],
  ["POST", "/auth/refresh", {}], ["POST", "/auth/logout", {}],
  ["POST", "/auth/forgot-password", {}], ["POST", "/auth/reset-password", {}],
  ["POST", "/billing/webhook", {}],
];
(async () => {
  console.log("\n=== rotas de dado, SEM token (tem de dar 401) ===");
  let furos = 0;
  for (const [m, c, b] of DADO) {
    const r = await bater(m, c, b);
    const ok = doGuard(r);
    if (!ok) furos++;
    console.log((ok ? "  401 " : "  *** " + r.status + " *** ") + m + " " + c + (ok ? "" : "   -> " + r.msg));
  }
  console.log("\n=== rotas publicas (NAO pode dar 401) ===");
  let fechadas = 0;
  for (const [m, c, b] of PUBLICA) {
    const r = await bater(m, c, b);
    const ok = !doGuard(r);
    if (!ok) fechadas++;
    console.log((ok ? "  " + r.status + "  " : "  *** FECHADA *** ") + m + " " + c + "   " + (r.msg ? '"' + r.msg.slice(0, 44) + '"' : ""));
  }
  console.log("\nrotas de dado abertas por engano: " + furos);
  console.log("rotas publicas fechadas por engano: " + fechadas + "\n");
})();
