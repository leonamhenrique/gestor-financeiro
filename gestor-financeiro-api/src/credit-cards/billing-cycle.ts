// ============================================================
// billing-cycle.ts
// ============================================================
// Datas do ciclo de fatura de um cartão — o ÚNICO lugar que as calcula.
// Usado por: resolveInvoicePeriod (em qual fatura cai uma compra),
// criação do cartão, job diário (próximo ciclo) e montarFaturas.
//
// Convenção: tudo em UTC. As colunas são `@db.Date`, que o Prisma entrega
// como meia-noite UTC do dia, e datas "AAAA-MM-DD" vindas da API viram
// meia-noite UTC. Ler com getDate() local (fuso do Brasil) devolveria o dia
// ANTERIOR — uma compra do dia 11 viraria dia 10 e cairia na fatura errada.
//
// Duas regras de calendário:
// 1. Dia inexistente no mês vai para o último dia válido: fechamento ou
//    vencimento "dia 31" em fevereiro é 28 (29 em ano bissexto), em abril 30.
//    Sem isso, `Date.UTC(2026, 1, 31)` vira 3 de março.
// 2. Vencimento no mesmo dia ou antes do fechamento no calendário é no mês
//    SEGUINTE: fecha 28 e vence 5 → a fatura que fecha em 28/09 vence em
//    05/10. Vencimento sempre vem depois do fechamento — conferido com os
//    dias já ajustados ao mês (fecha 29/vence 30 em fevereiro → 28/02 e 30/03).
// ============================================================

export interface DatasDoCiclo {
  referenceMonth: Date; // dia 1 do mês de referência (o mês do fechamento)
  closingDate: Date;
  dueDate: Date;
}

export function diasNoMes(ano: number, mes0: number): number {
  return new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
}

/** Dia do mês limitado ao último dia válido daquele mês. */
function diaValido(ano: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes0, Math.min(dia, diasNoMes(ano, mes0))));
}

/** Datas da fatura cujo mês de referência é (ano, mes0). */
export function datasDoCiclo(ano: number, mes0: number, closingDay: number, dueDay: number): DatasDoCiclo {
  const closingDate = diaValido(ano, mes0, closingDay);
  // A comparação é entre os dias JÁ ajustados ao mês: fecha 29 e vence 30
  // em fevereiro viram os dois dia 28 — vencer "no mesmo mês" daria
  // vencimento igual ao fechamento. Só fica no mês se cair depois.
  const vencimentoNoMes = diaValido(ano, mes0, dueDay);
  if (vencimentoNoMes.getTime() > closingDate.getTime()) {
    return { referenceMonth: new Date(Date.UTC(ano, mes0, 1)), closingDate, dueDate: vencimentoNoMes };
  }
  const anoVenc = mes0 === 11 ? ano + 1 : ano;
  const mesVenc = (mes0 + 1) % 12;
  return {
    referenceMonth: new Date(Date.UTC(ano, mes0, 1)),
    closingDate,
    dueDate: diaValido(anoVenc, mesVenc, dueDay),
  };
}

/** Em qual fatura cai uma compra feita em `data`: até o dia do fechamento
 * (inclusive) é a do mês; depois, a do mês seguinte. O fechamento considerado
 * é o do próprio mês, já limitado ao último dia (fecha "31" em abril = 30). */
export function cicloDaData(data: Date, closingDay: number, dueDay: number): DatasDoCiclo {
  let ano = data.getUTCFullYear();
  let mes0 = data.getUTCMonth();
  const fechamentoNoMes = Math.min(closingDay, diasNoMes(ano, mes0));
  if (data.getUTCDate() > fechamentoNoMes) {
    mes0 += 1;
    if (mes0 > 11) {
      mes0 = 0;
      ano += 1;
    }
  }
  return datasDoCiclo(ano, mes0, closingDay, dueDay);
}

/** Ciclo corrente para um "hoje" dado como dia do calendário ('AAAA-MM-DD'),
 * já no fuso do app — ver `hojeNoFuso` em invoice-statement.ts. */
export function cicloDoDia(hoje: string, closingDay: number, dueDay: number): DatasDoCiclo {
  return cicloDaData(new Date(hoje + 'T00:00:00.000Z'), closingDay, dueDay);
}

/** Datas da fatura de um mês dado como 'AAAA-MM'. */
export function datasDoMesChave(chave: string, closingDay: number, dueDay: number): DatasDoCiclo {
  const [ano, mes] = chave.split('-').map(Number);
  return datasDoCiclo(ano, mes - 1, closingDay, dueDay);
}
