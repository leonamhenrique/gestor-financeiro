// ============================================================
// report.utils.ts
// ============================================================
// As contas do relatório de fluxo de caixa, puras: entram dados, saem
// números. Nada aqui toca Prisma, data de hoje implícita ou fuso — tudo
// é parâmetro, para o teste poder fixar o mundo.
//
// Dinheiro é `Prisma.Decimal` do começo ao fim. Em Float, somar 0,1 doze
// vezes não dá 1,2, e um relatório que não fecha no centavo não serve para
// nada. Quem serializa converte para string na borda (ver `emReais`).
// ============================================================

import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
export const ZERO = new D(0);

export type Dinheiro = Prisma.Decimal;

/** Decimal a partir do que vier do banco (Decimal, string ou número). */
export function dec(v: unknown): Dinheiro {
  if (v instanceof D) return v;
  return new D((v ?? 0) as never);
}

/** Dinheiro na borda da API: string com duas casas, nunca Float. */
export function emReais(v: Dinheiro): string {
  return v.toFixed(2);
}

export function soma(valores: Dinheiro[]): Dinheiro {
  return valores.reduce((s, v) => s.plus(v), ZERO);
}

/** 'YYYY-MM' de uma data, lida em UTC — as colunas são `@db.Date`. */
export function chaveDoMes(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function mesesDoAno(ano: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
}

/** Trimestre (1–4) de um mês 'YYYY-MM'. */
export function trimestreDoMes(chave: string): number {
  return Math.floor((Number(chave.slice(5, 7)) - 1) / 3) + 1;
}

// ------------------------------------------------------------
// Lançamento, já normalizado para o relatório
// ------------------------------------------------------------

export interface LancamentoDoRelatorio {
  /** Mês em que o dinheiro entra ou sai do caixa — para compra de cartão,
   * é o mês de VENCIMENTO da fatura, não o da compra. */
  mes: string;
  tipo: 'INCOME' | 'EXPENSE';
  valor: Dinheiro;
  categoriaId: string | null;
  /** O que o usuário escreveu ("Aluguel"), não o nome da categoria
   * ("Moradia"): na lista do que vem pela frente, é o lançamento que ele
   * reconhece, e a categoria é só a etiqueta ao lado. */
  descricao: string | null;
  /** Já confirmado = dinheiro que de fato se moveu. Previsto = intenção. */
  confirmado: boolean;
  /** Repetição fixa (aluguel, assinatura) — separa fixo de variável sem
   * precisar de um campo novo na categoria. */
  recorrente: boolean;
}

// ------------------------------------------------------------
// Fluxo mês a mês
// ------------------------------------------------------------

export interface MesDoFluxo {
  month: string;
  income: Dinheiro;
  expense: Dinheiro;
  net: Dinheiro;
  balance: Dinheiro;
  isForecast: boolean;
}

/**
 * O fluxo dos doze meses do ano.
 *
 * O corte realizado × previsto é **o mês**, como a referência mostra ("real"
 * até setembro, "prev." de outubro em diante): o mês corrente ainda está
 * acontecendo, mas o que ele já tem é dinheiro de verdade, então ele conta
 * como realizado. Mês posterior ao corrente é previsão.
 *
 * Dentro de um mês realizado só entra o CONFIRMADO: no schema deste app,
 * `isConfirmed` é o que de fato mexeu no saldo da conta e no total da
 * fatura. Uma conta vencida e não paga tem data no passado e não é dinheiro
 * que saiu — ela é pendência, não realizado.
 *
 * O saldo acumulado parte do saldo inicial das contas e vai somando o fluxo,
 * de janeiro a dezembro.
 */
export function fluxoPorMes(
  lancamentos: LancamentoDoRelatorio[],
  ano: number,
  mesCorrente: string,
  saldoInicial: Dinheiro,
  estimativaVariavel: Map<string, Dinheiro> = new Map(),
): MesDoFluxo[] {
  const meses = mesesDoAno(ano);
  const porMes = new Map(meses.map((m) => [m, { income: ZERO, expense: ZERO }]));

  for (const l of lancamentos) {
    const alvo = porMes.get(l.mes);
    if (!alvo) continue; // fora do ano pedido
    const previsto = l.mes > mesCorrente;
    // Mês realizado conta só o confirmado; mês previsto conta o agendado,
    // que por definição ainda não foi confirmado.
    if (!previsto && !l.confirmado) continue;
    if (l.tipo === 'INCOME') alvo.income = alvo.income.plus(l.valor);
    else alvo.expense = alvo.expense.plus(l.valor);
  }

  let saldo = saldoInicial;
  return meses.map((m) => {
    const base = porMes.get(m)!;
    const previsto = m > mesCorrente;
    // A estimativa de gasto variável só entra em mês previsto: no realizado
    // o gasto já aconteceu e está nos lançamentos.
    const expense = previsto ? base.expense.plus(estimativaVariavel.get(m) ?? ZERO) : base.expense;
    const net = base.income.minus(expense);
    saldo = saldo.plus(net);
    return { month: m, income: base.income, expense, net, balance: saldo, isForecast: previsto };
  });
}

// ------------------------------------------------------------
// Estimativa de gasto variável
// ------------------------------------------------------------

/**
 * Quanto ainda deve sair num mês previsto além do que já está agendado.
 *
 * Fórmula:
 *
 *     media = (soma dos gastos VARIÁVEIS dos últimos N meses realizados) / N
 *     estimativa = max(0, media − já agendado como variável no mês previsto)
 *
 * Três decisões, e o porquê de cada uma:
 *
 * - **Só gasto variável entra na média.** O fixo (aluguel, assinatura) já
 *   aparece como lançamento agendado no mês previsto; somá-lo à média o
 *   contaria duas vezes.
 * - **Desconta o que já está agendado.** Quem já lançou o mercado do mês
 *   que vem não deve vê-lo somado de novo por estimativa.
 * - **Nunca é negativa.** Se o agendado já passa da média, a estimativa é
 *   zero — e não um crédito que inventaria dinheiro.
 *
 * Sem mês realizado nenhum a média não existe, e a estimativa é zero: é
 * melhor prever de menos do que inventar um número sem base.
 */
export function estimarGastoVariavel(
  historicoVariavelPorMes: Dinheiro[],
  jaAgendadoVariavel: Dinheiro,
): Dinheiro {
  if (!historicoVariavelPorMes.length) return ZERO;
  const media = soma(historicoVariavelPorMes).dividedBy(historicoVariavelPorMes.length);
  const resto = media.minus(jaAgendadoVariavel);
  return resto.greaterThan(0) ? resto : ZERO;
}

/** Os N meses realizados mais recentes, do mais antigo para o mais novo. */
export function ultimosMesesRealizados(ano: number, mesCorrente: string, n: number): string[] {
  const todos = mesesDoAno(ano).filter((m) => m <= mesCorrente);
  return todos.slice(Math.max(0, todos.length - n));
}

// ------------------------------------------------------------
// Categorias
// ------------------------------------------------------------

export interface CategoriaDoRelatorio {
  categoryId: string;
  name: string;
  amount: Dinheiro;
  share: number; // 0–1
  deltaQuarter: number; // variação contra o trimestre anterior, em fração
}

/**
 * Variação de um trimestre contra o anterior, em fração (0,21 = +21%).
 *
 * Sem base (trimestre anterior zerado) a variação é **0**, não infinito nem
 * 100%: não há de onde medir crescimento, e mostrar "+∞%" seria pior que
 * calar. Quem precisa distinguir "novo" de "estável" olha o valor absoluto.
 */
export function variacaoTrimestre(atual: Dinheiro, anterior: Dinheiro): number {
  if (anterior.lessThanOrEqualTo(0)) return 0;
  return Number(atual.minus(anterior).dividedBy(anterior).toFixed(4));
}

/** Participação de um valor no total, em fração. Total zero → 0. */
export function participacao(valor: Dinheiro, total: Dinheiro): number {
  if (total.lessThanOrEqualTo(0)) return 0;
  return Number(valor.dividedBy(total).toFixed(4));
}

/**
 * Despesas por categoria no período realizado, da maior para a menor, com a
 * participação e a variação do trimestre corrente contra o anterior.
 */
export interface ParTrimestres {
  atual: { ano: number; tri: number };
  anterior: { ano: number; tri: number };
}

/**
 * Os dois trimestres que a comparação usa: os dois últimos **completos**.
 *
 * Comparar um trimestre pela metade com um inteiro é comparar coisas
 * diferentes — no dia 1º de outubro, o 4º trimestre tem um mês de dados e o
 * 3º tem três, e toda categoria apareceria caindo 66%. O trimestre corrente
 * só entra depois de fechado; antes disso a leitura é a dos dois anteriores,
 * e a resposta diz quais foram para a tela poder rotular com honestidade.
 */
export function trimestresComparaveis(mesCorrente: string): ParTrimestres {
  const ano = Number(mesCorrente.slice(0, 4));
  const tri = trimestreDoMes(mesCorrente);
  const completo = Number(mesCorrente.slice(5, 7)) === tri * 3; // último mês do trimestre
  const recua = (a: number, t: number, n: number) => {
    let ano2 = a, tri2 = t;
    for (let i = 0; i < n; i++) { tri2 -= 1; if (tri2 === 0) { tri2 = 4; ano2 -= 1; } }
    return { ano: ano2, tri: tri2 };
  };
  const atual = completo ? { ano, tri } : recua(ano, tri, 1);
  return { atual, anterior: recua(atual.ano, atual.tri, 1) };
}

export function despesasPorCategoria(
  lancamentos: LancamentoDoRelatorio[],
  nomePorCategoria: Map<string, string>,
  mesCorrente: string,
): CategoriaDoRelatorio[] {
  const realizados = lancamentos.filter(
    (l) => l.tipo === 'EXPENSE' && l.confirmado && l.mes <= mesCorrente,
  );
  const total = soma(realizados.map((l) => l.valor));

  const par = trimestresComparaveis(mesCorrente);
  const triAtual = par.atual.tri;
  const anoDoMes = par.atual.ano;
  const triAnterior = par.anterior.tri;
  const anoDoAnterior = par.anterior.ano;
  const noTrimestre = (l: LancamentoDoRelatorio, tri: number, ano: number) =>
    Number(l.mes.slice(0, 4)) === ano && trimestreDoMes(l.mes) === tri;

  const porCategoria = new Map<string, { amount: Dinheiro; atual: Dinheiro; anterior: Dinheiro }>();
  for (const l of realizados) {
    const id = l.categoriaId ?? 'sem-categoria';
    const atual = porCategoria.get(id) ?? { amount: ZERO, atual: ZERO, anterior: ZERO };
    atual.amount = atual.amount.plus(l.valor);
    if (noTrimestre(l, triAtual, anoDoMes)) atual.atual = atual.atual.plus(l.valor);
    if (noTrimestre(l, triAnterior, anoDoAnterior)) atual.anterior = atual.anterior.plus(l.valor);
    porCategoria.set(id, atual);
  }

  return [...porCategoria.entries()]
    .map(([categoryId, v]) => ({
      categoryId,
      name: nomePorCategoria.get(categoryId) ?? 'Sem categoria',
      amount: v.amount,
      share: participacao(v.amount, total),
      deltaQuarter: variacaoTrimestre(v.atual, v.anterior),
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

// ------------------------------------------------------------
// Indicadores
// ------------------------------------------------------------

export interface Indicadores {
  currentBalance: Dinheiro;
  realizedIncome: Dinheiro;
  realizedExpense: Dinheiro;
  savingsRate: number; // fração do que sobrou da receita realizada
  projectedYearEndBalance: Dinheiro;
}

/**
 * Taxa de poupança: quanto da receita sobrou. Receita zero → 0, porque não
 * se guarda fração de nada. Pode ser negativa: gastar mais do que entrou é
 * um fato, e arredondá-lo para zero esconderia justamente o mês ruim.
 */
export function taxaDePoupanca(receita: Dinheiro, despesa: Dinheiro): number {
  if (receita.lessThanOrEqualTo(0)) return 0;
  return Number(receita.minus(despesa).dividedBy(receita).toFixed(4));
}

export function indicadores(meses: MesDoFluxo[], saldoAtual: Dinheiro): Indicadores {
  const realizados = meses.filter((m) => !m.isForecast);
  const receita = soma(realizados.map((m) => m.income));
  const despesa = soma(realizados.map((m) => m.expense));
  return {
    currentBalance: saldoAtual,
    realizedIncome: receita,
    realizedExpense: despesa,
    savingsRate: taxaDePoupanca(receita, despesa),
    projectedYearEndBalance: meses.length ? meses[meses.length - 1].balance : saldoAtual,
  };
}
