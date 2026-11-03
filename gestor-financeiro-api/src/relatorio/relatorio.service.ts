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
    const [contas, cartoes, lancamentos] = await Promise.all([
      // Na mesma ordem das rotas que o app usa: a ordem que o usuário
      // arrastou. Ela não muda total nenhum, mas muda em que ordem as faturas
      // saem na resposta — e é melhor que seja a ordem da tela dele.
      this.prisma.bankAccount.findMany({ where: { userId }, orderBy: ORDEM_DA_LISTA }),
      this.prisma.creditCard.findMany({ where: { userId }, orderBy: ORDEM_DA_LISTA, include: { cycles: { orderBy: { validFrom: 'asc' } } } }),
      this.prisma.transaction.findMany({ where: { userId }, orderBy: { transactionDate: 'desc' } }),
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

    return JSON.parse(JSON.stringify({ contas, cartoes: comViradas, lancamentos, pagamentos }));
  }
}
