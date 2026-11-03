// ============================================================
// billing-cycle.ts
// ============================================================
// Datas do ciclo de fatura de um cartão — o ÚNICO lugar que as calcula.
// Usado por: resolveInvoicePeriod (em qual fatura cai uma compra),
// criação do cartão, job diário (próximo ciclo) e montarFaturas.
//
// O CICLO É UMA LINHA DO TEMPO, e não um par de dias. Banco deixa mudar o
// vencimento, e o fechamento muda junto — mas só da fatura escolhida em
// diante: o que já fechou continua com as datas que teve. Por isso tudo aqui
// recebe o CARTÃO (com os períodos dele), e não dois números: os dias que
// valem dependem de QUAL fatura está sendo calculada.
//
// Cartão que nunca mudou de ciclo tem um período só, e cai exatamente na
// conta de sempre. Sem período nenhum — uma consulta que não trouxe a lista —
// valem as colunas do próprio cartão, que são o período de agora. As duas
// saídas existem para que nenhuma leitura precise saber da linha do tempo
// para continuar certa.
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

/** Um período do ciclo: estes dias valem da fatura `validFrom` em diante. */
export interface PeriodoDoCiclo {
  validFrom: Date; // dia 1 do mês de referência
  closingDay: number;
  dueDay: number;
}

/** O cartão, do ponto de vista do ciclo. `cycles` é a linha do tempo; sem ela
 * valem as colunas, que são o período de agora. */
export interface CicloDoCartao {
  closingDay: number;
  dueDay: number;
  cycles?: PeriodoDoCiclo[];
}

/** Os dias que valem para a fatura de referência (ano, mes0): os do último
 * período que começou até ela.
 *
 * A linha do tempo vem ordenada do banco, mas a ordenação é refeita aqui: uma
 * consulta sem `orderBy` devolve as linhas na ordem em que o Postgres as
 * encontrou, e o "último período" viraria "o último que apareceu". */
export function diasDaReferencia(ano: number, mes0: number, cartao: CicloDoCartao): { closingDay: number; dueDay: number } {
  const periodos = cartao.cycles;
  if (!periodos || !periodos.length) return { closingDay: cartao.closingDay, dueDay: cartao.dueDay };
  const alvo = Date.UTC(ano, mes0, 1);
  let escolhido: PeriodoDoCiclo | null = null;
  for (const p of periodos) {
    if (p.validFrom.getTime() > alvo) continue;
    if (!escolhido || p.validFrom.getTime() > escolhido.validFrom.getTime()) escolhido = p;
  }
  // Nenhum período começou até esta fatura: ela é anterior ao primeiro, e
  // quem responde por ela é o mais antigo que existe. Acontece com fatura
  // importada de antes do cadastro do cartão.
  if (!escolhido) {
    escolhido = periodos.reduce((a, b) => (a.validFrom.getTime() <= b.validFrom.getTime() ? a : b));
  }
  return { closingDay: escolhido.closingDay, dueDay: escolhido.dueDay };
}

export function diasNoMes(ano: number, mes0: number): number {
  return new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
}

/** Dia do mês limitado ao último dia válido daquele mês. */
function diaValido(ano: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes0, Math.min(dia, diasNoMes(ano, mes0))));
}

/** Datas da fatura de referência (ano, mes0), pelos dias que valem PARA ELA.
 * É por aqui que a linha do tempo entra em tudo o que calcula fatura. */
export function datasDaReferencia(ano: number, mes0: number, cartao: CicloDoCartao): DatasDoCiclo {
  const dias = diasDaReferencia(ano, mes0, cartao);
  return datasDoCiclo(ano, mes0, dias.closingDay, dias.dueDay);
}

/** Datas da fatura cujo mês de referência é (ano, mes0), com os dias dados.
 * Continua pública porque é a conta de calendário pura — quem já sabe os dias
 * da referência chama direto. */
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

/**
 * Em qual fatura cai uma compra feita em `data`: até o dia do fechamento
 * (inclusive) é a do mês; depois, a do mês seguinte. O fechamento considerado
 * é o do próprio mês, já limitado ao último dia (fecha "31" em abril = 30).
 *
 * Com a linha do tempo, o fechamento olhado é o do MÊS DA COMPRA — e é só
 * isso que faz a troca de ciclo funcionar, porque o fechamento de uma
 * referência mora sempre dentro do mês dela, e por isso as datas de
 * fechamento crescem de mês em mês aconteça o que acontecer. Um passo
 * basta: a do mês seguinte fecha depois, sempre.
 *
 * Na virada, o resultado é a fatura mais longa (ou mais curta) que o banco
 * mesmo faz. Fecha 1 virando fecha 10 a partir de fevereiro: a compra de
 * 05/01 vai para fevereiro (5 > 1), a de 05/02 fica em fevereiro (5 <= 10),
 * e a fatura de fevereiro junta de 02/01 a 10/02.
 */
export function cicloDaData(data: Date, cartao: CicloDoCartao): DatasDoCiclo {
  let ano = data.getUTCFullYear();
  let mes0 = data.getUTCMonth();
  const dias = diasDaReferencia(ano, mes0, cartao);
  const fechamentoNoMes = Math.min(dias.closingDay, diasNoMes(ano, mes0));
  if (data.getUTCDate() > fechamentoNoMes) {
    mes0 += 1;
    if (mes0 > 11) {
      mes0 = 0;
      ano += 1;
    }
  }
  return datasDaReferencia(ano, mes0, cartao);
}

/** As faturas VIRADAS de um cartão: mês de referência ('AAAA-MM') → o dia em
 * que a virada foi registrada ('AAAA-MM-DD'). */
export type Viradas = Record<string, string>;

/** Mês de referência de um ciclo, como 'AAAA-MM'. */
function mesDoCiclo(c: DatasDoCiclo): string {
  return c.referenceMonth.toISOString().slice(0, 7);
}

function cicloSeguinte(c: DatasDoCiclo, cartao: CicloDoCartao): DatasDoCiclo {
  const ano = c.referenceMonth.getUTCFullYear();
  const mes0 = c.referenceMonth.getUTCMonth();
  return mes0 === 11 ? datasDaReferencia(ano + 1, 0, cartao) : datasDaReferencia(ano, mes0 + 1, cartao);
}

/**
 * Em qual fatura cai uma compra quando faturas foram VIRADAS — fechadas antes
 * do dia do calendário, como o "Virar fatura" do Itaú/Iti.
 *
 * Virada é fato de UMA fatura, e não um fechamento novo do cartão: a compra do
 * dia da virada, ou de depois dela, cai na fatura SEGUINTE; a de antes continua
 * na fatura que fechou. É daí que vem o ganho de quem vira — a compra de 25/11
 * que ia vencer em dezembro passa a vencer em janeiro.
 *
 * O laço existe porque virar duas vezes seguidas é possível: virada a fatura de
 * dezembro, a atual passa a ser a de janeiro, e ela também pode ser virada no
 * mesmo mês. Sem o laço, a segunda virada seria ignorada.
 */
export function cicloDaDataVirada(data: Date, cartao: CicloDoCartao, viradas: Viradas): DatasDoCiclo {
  let ciclo = cicloDaData(data, cartao);
  const diaDaCompra = data.toISOString().slice(0, 10);
  for (let guarda = 0; guarda < 24; guarda++) {
    const virada = viradas[mesDoCiclo(ciclo)];
    if (!virada || diaDaCompra < virada) return ciclo;
    ciclo = cicloSeguinte(ciclo, cartao);
  }
  return ciclo;
}

/** Ciclo corrente para um "hoje" dado como dia do calendário ('AAAA-MM-DD'),
 * já no fuso do app — ver `hojeNoFuso` em invoice-statement.ts. */
export function cicloDoDia(hoje: string, cartao: CicloDoCartao): DatasDoCiclo {
  return cicloDaData(new Date(hoje + 'T00:00:00.000Z'), cartao);
}

/** Datas da fatura de um mês dado como 'AAAA-MM'. */
export function datasDoMesChave(chave: string, cartao: CicloDoCartao): DatasDoCiclo {
  const [ano, mes] = chave.split('-').map(Number);
  return datasDaReferencia(ano, mes - 1, cartao);
}
