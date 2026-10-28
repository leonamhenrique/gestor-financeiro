// ============================================================
// shared-summary.service.ts
// ============================================================
// As duas leituras da tela: o resumo de todo mundo e o extrato de uma
// pessoa.
//
// Nenhum saldo sai do banco pronto: tudo é somado aqui, das partes e dos
// acertos. Guardar o saldo da pessoa seria mais um número para sair do ar
// em silêncio — e sair do ar num número que duas pessoas conferem uma com a
// outra é pior do que em qualquer outro.
//
// O extrato é ACUMULADO, não mensal: o mês mostra o que aconteceu nele, mas
// começa do saldo que veio de trás. Sem isso, quem abrisse outubro veria
// "você deve 120" enquanto devia 820 — o mês não sabe o que ficou para trás.
// É a mesma lógica do bloco de saldo do extrato comum.
// ============================================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';
import { mesDeCaixa } from '../transactions/transaction.utils';
import { chaveDoMes } from '../reports/report.utils';
import {
  saldoDaPessoa,
  normalizarDespesa,
  emCentavos,
  emReais,
  DespesaParaSaldo,
  AcertoParaSaldo,
} from './shared-expense.utils';

/** Como o usuário escolheu ver compra de cartão: no mês do vencimento da
 * fatura (padrão) ou no mês da compra. É a mesma escolha do resto do app. */
export type ModoDeData = 'fatura' | 'compra';

const COM_TUDO = {
  // `series` entra por causa do "2/5": o lançamento guarda só o índice, e
  // quantas parcelas são está na série. Sem ela a linha diria "parcela 2" e
  // o usuário não saberia de quantas.
  transaction: {
    include: { category: true, bankAccount: true, creditCard: true, series: true },
  },
  shares: { include: { person: true } },
  paidBy: true,
} as const;

/** O "2/5" de uma parcela, ou `null`. Série FIXA não numera: ela se repete,
 * mas não é "uma de N" — um aluguel não tem fim para contar. */
function parcelaDa(transaction: any): string | null {
  const s = transaction?.series;
  if (!s || s.kind !== 'INSTALLMENT' || !s.count) return null;
  return `${(transaction.seriesIndex ?? 0) + 1}/${s.count}`;
}

@Injectable()
export class SharedSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
  ) {}

  /**
   * Uma linha por pessoa: saldo, quantos lançamentos e quantos acertos.
   * Mais o líquido — a soma de todos os saldos, que é o que aparece grande
   * no topo da tela.
   */
  async resumo(userId: string) {
    const [pessoas, despesas, acertos] = await Promise.all([
      this.prisma.person.findMany({ where: { userId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.sharedExpense.findMany({ where: { userId }, include: COM_TUDO }),
      this.prisma.settlement.findMany({
        where: { userId },
        include: { transaction: { select: { isConfirmed: true } } },
      }),
    ]);

    const linhas = pessoas.map((pessoa) => {
      const dela = this.despesasDe(despesas, pessoa.id);
      const acertosDela = acertos.filter((a) => a.personId === pessoa.id);
      return {
        personId: pessoa.id,
        name: pessoa.name,
        saldo: saldoDaPessoa(dela.paraSaldo, this.paraSaldo(acertosDela)),
        /* O que ainda vai sobrar DEPOIS que os acertos agendados acontecerem.
         *
         * `saldo` é a dívida de hoje: ela ignora o que está agendado, porque
         * o dinheiro não andou. Este aqui conta os agendados como se já
         * tivessem acontecido, e por isso é o que falta DECIDIR.
         *
         * A diferença existe para quem soma: o acerto agendado já virou um
         * lançamento previsto e já aparece em "a vencer". Somar a dívida
         * cheia ali pediria o mesmo dinheiro duas vezes. */
        saldoEmAberto: saldoDaPessoa(
          dela.paraSaldo,
          acertosDela.map((x: any) => ({ direction: x.direction, amount: Number(x.amount) })),
        ),
        lancamentos: dela.paraSaldo.length,
        acertos: acertosDela.length,
      };
    });

    // Positivo e negativo somados, e também separados: "a receber 1.360" não
    // é a mesma informação que "líquido 1.240", e a tela mostra as duas.
    const centavos = linhas.reduce((s, l) => s + emCentavos(l.saldo), 0);
    const aReceber = linhas.filter((l) => l.saldo > 0).reduce((s, l) => s + emCentavos(l.saldo), 0);
    const aPagar = linhas.filter((l) => l.saldo < 0).reduce((s, l) => s - emCentavos(l.saldo), 0);

    const aReceberEmAberto = linhas
      .filter((l) => l.saldoEmAberto > 0)
      .reduce((s2, l) => s2 + emCentavos(l.saldoEmAberto), 0);
    const aPagarEmAberto = linhas
      .filter((l) => l.saldoEmAberto < 0)
      .reduce((s2, l) => s2 - emCentavos(l.saldoEmAberto), 0);

    return {
      pessoas: linhas,
      liquido: emReais(centavos),
      aReceber: emReais(aReceber),
      aPagar: emReais(aPagar),
      // O que ainda não tem acerto nem agendado — ver `saldoEmAberto`.
      aReceberEmAberto: emReais(aReceberEmAberto),
      aPagarEmAberto: emReais(aPagarEmAberto),
    };
  }

  /**
   * O extrato de uma pessoa num mês, com o saldo que veio de antes.
   *
   * `mes` em 'AAAA-MM'. Sem ele, devolve tudo e o saldo anterior é zero.
   */
  async extratoDaPessoa(userId: string, personId: string, mes?: string, por: ModoDeData = 'fatura') {
    const pessoa = await this.people.minha(userId, personId);

    const [despesas, acertos] = await Promise.all([
      this.prisma.sharedExpense.findMany({
        where: { userId, shares: { some: { personId } } },
        include: COM_TUDO,
      }),
      // O lançamento vem junto porque a categoria e o "já aconteceu" moram
      // NELE, não no acerto — e a tela de edição precisa dos dois para abrir
      // preenchida. Sem isso, editar um acerto perderia a categoria por
      // omissão, e com ela o lançamento.
      this.prisma.settlement.findMany({
        where: { userId, personId },
        include: { transaction: { select: { categoryId: true, isConfirmed: true } } },
      }),
    ]);

    const antes = mes ? this.ate(despesas, acertos, personId, mes, por) : vazio();
    const noMes = mes
      ? this.entre(despesas, acertos, personId, mes, por)
      : this.tudo(despesas, acertos, personId);

    const saldoAnterior = saldoDaPessoa(antes.despesas, antes.acertos);
    const doMes = saldoDaPessoa(noMes.despesas, noMes.acertos);

    return {
      person: { id: pessoa.id, name: pessoa.name, pixKey: pessoa.pixKey },
      mes: mes ?? null,
      por,
      saldoAnterior,
      movimentoDoMes: doMes,
      // O saldo final é a SOMA, e não uma terceira conta: assim a coluna
      // sempre fecha, mesmo que uma das duas esteja errada.
      saldoFinal: emReais(emCentavos(saldoAnterior) + emCentavos(doMes)),
      totalDoMes: noMes.linhas.reduce((s, l) => s + emCentavos(l.total), 0) / 100,
      minhaParteNoMes: noMes.linhas.reduce((s, l) => s + emCentavos(l.minhaParte), 0) / 100,
      lancamentos: noMes.linhas,
      acertos: noMes.acertosCrus,
    };
  }

  /**
   * A aba COMPARTILHADAS do extrato: tudo que tem gente junto, numa lista
   * só, em ordem de data.
   *
   * São três coisas diferentes na mesma lista, e a diferença importa:
   *
   *   DESPESA (eu paguei)   saiu da minha conta ou do meu cartão, e o valor
   *                         cheio pesa no meu mês; a parte do outro é
   *                         informação ao lado, não desconto.
   *   DESPESA (ela pagou)   não saiu nada meu — é a linha "fora da conta".
   *                         O que ela gera é dívida, não despesa do mês.
   *   ACERTO                dinheiro trocou de mão, mas não é receita nem
   *                         despesa: só abate dívida.
   */
  async extratoGeral(userId: string, mes?: string, por: ModoDeData = 'fatura') {
    const [despesas, acertos] = await Promise.all([
      this.prisma.sharedExpense.findMany({ where: { userId }, include: COM_TUDO }),
      this.prisma.settlement.findMany({
        where: { userId },
        include: { person: true, transaction: { select: { isConfirmed: true } } },
      }),
    ]);

    // Mesmo critério de mês do extrato por pessoa. Duas telas do MESMO módulo
    // discordando sobre em que mês um gasto entra seria repetir, por dentro,
    // o erro que acabou de ser corrigido por fora.
    const noMes = (linha: any) => !mes || this.mesDaLinha(linha, por) === mes;

    const linhasDespesa = despesas
      .map((d: any) => {
        const n = normalizarDespesa(d);
        const forma = d.transaction?.creditCard
          ? 'Cartão ' + d.transaction.creditCard.name
          : d.transaction?.bankAccount
            ? d.transaction.bankAccount.institutionName
            : null;
        return {
          tipo: 'DESPESA' as const,
          id: d.id,
          date: n.date,
          description: n.description,
          euPaguei: n.euPaguei,
          forma,
          formaEhCartao: Boolean(d.transaction?.creditCard),
          creditCard: d.transaction?.creditCard ?? null,
          invoiceMonthOverride: d.transaction?.invoiceMonthOverride ?? null,
          parcela: parcelaDa(d.transaction),
          // Quando eu paguei, o valor cheio saiu de mim: entra negativo. Quando
          // ela pagou, nada saiu daqui — o valor fica fora do meu mês.
          valor: n.euPaguei ? -n.total : 0,
          foraDaConta: !n.euPaguei,
          total: n.total,
          minhaParte: n.minhaParte,
          pessoas: d.shares.map((s: any) => ({
            personId: s.personId,
            name: s.person?.name ?? null,
            amount: Number(s.amount),
          })),
          paidBy: d.paidBy ? { personId: d.paidBy.id, name: d.paidBy.name } : null,
        };
      })
      .filter(noMes);

    const linhasAcerto = acertos
      // Acerto não tem fatura para esperar: entra no mês da própria data.
      .filter((a: any) => !mes || chaveDoMes(new Date(a.settledAt)) === mes)
      .map((a: any) => ({
        tipo: 'ACERTO' as const,
        id: a.id,
        date: a.settledAt,
        description: a.description ?? `${a.direction === 'RECEIVED' ? 'Recebido de' : 'Pago a'} ${a.person.name}`,
        direction: a.direction,
        // Entra com sinal porque mexeu no saldo da conta — mas NÃO é receita
        // nem despesa, e a tela precisa dizer isso em letras.
        valor: a.direction === 'RECEIVED' ? Number(a.amount) : -Number(a.amount),
        contaComoReceita: false,
        // Agendado: o lançamento dele ainda é previsto, e a dívida continua
        // de pé. A tela diz isso em letras.
        agendado: !!a.transaction && a.transaction.isConfirmed === false,
        // A tela precisa destes dois para dizer, na confirmacao, o que apagar
        // vai desfazer: saldo de conta e lancamento no extrato.
        bankAccountId: a.bankAccountId ?? null,
        transactionId: a.transactionId ?? null,
        pessoa: { personId: a.personId, name: a.person.name },
      }));

    const linhas = [...linhasDespesa, ...linhasAcerto].sort(
      (a: any, b: any) => +new Date(b.date) - +new Date(a.date),
    );

    // O número do topo é o saldo ACUMULADO a receber, não o do mês: é o que
    // as pessoas devem hoje, e ele pode passar do total do próprio mês
    // porque vem de trás.
    const { aReceber, aPagar } = await this.resumo(userId);

    return { linhas, aReceber, aPagar };
  }

  /**
   * Quanto do que eu gastei no mês é, na verdade, de outra pessoa.
   *
   * Informação NOVA, ao lado — nenhum relatório existente muda de número por
   * causa disto. O gasto continua entrando cheio no fluxo de caixa, no mapa
   * de calor e no resultado do mês, porque foi cheio que ele saiu da conta.
   * Descontar a parte dos outros lá dentro "arrumaria" o relatório e
   * quebraria o saldo: saíram 200 da conta, não 100.
   *
   * O que esta conta responde é outra pergunta, e que vale a pena ter:
   * "destes 2.000 que gastei, quanto era meu de verdade?".
   */
  async impactoNoMes(userId: string, mes: string, por: ModoDeData = 'fatura') {
    const despesas = await this.prisma.sharedExpense.findMany({
      where: { userId },
      include: COM_TUDO,
    });

    let gastoDividido = 0;
    let dosOutros = 0;
    let meu = 0;

    for (const d of despesas) {
      const n = normalizarDespesa(d);
      // Só o que saiu de MIM: o que o amigo pagou nunca entrou no meu mês.
      if (!n.euPaguei || n.date === null) continue;
      // Pelo MESMO mês que o relatório usa: este número vai ao lado dos
      // dele, e dois critérios dariam duas respostas para o mesmo mês.
      const linha = {
        date: n.date,
        creditCard: d.transaction?.creditCard ?? null,
        invoiceMonthOverride: d.transaction?.invoiceMonthOverride ?? null,
      };
      if (this.mesDaLinha(linha, por) !== mes) continue;

      gastoDividido += emCentavos(n.total);
      meu += emCentavos(n.minhaParte);
      dosOutros += emCentavos(n.total) - emCentavos(n.minhaParte);
    }

    return {
      mes,
      /** O que o relatório conta hoje, e vai continuar contando. */
      gastoDividido: emReais(gastoDividido),
      /** Quanto disso é de outras pessoas. */
      dosOutros: emReais(dosOutros),
      /** O custo que de fato foi meu. */
      meu: emReais(meu),
    };
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /** As despesas em que esta pessoa tem parte, já normalizadas. */
  private despesasDe(despesas: any[], personId: string) {
    const linhas: any[] = [];
    const paraSaldo: DespesaParaSaldo[] = [];

    for (const d of despesas) {
      const parte = d.shares.find((s: any) => s.personId === personId);
      if (!parte) continue;
      const n = normalizarDespesa(d);
      linhas.push({
        ...n,
        parteDela: Number(parte.amount),
        percent: parte.percent === null ? null : Number(parte.percent),
        // Dois campos e não um: o extrato privado mostra "Cartão Nubank", e a
        // página pública mostra só "Cartão". Separados, a peneira do público
        // escolhe o que sai sem precisar desmontar texto.
        formaEhCartao: Boolean(d.transaction?.creditCardId ?? d.transaction?.creditCard),
        forma: d.transaction?.creditCard
          ? 'Cartão ' + d.transaction.creditCard.name
          : (d.transaction?.bankAccount?.institutionName ?? null),
        // Numa viagem em 5x são cinco linhas iguais, uma por mês: sem o
        // número, nada distingue a de outubro da de novembro.
        parcela: parcelaDa(d.transaction),
        // O que `mesDaLinha` precisa para saber em que mês isto entra. Sem o
        // cartão aqui, a conta do vencimento não teria como ser feita e a
        // linha cairia no mês da compra.
        creditCard: d.transaction?.creditCard ?? null,
        invoiceMonthOverride: d.transaction?.invoiceMonthOverride ?? null,
      });
      paraSaldo.push({ euPaguei: n.euPaguei, total: n.total, parteDela: Number(parte.amount) });
    }

    return { linhas, paraSaldo };
  }

  /**
   * Os acertos que de fato mexeram na dívida.
   *
   * Acerto AGENDADO não abate nada. Ele nasce como lançamento previsto — o
   * dinheiro ainda não saiu —, e contá-lo aqui produzia uma contradição que o
   * usuário leu na tela: a pessoa aparecia quite enquanto o extrato dizia que
   * o pagamento não havia acontecido. Dívida se quita com dinheiro, não com
   * intenção.
   *
   * Acerto sem lançamento (dinheiro vivo) conta na hora: ali não há nada a
   * confirmar depois, o dinheiro passou de mão e pronto.
   */
  private paraSaldo(acertos: any[]): AcertoParaSaldo[] {
    return acertos
      .filter((a) => !a.transaction || a.transaction.isConfirmed !== false)
      .map((a) => ({ direction: a.direction, amount: Number(a.amount) }));
  }

  /** A data que vale para a despesa, nas duas formas dela. */
  private dataDa(linha: any): Date | null {
    return linha.date ? new Date(linha.date) : null;
  }

  /**
   * Em que MÊS a linha entra, que não é necessariamente o mês da data dela.
   *
   * Compra no cartão sai da conta quando a fatura vence, e o app inteiro já
   * conta assim por padrão — é a escolha `relatorioPor` do usuário, que vale
   * para todos os relatórios. Esta tela lia a data crua e por isso mostrava
   * em outubro um gasto que o resto do app mostra em novembro: dois números
   * para o mesmo mês, que é exatamente o que `mesDeCaixa` existe para evitar.
   *
   * No modo `compra`, e em tudo que não é cartão, vale a própria data.
   */
  private mesDaLinha(linha: any, por: ModoDeData): string | null {
    const d = this.dataDa(linha);
    if (!d) return null;
    if (por === 'compra' || !linha.creditCard) return chaveDoMes(d);
    return mesDeCaixa(
      {
        transactionDate: d,
        creditCardId: 'x',
        invoiceMonthOverride: linha.invoiceMonthOverride ?? null,
      },
      new Map([['x', linha.creditCard]]),
    );
  }

  private tudo(despesas: any[], acertos: any[], personId: string) {
    const { linhas, paraSaldo } = this.despesasDe(despesas, personId);
    return {
      // Mesma ordem do extrato com mês: do mais recente para o mais antigo.
      // Sem isto, pedir sem mês devolvia a ordem do banco — e a mesma tela
      // mostrava duas ordens diferentes conforme o filtro.
      linhas: [...linhas].sort((a, b) => +new Date(b.date!) - +new Date(a.date!)),
      despesas: paraSaldo,
      acertos: this.paraSaldo(acertos),
      acertosCrus: acertos,
    };
  }

  /** O que aconteceu ANTES do começo do mês — o saldo que veio de trás. */
  /** O que aconteceu ANTES do mês pedido — o saldo que veio de trás.
   * Compara CHAVE DE MÊS, e não data: no modo `fatura` uma compra de 28/10
   * pertence a novembro, e comparar datas a deixaria em outubro. */
  private ate(despesas: any[], acertos: any[], personId: string, mes: string, por: ModoDeData) {
    const { linhas } = this.despesasDe(despesas, personId);
    const antes = linhas.filter((l) => {
      const m = this.mesDaLinha(l, por);
      return m !== null && m < mes;
    });
    return {
      despesas: antes.map((l) => ({ euPaguei: l.euPaguei, total: l.total, parteDela: l.parteDela })),
      // Acerto é dinheiro que trocou de mão na data dele: não tem fatura, e
      // por isso não passa pela regra do vencimento.
      acertos: this.paraSaldo(acertos.filter((a) => chaveDoMes(new Date(a.settledAt)) < mes)),
    };
  }

  private entre(despesas: any[], acertos: any[], personId: string, mes: string, por: ModoDeData) {
    const { linhas } = this.despesasDe(despesas, personId);
    const noMes = linhas.filter((l) => this.mesDaLinha(l, por) === mes);
    const acertosNoMes = acertos.filter((a) => chaveDoMes(new Date(a.settledAt)) === mes);
    return {
      linhas: noMes.sort((a, b) => +this.dataDa(b)! - +this.dataDa(a)!),
      despesas: noMes.map((l) => ({ euPaguei: l.euPaguei, total: l.total, parteDela: l.parteDela })),
      acertos: this.paraSaldo(acertosNoMes),
      acertosCrus: acertosNoMes,
    };
  }

  /** 'AAAA-MM' → primeiro e último instante do mês, em UTC. As datas do
   * banco são dias em UTC (@db.Date), e comparar com data local jogaria o
   * dia 1 para o mês anterior em qualquer fuso a oeste de Greenwich. */
  private faixaDoMes(mes: string) {
    const [ano, m] = mes.split('-').map(Number);
    return {
      inicio: new Date(Date.UTC(ano, m - 1, 1)),
      fim: new Date(Date.UTC(ano, m, 0, 23, 59, 59, 999)),
    };
  }
}

function vazio() {
  return { despesas: [] as DespesaParaSaldo[], acertos: [] as AcertoParaSaldo[] };
}
