// ============================================================
// relatorio.service.ts
// ============================================================
// O resultado de um mês, para quem pergunta de fora da tela.
//
// A conta NÃO está aqui: ela é o recorte do app (`relatorio.js`), a mesma que
// desenha "Resultado mês a mês". Este arquivo faz as duas coisas que faltam
// para ela rodar no servidor:
//
//   1. monta o estado — contas, cartões, lançamentos e pagamentos de fatura —
//      no formato que o app recebe das próprias rotas da API;
//   2. descobre o "hoje" de quem perguntou e o regime que essa pessoa
//      escolheu, que são as duas coisas de fora que mudam o número.
// ============================================================

import { Injectable } from '@nestjs/common';
import { ReportRegime } from '@prisma/client';
import { ORDEM_DA_LISTA } from '../common/ordering';
import { PrismaService } from '../prisma/prisma.service';
import { FUSO_DO_APP, chaveDoMes, dia } from '../credit-cards/invoice-statement';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const relatorio = require('./relatorio.js');

/** O vocabulário do app, que é o do usuário: "compra" e "fatura". O banco
 * guarda enum, porque coluna de texto livre aceita qualquer palavra; a
 * tradução fica num lugar só, e nos dois sentidos. */
export const REGIME_DO_BANCO: Record<ReportRegime, 'compra' | 'fatura'> = {
  COMPRA: 'compra',
  FATURA: 'fatura',
};
export const REGIME_PARA_O_BANCO: Record<string, ReportRegime> = {
  compra: 'COMPRA',
  fatura: 'FATURA',
};

/** Uma fatura na resposta. `referencia` é o mês da fatura; `vencimento`, o
 * dia em que o dinheiro sai da conta — as duas, porque podem ser meses
 * diferentes. */
export interface LinhaDeFatura {
  cartaoId: string;
  cartao: string;
  referencia: string;
  vencimento: string;
  valor: number;
  status: string;
  situacao: string;
}

export interface FaturasDoMes {
  mes: string;
  total: number;
  faturas: LinhaDeFatura[];
  /** Quantos cartões a pessoa tem — distingue "nenhuma fatura vence neste
   * mês" de "você não cadastrou cartão nenhum". */
  cartoes: number;
}

/** Uma categoria no ranking do mês. */
export interface LinhaDeCategoria {
  categoria: string;
  valor: number;
  /** Quantos lançamentos somaram esse valor. */
  lancamentos: number;
  /** A fatia dentro do próprio grupo (despesas com despesas), em %. */
  parte: number;
}

export interface MaioresDoMes {
  mes: string;
  tipo: 'EXPENSE' | 'INCOME';
  regime: 'compra' | 'fatura';
  total: number;
  /** Categorias que ficaram fora das primeiras, para a resposta poder dizer
   * "e mais N". */
  restantes: number;
  itens: LinhaDeCategoria[];
}

/** Uma linha do acompanhamento: a meta de uma categoria e o quanto dela já
 * foi usado. `id` é nulo em "Outras categorias", que é o resto do teto. */
export interface LinhaDoPlano {
  id: string | null;
  nome: string;
  /** Subcategoria de uma pai que também tem meta — a meta dela está DENTRO
   * da meta da pai. */
  filha: boolean;
  outras: boolean;
  meta: number;
  gasto: number;
  /** Meta menos gasto. Negativo quer dizer que passou. */
  resta: number;
  pct: number;
  /** 'accent' (dentro), 'warn' (80% ou mais), 'caro' (passou) — os mesmos
   * três níveis da barra na tela. */
  nivel: string;
}

/** A categoria que a pergunta nomeou. */
export interface CategoriaDoPlano extends LinhaDoPlano {
  temMeta: boolean;
  /** Quantas subcategorias somam neste gasto. */
  filhas: number;
}

export interface PlanoDoMes {
  mes: string;
  regime: 'compra' | 'fatura';
  temPlano: boolean;
  /** Os meses que já têm planejamento — para a resposta poder oferecer
   * copiar, como a tela faz. */
  planejados: string[];
  teto?: number;
  gasto?: number;
  resta?: number;
  pct?: number;
  nivel?: string;
  /** Quanto do teto está repartido em metas. */
  repartido?: number;
  /** O que sobrou do teto: a meta implícita de "outras categorias". */
  sobraDoTeto?: number;
  receitaEsperada?: number;
  receitaLancada?: number;
  filtros?: { previsto: boolean; cartao: boolean; ocultas: boolean };
  linhas: LinhaDoPlano[];
  categoria?: CategoriaDoPlano;
  /** Quando a categoria pedida não tem meta mas a pai dela tem: é essa meta
   * que de fato limita o gasto. */
  paiComMeta?: LinhaDoPlano;
}

export interface ResultadoDoMes {
  mes: string;
  regime: 'compra' | 'fatura';
  entradas: number;
  saidas: number;
  resultado: number;
  vazio: boolean;
  lancamentos: number;
  faturas: LinhaDeFatura[];
}

/**
 * O instante de quem perguntou, não o do servidor.
 *
 * `diaDoUsuario` (da conversa) devolve o DIA, que é o que um lançamento
 * precisa. Aqui o que está em jogo é outra coisa: "hoje" decide se uma fatura
 * está aberta, fechada ou vencida, e se um resto de fatura já foi transportado
 * para o mês seguinte. No dia do vencimento, meia-noite e duas da tarde dão
 * respostas diferentes — e a tela da pessoa usa o relógio dela, com hora.
 * Então aqui vai o relógio dela também, com hora.
 */
export function instanteDoUsuario(agora: Date = new Date(), fuso: string = FUSO_DO_APP): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const num = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return new Date(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), num('second'));
}

@Injectable()
export class RelatorioService {
  constructor(private readonly prisma: PrismaService) {}

  /** O regime que esta pessoa escolheu, no vocabulário do app. */
  async regime(userId: string): Promise<'compra' | 'fatura'> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { reportRegime: true } });
    return REGIME_DO_BANCO[u?.reportRegime ?? 'FATURA'];
  }

  async definirRegime(userId: string, valor: 'compra' | 'fatura'): Promise<'compra' | 'fatura'> {
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: { reportRegime: REGIME_PARA_O_BANCO[valor] },
      select: { reportRegime: true },
    });
    return REGIME_DO_BANCO[u.reportRegime];
  }

  /**
   * O resultado do mês, pela conta da tela.
   *
   * `mes` é 'AAAA-MM'. `regime` só é passado por quem já leu a preferência
   * (a conversa do WhatsApp, que lê o usuário uma vez) — sem ele, a
   * preferência é buscada aqui.
   */
  async doMes(userId: string, mes: string, regime?: 'compra' | 'fatura'): Promise<ResultadoDoMes> {
    const escolhido = regime ?? (await this.regime(userId));
    return relatorio.calcularMes(await this.estado(userId), mes, instanteDoUsuario(), escolhido);
  }

  /**
   * As maiores categorias do mês, despesa ou receita — as mesmas cinco do
   * Resumo.
   *
   * O regime entra aqui como entra no resultado: pela preferência do usuário,
   * ou pelo que a pergunta pediu só para aquela resposta.
   */
  async maioresDoMes(
    userId: string,
    mes: string,
    tipo: 'EXPENSE' | 'INCOME',
    regime?: 'compra' | 'fatura',
  ): Promise<MaioresDoMes> {
    const escolhido = regime ?? (await this.regime(userId));
    return relatorio.maioresDoMes(await this.estado(userId), mes, instanteDoUsuario(), tipo, escolhido);
  }

  /**
   * O planejamento do mês e o quanto dele já foi usado — a tela de
   * Planejamento, que é quem responde "quanto ainda posso gastar".
   *
   * `categoriaId` é opcional: com ele a resposta é de uma categoria, sem ele
   * é do mês inteiro. Quem resolve o NOME dito para um id é a conversa, pela
   * mesma porta que reconhece um cadastro num lançamento.
   *
   * O regime entra como no resultado: a preferência da pessoa, ou o que a
   * pergunta pediu só para aquela resposta — e ele muda o número de verdade,
   * porque a compra no cartão pesa num mês ou no outro.
   */
  async planoDoMes(
    userId: string,
    mes: string,
    regime?: 'compra' | 'fatura',
    categoriaId?: string | null,
  ): Promise<PlanoDoMes> {
    const escolhido = regime ?? (await this.regime(userId));
    return relatorio.planoDoMes(
      await this.estado(userId),
      mes,
      instanteDoUsuario(),
      escolhido,
      categoriaId ?? null,
    );
  }

  /**
   * As faturas que vencem no mês — o que o cartão vai cobrar da conta.
   *
   * Sem regime: a lista é a mesma para quem conta relatório por compra e por
   * fatura (ver `faturasDoMes` no recorte). Por isso esta função não lê a
   * preferência do usuário, e nem deve.
   */
  async faturasDoMes(userId: string, mes: string): Promise<FaturasDoMes> {
    return relatorio.faturasDoMes(await this.estado(userId), mes, instanteDoUsuario());
  }

  /**
   * O estado do app, como ele chega ao navegador.
   *
   * **Por que o JSON.parse(JSON.stringify(...)):** os tradutores que leem
   * isto são os do app (`contaDaApi`, `lancamentoDaApi`...), e eles esperam o
   * que vem por HTTP — data como texto ISO, dinheiro como string. Entregar
   * objetos do Prisma faria `soData(new Date(...))` devolver "Sun Nov 01",
   * silenciosamente, e o lançamento cairia num mês que não existe. Um
   * round-trip por JSON é exatamente a serialização que o app recebe, e custa
   * menos que uma segunda tradução para manter.
   *
   * **Por que tudo, e não só o mês perguntado:** a sequência de faturas é
   * acumulada — o rotativo leva resto de uma fatura para a seguinte —, então
   * a fatura de novembro depende do que aconteceu antes dela. É a mesma razão
   * pela qual o app carrega a lista inteira ao abrir.
   *
   * **Sem filtro de conta arquivada ou oculta:** o app também carrega tudo
   * (`includeInactive`, `includeHidden`) e decide na conta — é
   * `transacaoVisivel` quem tira a conta oculta, e ela precisa ver a conta
   * para saber que está oculta.
   */
  private async estado(userId: string) {
    const [contas, cartoes, lancamentos, categorias, planejamentos] = await Promise.all([
      // Na mesma ordem das rotas que o app usa: a ordem que o usuário
      // arrastou. Ela não muda total nenhum, mas muda em que ordem as faturas
      // saem na resposta — e é melhor que seja a ordem da tela dele.
      this.prisma.bankAccount.findMany({ where: { userId }, orderBy: ORDEM_DA_LISTA }),
      this.prisma.creditCard.findMany({ where: { userId }, orderBy: ORDEM_DA_LISTA, include: { cycles: { orderBy: { validFrom: 'asc' } } } }),
      this.prisma.transaction.findMany({ where: { userId }, orderBy: { transactionDate: 'desc' } }),
      // As do usuário E as padrão: o lançamento aponta para qualquer uma das
      // duas, e uma categoria que falta aqui some do ranking em silêncio.
      this.prisma.category.findMany({ where: { OR: [{ userId }, { userId: null }] } }),
      // O planejamento de todos os meses, com as metas dentro — a mesma
      // consulta da rota /budgets (ver BudgetsService.findAllByUser), que é
      // de onde o app os lê. São uma linha por mês e algumas dezenas de
      // metas: ordens de grandeza menos que os lançamentos já trazidos acima.
      this.prisma.budget.findMany({
        where: { userId },
        include: { items: true },
        orderBy: { month: 'desc' },
      }),
    ]);

    // Os pagamentos de fatura, por cartão — a mesma forma da rota
    // /credit-cards/:id/payments (ver InvoicePaymentsService.listar), que é de
    // onde o app os lê.
    const pagos = await this.prisma.invoicePayment.findMany({
      where: { invoice: { creditCard: { userId } } },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        bankAccountId: true,
        invoice: { select: { creditCardId: true, referenceMonth: true } },
      },
    });
    const pagamentos: Record<string, unknown[]> = {};
    for (const p of pagos) {
      const lista = (pagamentos[p.invoice.creditCardId] ??= []);
      lista.push({
        id: p.id,
        amount: Number(p.amount),
        paidAt: p.paidAt,
        bankAccountId: p.bankAccountId,
        referenceMonth: chaveDoMes(p.invoice.referenceMonth),
      });
    }

    // As faturas VIRADAS entram no cartão com o mesmo nome que a rota
    // /credit-cards usa (`earlyClosures`), porque quem as lê aqui é o
    // `cartaoDaApi` do app, recortado para cá. Sem elas, a pergunta "qual o
    // valor das minhas faturas" diria Aberta para uma fatura que a tela já
    // mostra Fechada.
    const viradas = await this.prisma.creditCardInvoice.findMany({
      where: { creditCard: { userId }, earlyClosedAt: { not: null } },
      select: { creditCardId: true, referenceMonth: true, earlyClosedAt: true },
    });
    const porCartao: Record<string, Record<string, string>> = {};
    for (const v of viradas) {
      (porCartao[v.creditCardId] ??= {})[chaveDoMes(v.referenceMonth)] = dia(v.earlyClosedAt!);
    }
    const comViradas = cartoes.map((k) => ({ ...k, earlyClosures: porCartao[k.id] ?? {} }));

    return JSON.parse(
      JSON.stringify({
        contas,
        cartoes: comViradas,
        lancamentos,
        categorias,
        pagamentos,
        planejamentos,
      }),
    );
  }
}
