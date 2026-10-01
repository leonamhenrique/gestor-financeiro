// ============================================================
// insights.service.ts
// ============================================================
// A leitura em palavras dos números do relatório. Seis regras, puras e
// determinísticas: os mesmos dados dão sempre o mesmo texto. Nada de LLM
// aqui — um relatório financeiro que muda de conclusão a cada abertura não
// é um relatório.
//
// Cada regra decide sozinha se tem o que dizer. Sem base, ela devolve
// `null` e simplesmente não aparece: um cartão dizendo "sem dados" ocupa a
// tela para não informar nada, e o vazio já comunica que o ano está no
// começo.
// ============================================================

import { Injectable } from '@nestjs/common';
import { brl, nomeDoMesMaiusculo, nomeDoTrimestre, pct, pctComSinal } from './format';
import {
  CategoriaDoRelatorio,
  Dinheiro,
  Indicadores,
  MesDoFluxo,
  ZERO,
  soma,
  taxaDePoupanca,
  trimestresComparaveis,
} from './report.utils';

export type TomDoInsight = 'positive' | 'attention';

export interface Insight {
  key: string;
  metric: string;
  tone: TomDoInsight;
  title: string;
  text: string;
}

export interface EntradaDosInsights {
  months: MesDoFluxo[];
  categories: CategoriaDoRelatorio[];
  kpis: Indicadores;
  mesCorrente: string;
  /** Receita realizada que veio da fonte principal (a maior categoria de
   * receita) e o resto — é o que separa salário de renda extra. */
  receitaPrincipal: Dinheiro;
  receitaExtra: Dinheiro;
  /** Despesa realizada vinda de lançamentos recorrentes. */
  despesaFixa: Dinheiro;
  /** Categorias cujo gasto é majoritariamente recorrente, da maior para a
   * menor — usadas para nomear o peso do fixo. */
  categoriasFixas: CategoriaDoRelatorio[];
  /** Quanto do mês previsto mais apertado já está agendado (o resto é
   * estimativa de gasto variável). */
  agendadoNoMesApertado: Map<string, Dinheiro>;
}

@Injectable()
export class InsightsService {
  gerar(e: EntradaDosInsights): Insight[] {
    const regras = [
      this.poupancaEMesForaDaCurva,
      this.dependenciaDeRendaExtra,
      this.pesoDosGastosFixos,
      this.categoriasQueMudaramNoTrimestre,
      this.mesPrevistoMaisApertado,
      this.projecaoDeFechamento,
    ];
    return regras.map((r) => r.call(this, e)).filter((i): i is Insight => i !== null);
  }

  // ----------------------------------------------------------
  // 1. Taxa de poupança do período e o mês fora da curva
  // ----------------------------------------------------------
  private poupancaEMesForaDaCurva(e: EntradaDosInsights): Insight | null {
    const realizados = e.months.filter((m) => !m.isForecast && m.income.greaterThan(0));
    // Com um mês só não existe "fora da curva": não há curva.
    if (realizados.length < 2) return null;

    const taxas = realizados.map((m) => ({ mes: m.month, taxa: taxaDePoupanca(m.income, m.expense), m }));
    const media = e.kpis.savingsRate;
    const pior = taxas.reduce((a, b) => (b.taxa < a.taxa ? b : a));
    const melhor = taxas.reduce((a, b) => (b.taxa > a.taxa ? b : a));

    const positivo = media >= 0.1;
    return {
      key: 'savings-rate',
      metric: pct(media),
      tone: positivo ? 'positive' : 'attention',
      title: positivo
        ? 'Poupança sólida, com um mês fora da curva'
        : 'A sobra do período está apertada',
      text:
        `${nomeDoMesMaiusculo(pior.mes)} fechou em ${pct(pior.taxa)}, com despesa de ` +
        `${brl(pior.m.expense)}. O melhor mês foi ${nomeDoMesMaiusculo(melhor.mes).toLowerCase()}, ` +
        `com ${pct(melhor.taxa)} da receita guardada.`,
    };
  }

  // ----------------------------------------------------------
  // 2. Dependência de renda extra
  // ----------------------------------------------------------
  private dependenciaDeRendaExtra(e: EntradaDosInsights): Insight | null {
    const total = e.kpis.realizedIncome;
    if (total.lessThanOrEqualTo(0) || e.receitaExtra.lessThanOrEqualTo(0)) return null;

    const fatia = Number(e.receitaExtra.dividedBy(total).toFixed(4));
    // A pergunta é: e se a renda extra não tivesse vindo? A despesa segue a
    // mesma; só a receita encolhe.
    const semExtra = taxaDePoupanca(e.receitaPrincipal, e.kpis.realizedExpense);

    return {
      key: 'extra-income',
      metric: pct(semExtra),
      tone: semExtra < e.kpis.savingsRate / 2 ? 'attention' : 'positive',
      title: 'Dependência de renda extra',
      text:
        `${brl(e.receitaExtra)} (${pct(fatia)} da receita) vieram de entradas além da principal. ` +
        `Sem elas, a taxa de poupança cairia de ${pct(e.kpis.savingsRate)} para ${pct(semExtra)}.`,
    };
  }

  // ----------------------------------------------------------
  // 3. Peso dos gastos fixos
  // ----------------------------------------------------------
  private pesoDosGastosFixos(e: EntradaDosInsights): Insight | null {
    const total = e.kpis.realizedExpense;
    if (total.lessThanOrEqualTo(0) || e.despesaFixa.lessThanOrEqualTo(0)) return null;

    const fatia = Number(e.despesaFixa.dividedBy(total).toFixed(4));
    const nomes = e.categoriasFixas.slice(0, 3).map((c) => c.name);
    if (!nomes.length) return null;
    // A menor das fixas é a mais fácil de rever: mexer na maior costuma
    // significar mudar de casa ou de escola.
    const menor = e.categoriasFixas[e.categoriasFixas.length - 1];

    return {
      key: 'fixed-weight',
      metric: pct(fatia),
      tone: fatia > 0.5 ? 'attention' : 'positive',
      title:
        fatia > 0.5
          ? 'Mais da metade das despesas é gasto fixo'
          : `Gastos fixos pesam ${(fatia * 10).toFixed(0)} em cada 10 reais`,
      text:
        `${listar(nomes)} somam ${brl(e.despesaFixa)} das despesas. ` +
        `${menor.name} (${brl(menor.amount)}) é a parcela mais simples de revisar.`,
    };
  }

  // ----------------------------------------------------------
  // 4. Categorias que aceleraram ou recuaram no trimestre
  // ----------------------------------------------------------
  private categoriasQueMudaramNoTrimestre(e: EntradaDosInsights): Insight | null {
    const comVariacao = e.categories.filter((c) => c.deltaQuarter !== 0);
    if (comVariacao.length < 2) return null;

    const subiram = comVariacao.filter((c) => c.deltaQuarter > 0).sort((a, b) => b.deltaQuarter - a.deltaQuarter);
    const cairam = comVariacao.filter((c) => c.deltaQuarter < 0).sort((a, b) => a.deltaQuarter - b.deltaQuarter);
    if (!subiram.length) return null;

    // Os mesmos dois trimestres que a tabela comparou — se o texto dissesse
    // outro par, o cartão contradiria a coluna ao lado dele.
    const par = trimestresComparaveis(e.mesCorrente);
    const tri = par.atual.tri;
    const anterior = par.anterior.tri;
    const topo = subiram.slice(0, 2);
    const alivio = cairam.slice(0, 2);

    return {
      key: 'quarter-shift',
      metric: pctComSinal(topo[0].deltaQuarter),
      tone: 'attention',
      title: `${listar(topo.map((c) => c.name))} aceleraram no ${nomeDoTrimestre(tri)}`,
      text:
        `${topo.map((c) => `${c.name} (${pctComSinal(c.deltaQuarter)})`).join(' e ')} subiram frente ao ` +
        `${nomeDoTrimestre(anterior)}.` +
        (alivio.length
          ? ` ${alivio.map((c) => `${c.name} (${pctComSinal(c.deltaQuarter)})`).join(' e ')} ` +
            // Concordância: uma categoria compensou, duas compensaram.
            `${alivio.length === 1 ? 'compensou' : 'compensaram'} parte do aumento.`
          : ''),
    };
  }

  // ----------------------------------------------------------
  // 5. Mês previsto mais apertado
  // ----------------------------------------------------------
  private mesPrevistoMaisApertado(e: EntradaDosInsights): Insight | null {
    const previstos = e.months.filter((m) => m.isForecast && m.income.greaterThan(0));
    if (!previstos.length) return null;

    // "Apertado" é pela SOBRA RELATIVA, não pela absoluta: um mês de receita
    // grande e sobra grande não é apertado só porque outro guardou menos.
    const comTaxa = previstos.map((m) => ({ m, taxa: taxaDePoupanca(m.income, m.expense) }));
    const pior = comTaxa.reduce((a, b) => (b.taxa < a.taxa ? b : a));
    const agendado = e.agendadoNoMesApertado.get(pior.m.month) ?? ZERO;
    const estimado = pior.m.expense.minus(agendado);

    return {
      key: 'tightest-month',
      metric: brl(pior.m.net),
      // 5% exatos também é apertado: o limiar é inclusivo de propósito.
      tone: pior.taxa <= 0.05 ? 'attention' : 'positive',
      title: `${nomeDoMesMaiusculo(pior.m.month)} é o mês previsto mais apertado`,
      text:
        `A sobra prevista é de ${pct(pior.taxa)} da receita, a menor entre os meses previstos. ` +
        `${brl(agendado)} já estão agendados` +
        (estimado.greaterThan(0) ? `; o restante é gasto variável estimado.` : '.'),
    };
  }

  // ----------------------------------------------------------
  // 6. Projeção de fechamento do ano
  // ----------------------------------------------------------
  private projecaoDeFechamento(e: EntradaDosInsights): Insight | null {
    const previstos = e.months.filter((m) => m.isForecast);
    if (!previstos.length) return null;

    const sobraPrevista = soma(previstos.map((m) => m.net));
    const receitaAno = soma(e.months.map((m) => m.income));
    const despesaAno = soma(e.months.map((m) => m.expense));
    // Ano sem movimento nenhum: "o ano fecha com R$ 0 poupados" é uma frase
    // verdadeira e inútil, que faria o relatório vazio parecer um relatório.
    if (receitaAno.lessThanOrEqualTo(0) && despesaAno.lessThanOrEqualTo(0)) return null;
    const sobraAno = receitaAno.minus(despesaAno);
    const taxaAno = taxaDePoupanca(receitaAno, despesaAno);

    const primeiro = previstos[0].month;
    const ultimo = previstos[previstos.length - 1].month;
    const janela =
      primeiro === ultimo
        ? nomeDoMesMaiusculo(primeiro).toLowerCase()
        : `${nomeDoMesMaiusculo(primeiro).toLowerCase()} a ${nomeDoMesMaiusculo(ultimo).toLowerCase()}`;

    return {
      key: 'year-end',
      metric: brl(e.kpis.projectedYearEndBalance),
      tone: sobraAno.greaterThanOrEqualTo(0) ? 'positive' : 'attention',
      title: 'Projeção de fechamento do ano',
      text:
        `A sobra prevista de ${janela} chega a ${brl(sobraPrevista)} e o ano fecha com ` +
        `${brl(sobraAno)} poupados (${pct(taxaAno)} da receita).`,
    };
  }
}

/** "a, b e c" — vírgula entre os primeiros e "e" antes do último. */
function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}
