// ============================================================
// historico.ts — quantos meses o plano deixa importar
// ============================================================
// O provedor manda tudo o que tem: o endpoint de transações não aceita
// período, então os doze meses chegam de qualquer jeito. O que o plano
// decide é quanto disso é OFERECIDO.
//
// O corte é aqui, no servidor, e não na tela. Se fosse visual, bastaria
// abrir o console para importar o que o plano não dá — e o que não pode ser
// importado nem desce para o navegador.
//
// E o corte é ANTES da conferência, nunca depois. Barrar na importação
// faria a pessoa conferir trezentos lançamentos de um mês antigo, marcar
// categoria por categoria e levar um "não" no fim. Trabalho jogado fora
// vira raiva, não assinatura.
// ============================================================

/** O que o corte precisa saber de um lançamento. */
export interface LancamentoComMes {
  data: string;
  /** `AAAA-MM` do vencimento previsto pelo banco. Só o cartão tem. */
  faturaPrevista?: string | null;
}

/**
 * O mês que agrupa este lançamento.
 *
 * No CARTÃO é o da fatura que o banco previu — uma compra de 28/11 pode
 * pertencer à fatura de dezembro, e agrupá-la por novembro partiria a fatura
 * em duas. Na CONTA não existe fatura, então é o mês da própria data.
 */
export function mesDoLancamento(t: LancamentoComMes, ehCartao: boolean): string {
  if (ehCartao && t.faturaPrevista) return t.faturaPrevista;
  return (t.data || '').slice(0, 7);
}

/**
 * Deixa passar só os N meses mais recentes desta fonte.
 *
 * `meses` nulo não corta nada. Zero corta tudo — é o grátis, que não tem
 * Open Finance; quem caiu de plano com uma conexão de pé para de receber
 * novidade, e nada do que já entrou é tocado.
 *
 * Os meses são ordenados por nome (`AAAA-MM` ordena como data) e contados
 * do mais recente. Buraco no meio não gasta cota: três meses com nada em
 * outubro dão setembro, novembro e dezembro, e não "os três últimos do
 * calendário".
 */
export function cortarPorHistorico<T extends LancamentoComMes>(
  lancamentos: T[],
  meses: number | null,
  ehCartao: boolean,
): { ficaram: T[]; mesesCortados: string[] } {
  if (meses === null) return { ficaram: lancamentos, mesesCortados: [] };

  const todos = [...new Set(lancamentos.map((t) => mesDoLancamento(t, ehCartao)))]
    .filter(Boolean)
    .sort();
  const permitidos = new Set(meses > 0 ? todos.slice(-meses) : []);

  return {
    ficaram: lancamentos.filter((t) => permitidos.has(mesDoLancamento(t, ehCartao))),
    mesesCortados: todos.filter((m) => !permitidos.has(m)),
  };
}
