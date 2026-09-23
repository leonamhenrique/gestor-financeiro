// ============================================================
// invoice-statement.ts
// ============================================================
// A sequência de faturas de um cartão, calculada de uma vez — a ÚNICA
// fonte das regras de fatura: status, quanto falta pagar, rotativo e
// quanto ocupa do limite. Leitura, pagamento, limite disponível e o job
// diário chamam esta função; nenhum deles decide essas coisas por conta.
//
// Regras (as mesmas do app):
// - Uma fatura aceita quantos pagamentos o usuário quiser até o vencimento.
// - Rotativo: se houve pagamento, sobrou saldo e o vencimento passou, o que
//   sobrou é TRANSPORTADO para a fatura seguinte (sem juros aqui). A de
//   origem fecha como CARRIED e deixa de ocupar limite; a seguinte passa a
//   dever esse valor.
// - Sem pagamento nenhum não há transporte: a dívida continua inteira no mês
//   em que venceu (OVERDUE), para não sumir de onde nasceu.
// - O dia do vencimento ainda é dia de pagar: "venceu" é a partir do dia
//   seguinte. Por isso as datas são comparadas como dia do calendário no
//   fuso do app, nunca como instante.
// ============================================================

import { datasDoMesChave } from './billing-cycle';

export type StatusFatura = 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID' | 'CARRIED';

export interface FaturaGravada {
  id: string;
  referenceMonth: Date; // dia 1 do mês de referência
  closingDate: Date;
  dueDate: Date;
  totalAmount: unknown; // Decimal do Prisma: soma das compras CONFIRMADAS
  payments: { id: string; amount: unknown; paidAt: Date; bankAccountId: string }[];
}

export interface FaturaCalculada {
  id: string | null; // null = fatura que só existe porque recebeu transporte
  referenceMonth: string; // 'YYYY-MM'
  closingDate: string; // 'YYYY-MM-DD'
  dueDate: string;
  purchases: number; // compras confirmadas do mês
  carriedIn: number; // veio da fatura anterior (rotativo)
  due: number; // purchases + carriedIn
  paid: number;
  carriedOut: number; // foi para a fatura seguinte
  openAmount: number; // quanto ocupa do limite (negativo = saldo credor)
  payable: number; // quanto ainda dá para pagar nesta fatura (nunca negativo)
  status: StatusFatura;
  payments: { id: string; amount: number; paidAt: string; bankAccountId: string }[];
}

export const FUSO_DO_APP = process.env.APP_TIMEZONE ?? 'America/Sao_Paulo';

/** "Hoje" como dia do calendário no fuso do app — 'YYYY-MM-DD'. */
export function hojeNoFuso(agora: Date = new Date(), fuso: string = FUSO_DO_APP): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** Colunas @db.Date chegam como meia-noite UTC; o dia é a parte de data. */
export function dia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function chaveDoMes(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Dinheiro em centavos inteiros durante a conta, para não acumular erro de
 * ponto flutuante numa cadeia de meses. */
function centavos(v: unknown): number {
  return Math.round(Number(v ?? 0) * 100);
}
const reais = (c: number) => c / 100;

function proximoMes(chave: string): string {
  const [a, m] = chave.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
}

/** Datas de fechamento e vencimento de um mês para um cartão. A conta de
 * verdade é de billing-cycle.ts (vencimento no mês seguinte, último dia
 * válido); aqui só acrescenta as versões em texto para comparar dias. */
export function datasDoMes(chave: string, closingDay: number, dueDay: number) {
  const datas = datasDoMesChave(chave, closingDay, dueDay);
  return { ...datas, closingStr: dia(datas.closingDate), dueStr: dia(datas.dueDate) };
}

export function montarFaturas(
  cartao: { closingDay: number; dueDay: number },
  gravadas: FaturaGravada[],
  hoje: string = hojeNoFuso(),
): FaturaCalculada[] {
  const ordenadas = [...gravadas].sort((a, b) => a.referenceMonth.getTime() - b.referenceMonth.getTime());
  const porMes = new Map(ordenadas.map((f) => [chaveDoMes(f.referenceMonth), f]));
  const resultado: FaturaCalculada[] = [];
  if (!ordenadas.length) return resultado;

  let chave = chaveDoMes(ordenadas[0].referenceMonth);
  const ultima = chaveDoMes(ordenadas[ordenadas.length - 1].referenceMonth);
  let transporte = 0; // em centavos

  // Anda mês a mês (não só pelas faturas gravadas): um transporte pode cair
  // num mês sem compra nenhuma, e ele precisa aparecer.
  for (let guarda = 0; guarda < 1200; guarda++) {
    const gravada = porMes.get(chave);
    if (gravada || transporte > 0) {
      // Datas pelo ciclo do cartão, não pelas colunas gravadas: faturas
      // criadas antes da correção de billing-cycle.ts podem ter vencimento
      // no mês errado. O ciclo não muda depois que há faturas
      // (updateBillingCycle bloqueia), então a conta é sempre a mesma.
      const datas = datasDoMes(chave, cartao.closingDay, cartao.dueDay);
      const compras = gravada ? centavos(gravada.totalAmount) : 0;
      const pagamentos = (gravada?.payments ?? [])
        .map((p) => ({ id: p.id, amount: centavos(p.amount), paidAt: dia(p.paidAt), bankAccountId: p.bankAccountId }))
        .sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1));
      const pago = pagamentos.reduce((s, p) => s + p.amount, 0);

      const devido = compras + transporte;
      const restante = devido - pago;
      const venceu = hoje > datas.dueStr;
      const fechou = hoje > datas.closingStr;
      const levado = pago > 0 && restante > 0 && venceu ? restante : 0;

      let status: StatusFatura;
      if (levado > 0) status = 'CARRIED';
      else if (devido > 0 && pago >= devido) status = 'PAID';
      else if (!fechou) status = 'OPEN';
      else if (venceu && restante > 0) status = 'OVERDUE';
      else status = 'CLOSED';

      resultado.push({
        id: gravada?.id ?? null,
        referenceMonth: chave,
        closingDate: datas.closingStr,
        dueDate: datas.dueStr,
        purchases: reais(compras),
        carriedIn: reais(transporte),
        due: reais(devido),
        paid: reais(pago),
        carriedOut: reais(levado),
        // Transportada não ocupa mais limite aqui — o valor está na seguinte.
        // Saldo credor (estorno maior que as compras) fica negativo e aumenta
        // o disponível, como já era decidido para o cartão.
        openAmount: reais(levado > 0 ? 0 : restante),
        payable: reais(levado > 0 ? 0 : Math.max(0, restante)),
        status,
        payments: pagamentos.map((p) => ({ ...p, amount: reais(p.amount) })),
      });
      transporte = levado;
    } else {
      transporte = 0;
    }

    if (chave >= ultima && transporte <= 0) break;
    chave = proximoMes(chave);
  }
  return resultado;
}

/** Quanto do limite está em uso: a soma do que está em aberto em todas as
 * faturas (transportadas contam zero; saldo credor desconta). */
export function limiteEmUso(faturas: FaturaCalculada[]): number {
  return reais(faturas.reduce((s, f) => s + centavos(f.openAmount), 0));
}

/** A fatura "atual": a mais antiga que ainda tem algo a pagar. */
export function faturaAtual(faturas: FaturaCalculada[]): FaturaCalculada | null {
  return faturas.find((f) => f.payable > 0) ?? null;
}
