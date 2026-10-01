// ============================================================
// reports.service.ts
// ============================================================
// O relatório de fluxo de caixa de um ano. Lê do banco, normaliza e entrega
// as contas para as funções puras de `report.utils.ts` — a regra de negócio
// mora lá, testável sem Prisma; aqui só mora a busca.
//
// Duas decisões que valem a leitura, porque é nelas que um relatório de
// cartão costuma mentir:
//
// 1. **A compra de cartão entra no mês em que a FATURA vence**, não no da
//    compra: é quando o dinheiro sai da conta. Ela guarda a própria
//    categoria, então o fluxo mensal e o "para onde foi o dinheiro" leem os
//    MESMOS registros e os totais fecham. Um atribuindo por vencimento e o
//    outro por data de compra daria dois totais diferentes na mesma tela.
//
// 2. **`InvoicePayment` nunca é somado.** Ele é a fatura saindo da conta, e
//    as compras que a formaram já foram contadas. Contar os dois é o erro
//    clássico de dobrar a despesa do cartão.
// ============================================================

import { Injectable } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { resolveInvoicePeriod } from '../transactions/transaction.utils';
import { datasDoMesChave } from '../credit-cards/billing-cycle';
import { hojeNoFuso } from '../credit-cards/invoice-statement';
import { PrismaService } from '../prisma/prisma.service';
import { InsightsService } from './insights.service';
import {
  CategoriaDoRelatorio,
  Dinheiro,
  LancamentoDoRelatorio,
  MesDoFluxo,
  ZERO,
  chaveDoMes,
  dec,
  despesasPorCategoria,
  emReais,
  estimarGastoVariavel,
  fluxoPorMes,
  indicadores,
  mesesDoAno,
  soma,
  trimestresComparaveis,
  ultimosMesesRealizados,
} from './report.utils';

/** Quantos meses realizados a média de gasto variável olha para trás. */
const MESES_DE_HISTORICO = 3;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
  ) {}

  async cashflow(userId: string, ano: number) {
    const hoje = hojeNoFuso();
    const mesCorrente = hoje.slice(0, 7);

    const [contas, cartoes, categorias, transacoes] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { userId } }),
      this.prisma.creditCard.findMany({ where: { userId } }),
      this.prisma.category.findMany({ where: { OR: [{ userId }, { userId: null }] } }),
      // O trimestre anterior pode cair no ano passado (quando o corrente é o
      // primeiro), então a janela começa um ano antes.
      this.prisma.transaction.findMany({
        where: {
          userId,
          transactionDate: {
            gte: new Date(Date.UTC(ano - 1, 0, 1)),
            lt: new Date(Date.UTC(ano + 1, 0, 1)),
          },
        },
        orderBy: { transactionDate: 'asc' },
      }),
    ]);

    const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]));
    const nomePorCategoria = new Map(categorias.map((c) => [c.id, c.name]));

    const lancamentos: LancamentoDoRelatorio[] = transacoes.map((t) => ({
      mes: this.mesDeCaixa(t, cartaoPorId),
      tipo: t.type === TransactionType.INCOME ? 'INCOME' : 'EXPENSE',
      valor: dec(t.amount),
      categoriaId: t.categoryId,
      descricao: t.description,
      confirmado: t.isConfirmed,
      recorrente: t.isRecurring || t.seriesId !== null,
    }));

    // Contas e cartões inativos continuam no histórico: arquivar uma conta
    // não apaga o que passou por ela, e um relatório que some com isso
    // deixaria de fechar com o extrato.
    const saldoInicial = soma(contas.map((c) => dec(c.initialBalance)));
    const saldoAtual = soma(contas.map((c) => dec(c.currentBalance)));

    const estimativa = this.estimativaPorMes(lancamentos, ano, mesCorrente);
    const months = fluxoPorMes(lancamentos, ano, mesCorrente, saldoInicial, estimativa);
    const categories = despesasPorCategoria(
      lancamentos.filter((l) => l.mes.startsWith(String(ano))),
      nomePorCategoria,
      mesCorrente,
    );
    const kpis = indicadores(months, saldoAtual);

    const { upcoming, horizon } = this.olharAdiante(lancamentos, months, mesCorrente, nomePorCategoria, estimativa);

    const insights = this.insights.gerar({
      months,
      categories,
      kpis,
      mesCorrente,
      ...this.recortesDeReceitaEDespesa(lancamentos, categories, ano, mesCorrente),
      agendadoNoMesApertado: this.agendadoPorMesPrevisto(lancamentos, mesCorrente),
    });

    const trimestres = trimestresComparaveis(mesCorrente);

    return {
      year: ano,
      today: hoje,
      // Quais trimestres a coluna "Δ tri" comparou. Sem isto a tela teria de
      // adivinhar, e adivinharia errado no começo de um trimestre.
      quarterComparison: {
        current: `${trimestres.atual.ano}-Q${trimestres.atual.tri}`,
        previous: `${trimestres.anterior.ano}-Q${trimestres.anterior.tri}`,
      },
      kpis: {
        currentBalance: emReais(kpis.currentBalance),
        realizedIncome: emReais(kpis.realizedIncome),
        realizedExpense: emReais(kpis.realizedExpense),
        savingsRate: kpis.savingsRate,
        projectedYearEndBalance: emReais(kpis.projectedYearEndBalance),
      },
      months: months.map((m) => ({
        month: m.month,
        income: emReais(m.income),
        expense: emReais(m.expense),
        net: emReais(m.net),
        balance: emReais(m.balance),
        isForecast: m.isForecast,
      })),
      categories: categories.map((c) => ({
        categoryId: c.categoryId,
        name: c.name,
        amount: emReais(c.amount),
        share: c.share,
        deltaQuarter: c.deltaQuarter,
      })),
      upcoming,
      horizon,
      insights,
    };
  }

  /**
   * O mês em que o lançamento mexe no caixa. Para conta é o próprio mês da
   * data; para cartão é o mês em que a fatura daquela compra VENCE — e o
   * `invoiceMonthOverride` manda, porque antecipar parcela muda a fatura.
   */
  private mesDeCaixa(
    t: { transactionDate: Date; creditCardId: string | null; invoiceMonthOverride: Date | null },
    cartoes: Map<string, { closingDay: number; dueDay: number }>,
  ): string {
    if (!t.creditCardId) return chaveDoMes(t.transactionDate);
    const card = cartoes.get(t.creditCardId);
    if (!card) return chaveDoMes(t.transactionDate); // cartão apagado: cai no próprio mês
    const ciclo = t.invoiceMonthOverride
      ? datasDoMesChave(chaveDoMes(t.invoiceMonthOverride), card.closingDay, card.dueDay)
      : resolveInvoicePeriod(t.transactionDate, card.closingDay, card.dueDay);
    return chaveDoMes(ciclo.dueDate);
  }

  /** Gasto variável = o que não vem de lançamento recorrente. */
  private ehVariavel(l: LancamentoDoRelatorio): boolean {
    return l.tipo === 'EXPENSE' && !l.recorrente;
  }

  /** A estimativa de gasto variável de cada mês previsto do ano. */
  private estimativaPorMes(
    lancamentos: LancamentoDoRelatorio[],
    ano: number,
    mesCorrente: string,
  ): Map<string, Dinheiro> {
    const base = ultimosMesesRealizados(ano, mesCorrente, MESES_DE_HISTORICO);
    const historico = base.map((m) =>
      soma(lancamentos.filter((l) => l.mes === m && l.confirmado && this.ehVariavel(l)).map((l) => l.valor)),
    );
    const previstos = mesesDoAno(ano).filter((m) => m > mesCorrente);
    return new Map(
      previstos.map((m) => {
        const agendado = soma(lancamentos.filter((l) => l.mes === m && this.ehVariavel(l)).map((l) => l.valor));
        return [m, estimarGastoVariavel(historico, agendado)];
      }),
    );
  }

  private agendadoPorMesPrevisto(lancamentos: LancamentoDoRelatorio[], mesCorrente: string): Map<string, Dinheiro> {
    const porMes = new Map<string, Dinheiro>();
    for (const l of lancamentos) {
      if (l.tipo !== 'EXPENSE' || l.mes <= mesCorrente) continue;
      porMes.set(l.mes, (porMes.get(l.mes) ?? ZERO).plus(l.valor));
    }
    return porMes;
  }

  /**
   * Receita principal × extra e despesa fixa, que os insights 2 e 3 pedem.
   * "Principal" é a maior categoria de receita do período — sem campo novo
   * no schema: quem recebe salário o tem como maior entrada, e quem não
   * tem salário não deveria ver um texto sobre depender de renda extra.
   */
  private recortesDeReceitaEDespesa(
    lancamentos: LancamentoDoRelatorio[],
    categories: CategoriaDoRelatorio[],
    ano: number,
    mesCorrente: string,
  ) {
    const realizados = lancamentos.filter(
      (l) => l.confirmado && l.mes.startsWith(String(ano)) && l.mes <= mesCorrente,
    );
    const receitas = realizados.filter((l) => l.tipo === 'INCOME');

    const porCategoria = new Map<string, Dinheiro>();
    for (const l of receitas) {
      const id = l.categoriaId ?? 'sem-categoria';
      porCategoria.set(id, (porCategoria.get(id) ?? ZERO).plus(l.valor));
    }
    const maior = [...porCategoria.values()].reduce((a, b) => (b.greaterThan(a) ? b : a), ZERO);
    const totalReceita = soma(receitas.map((l) => l.valor));

    const despesaFixa = soma(
      realizados.filter((l) => l.tipo === 'EXPENSE' && l.recorrente).map((l) => l.valor),
    );
    // Uma categoria conta como fixa quando a maior parte do que saiu nela é
    // recorrente. É derivado de propósito: não há `Category.isFixed` no
    // schema, e casar por nome ("Moradia") quebraria no primeiro usuário que
    // renomeia a categoria.
    const fixaPorCategoria = new Map<string, { fixo: Dinheiro; total: Dinheiro }>();
    for (const l of realizados) {
      if (l.tipo !== 'EXPENSE') continue;
      const id = l.categoriaId ?? 'sem-categoria';
      const a = fixaPorCategoria.get(id) ?? { fixo: ZERO, total: ZERO };
      a.total = a.total.plus(l.valor);
      if (l.recorrente) a.fixo = a.fixo.plus(l.valor);
      fixaPorCategoria.set(id, a);
    }
    const categoriasFixas = categories
      .filter((c) => {
        const a = fixaPorCategoria.get(c.categoryId);
        return !!a && a.total.greaterThan(0) && a.fixo.dividedBy(a.total).greaterThan(0.5);
      })
      .sort((a, b) => b.amount.comparedTo(a.amount));

    return {
      receitaPrincipal: maior,
      receitaExtra: totalReceita.minus(maior),
      despesaFixa,
      categoriasFixas,
    };
  }

  /**
   * "Para onde vai": os lançamentos do primeiro mês previsto, em ordem de
   * data e com o saldo depois de cada um, mais o resumo dos meses seguintes.
   */
  private olharAdiante(
    lancamentos: LancamentoDoRelatorio[],
    months: MesDoFluxo[],
    mesCorrente: string,
    nomePorCategoria: Map<string, string>,
    estimativa: Map<string, Dinheiro>,
  ) {
    const previstos = months.filter((m) => m.isForecast);
    if (!previstos.length) return { upcoming: [], horizon: [] };

    const alvo = previstos[0];
    const doMes = lancamentos
      .filter((l) => l.mes === alvo.month)
      .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'INCOME' ? -1 : 1));

    // O saldo de partida é o do fim do mês anterior ao previsto.
    const anterior = months[months.indexOf(alvo) - 1];
    let saldo = anterior ? anterior.balance : ZERO;

    const upcoming = doMes.map((l) => {
      saldo = l.tipo === 'INCOME' ? saldo.plus(l.valor) : saldo.minus(l.valor);
      return {
        date: alvo.month,
        description: l.descricao ?? nomePorCategoria.get(l.categoriaId ?? '') ?? 'Lançamento',
        tag: nomePorCategoria.get(l.categoriaId ?? '') ?? (l.tipo === 'INCOME' ? 'Receita' : 'Despesa'),
        amount: emReais(l.tipo === 'INCOME' ? l.valor : l.valor.negated()),
        balanceAfter: emReais(saldo),
      };
    });

    // A estimativa fecha a lista como uma linha só: ela não é um lançamento,
    // é o que a média diz que ainda vai sair.
    const estimado = estimativa.get(alvo.month) ?? ZERO;
    if (estimado.greaterThan(0)) {
      saldo = saldo.minus(estimado);
      upcoming.push({
        date: alvo.month,
        description: 'Gastos variáveis (estimativa)',
        tag: 'Estimativa',
        amount: emReais(estimado.negated()),
        balanceAfter: emReais(saldo),
      });
    }

    const horizon = previstos.slice(1).map((m) => ({
      month: m.month,
      income: emReais(m.income),
      expense: emReais(m.expense),
      net: emReais(m.net),
      balance: emReais(m.balance),
    }));

    return { upcoming, horizon };
  }
}
