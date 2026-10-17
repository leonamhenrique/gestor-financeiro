// ============================================================
// settlements.service.ts
// ============================================================
// O acerto: dinheiro que trocou de mão para abater dívida.
//
// NÃO é receita nem despesa, e é por isso que vive em tabela própria — o
// mesmo motivo da transferência entre contas. Receber de volta o que você
// adiantou não é ganhar dinheiro: você já tinha. Como Transaction, todo
// acerto entraria em mapa de calor, resultado do mês, relatório por
// categoria e fluxo de caixa, e cada um precisaria de uma exceção para
// expulsá-lo. Separado, nunca aparece lá porque nunca foi lançamento.
//
// O que ele FAZ é mexer no saldo da conta, quando passou por uma: pelo mesmo
// caminho atômico de todo o resto — `increment`/`decrement` dentro de
// `$transaction`, nunca ler o saldo para escrever de volta.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SettlementDirection, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';
import { TransactionsService } from '../transactions/transactions.service';
import { PRAZO } from './shared-expenses.service';
import { emCentavos } from './shared-expense.utils';

export interface CriarAcerto {
  userId: string;
  personId: string;
  direction: SettlementDirection;
  amount: number;
  settledAt: string;
  bankAccountId?: string;
  description?: string;
  clientKey?: string;
  /** Com categoria, o acerto vira um LANÇAMENTO no extrato — e é ele que
   * mexe no saldo e entra nos relatórios. Sem categoria, o acerto só abate a
   * dívida, como antes. */
  categoryId?: string;
  /** Só faz sentido com `categoryId`: o lançamento pode nascer previsto e
   * ser confirmado depois, como qualquer outro. */
  isConfirmed?: boolean;
}

export interface AlterarAcerto {
  personId?: string;
  direction?: SettlementDirection;
  amount?: number;
  settledAt?: string;
  /** `null` tira a conta: o acerto vira dinheiro vivo e perde o lançamento. */
  bankAccountId?: string | null;
  description?: string | null;
  /** `null` tira a categoria, e com ela o lançamento. Omitido mantém o que
   * já estava — assim quem só corrige a data não perde o lançamento. */
  categoryId?: string | null;
  isConfirmed?: boolean;
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
    private readonly transactions: TransactionsService,
  ) {}

  async create(input: CriarAcerto) {
    await this.people.minha(input.userId, input.personId);
    if (emCentavos(input.amount) <= 0) {
      throw new BadRequestException('O valor do acerto deve ser maior que zero.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const repetido = await this.jaGravado(tx, input.userId, input.clientKey);
        if (repetido) return repetido;

        if (input.bankAccountId) await this.conferirConta(tx, input.userId, input.bankAccountId);

        const lancamento = await this.lancamentoDoAcerto(tx, input);

        const acerto = await tx.settlement.create({
          data: {
            userId: input.userId,
            personId: input.personId,
            direction: input.direction,
            amount: new Prisma.Decimal(input.amount),
            settledAt: new Date(input.settledAt),
            bankAccountId: input.bankAccountId ?? null,
            description: input.description ?? null,
            clientKey: input.clientKey ?? null,
            transactionId: lancamento?.id ?? null,
          },
          include: { person: true, bankAccount: true },
        });

        // Com lançamento, o saldo JÁ se moveu dentro de `criarEm`. Mexer de
        // novo aqui faria o dinheiro andar duas vezes.
        if (!lancamento) {
          await this.mexerNoSaldo(tx, acerto.bankAccountId, acerto.direction, acerto.amount, 1);
        }
        return acerto;
      }, PRAZO);
    } catch (e) {
      const existente = await this.perdeuACorrida(e, input.userId, input.clientKey);
      if (existente) return existente;
      throw e;
    }
  }

  findAllByUser(userId: string, filtro: { personId?: string; from?: string; to?: string } = {}) {
    return this.prisma.settlement.findMany({
      where: {
        userId,
        personId: filtro.personId,
        ...(filtro.from || filtro.to
          ? {
              settledAt: {
                ...(filtro.from ? { gte: new Date(filtro.from) } : {}),
                ...(filtro.to ? { lte: new Date(filtro.to) } : {}),
              },
            }
          : {}),
      },
      include: { person: true, bankAccount: true },
      orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Editar um acerto: valor, data, conta, sentido, descrição e categoria.
   *
   * O ponto delicado não é mudar os campos — é que a edição pode mudar **se**
   * o acerto tem lançamento, e quem mexe no saldo depende disso. São quatro
   * caminhos, e cada um precisa desfazer o efeito antigo pelo mesmo caminho
   * que o aplicou:
   *
   *   tinha e continua   o lançamento se atualiza (ele estorna e reaplica)
   *   tinha e perdeu     apaga o lançamento, e o acerto passa a mexer direto
   *   não tinha e ganhou desfaz o movimento direto, e cria o lançamento
   *   não tinha, segue   desfaz o movimento antigo e aplica o novo
   *
   * Misturar dois desses — mexer no saldo direto E pelo lançamento — é o que
   * faria o dinheiro andar duas vezes.
   */
  async update(userId: string, id: string, input: AlterarAcerto) {
    const pessoaNova = input.personId;
    if (pessoaNova) await this.people.minha(userId, pessoaNova);

    return this.prisma.$transaction(async (tx) => {
      const atual = await tx.settlement.findFirst({ where: { id, userId } });
      if (!atual) throw new NotFoundException('Acerto não encontrado');

      const novo = {
        personId: pessoaNova ?? atual.personId,
        direction: input.direction ?? atual.direction,
        amount: input.amount === undefined ? Number(atual.amount) : input.amount,
        settledAt: input.settledAt ? new Date(input.settledAt) : atual.settledAt,
        bankAccountId:
          input.bankAccountId === undefined ? atual.bankAccountId : (input.bankAccountId || null),
        description: input.description === undefined ? atual.description : (input.description || null),
      };
      if (emCentavos(novo.amount) <= 0) {
        throw new BadRequestException('O valor do acerto deve ser maior que zero.');
      }
      if (novo.bankAccountId) await this.conferirConta(tx, userId, novo.bankAccountId);

      // Categoria omitida mantém o que havia; `null` tira o lançamento.
      const categoria =
        input.categoryId === undefined
          ? atual.transactionId
            ? await this.categoriaDoLancamento(tx, atual.transactionId)
            : null
          : input.categoryId || null;
      const devePossuirLancamento = Boolean(categoria && novo.bankAccountId);
      const recebi = novo.direction === SettlementDirection.RECEIVED;

      let transactionId = atual.transactionId;

      if (atual.transactionId && devePossuirLancamento) {
        await this.transactions.atualizarEm(
          tx,
          atual.transactionId,
          {
            categoryId: categoria!,
            type: recebi ? TransactionType.INCOME : TransactionType.EXPENSE,
            isRefund: recebi,
            bankAccountId: novo.bankAccountId,
            creditCardId: null,
            amount: novo.amount,
            description: novo.description ?? undefined,
            transactionDate: novo.settledAt,
            ...(input.isConfirmed === undefined ? {} : { isConfirmed: input.isConfirmed }),
          },
          userId,
        );
      } else if (atual.transactionId && !devePossuirLancamento) {
        // Solta o vínculo antes de apagar: o Cascade levaria o acerto junto.
        await tx.settlement.update({ where: { id }, data: { transactionId: null } });
        await this.transactions.apagarEm(tx, atual.transactionId, userId);
        transactionId = null;
        await this.mexerNoSaldo(tx, novo.bankAccountId, novo.direction, new Prisma.Decimal(novo.amount), 1);
      } else if (!atual.transactionId && devePossuirLancamento) {
        await this.mexerNoSaldo(tx, atual.bankAccountId, atual.direction, atual.amount, -1);
        const criado = await this.transactions.criarEm(tx, {
          userId,
          categoryId: categoria!,
          type: recebi ? TransactionType.INCOME : TransactionType.EXPENSE,
          isRefund: recebi,
          amount: novo.amount,
          description: novo.description ?? undefined,
          transactionDate: novo.settledAt,
          bankAccountId: novo.bankAccountId!,
          isConfirmed: input.isConfirmed,
        } as any);
        transactionId = criado.id;
      } else {
        await this.mexerNoSaldo(tx, atual.bankAccountId, atual.direction, atual.amount, -1);
        await this.mexerNoSaldo(tx, novo.bankAccountId, novo.direction, new Prisma.Decimal(novo.amount), 1);
      }

      return tx.settlement.update({
        where: { id },
        data: {
          personId: novo.personId,
          direction: novo.direction,
          amount: new Prisma.Decimal(novo.amount),
          settledAt: novo.settledAt,
          bankAccountId: novo.bankAccountId,
          description: novo.description,
          transactionId,
        },
        include: { person: true, bankAccount: true },
      });
    }, PRAZO);
  }

  private async categoriaDoLancamento(tx: Prisma.TransactionClient, transactionId: string) {
    const t = await tx.transaction.findUnique({
      where: { id: transactionId },
      select: { categoryId: true },
    });
    return t?.categoryId ?? null;
  }

  /** Apagar devolve o dinheiro para onde ele estava, se o acerto chegou a
   * mexer em saldo. */
  async remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const acerto = await tx.settlement.findFirst({ where: { id, userId } });
      if (!acerto) throw new NotFoundException('Acerto não encontrado');

      if (acerto.transactionId) {
        // Quem mexeu no saldo foi o LANÇAMENTO, então é ele que precisa
        // desfazer — `atualizarEm`/`delete` sabem estornar o efeito certo,
        // inclusive se ele estava previsto e nunca tocou no saldo. Apagá-lo
        // leva o acerto junto pela cascata.
        await tx.settlement.update({ where: { id }, data: { transactionId: null } });
        await this.transactions.apagarEm(tx, acerto.transactionId, userId);
        await tx.settlement.delete({ where: { id } });
        return { id };
      }

      await this.mexerNoSaldo(tx, acerto.bankAccountId, acerto.direction, acerto.amount, -1);
      await tx.settlement.delete({ where: { id } });
      return { id };
    }, PRAZO);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /**
   * O lançamento que representa o acerto no extrato, quando pedido.
   *
   * O sinal sai da direção, e é aqui que mora a contabilidade do módulo:
   *
   *   PAGUEI    vira DESPESA. Pagar a alguém o que ela adiantou por você é
   *             consumo SEU: o dinheiro sai da conta e o gasto é seu. Sem
   *             isto, saíam 500 do banco e nenhum relatório via a despesa.
   *   RECEBI    vira INCOME marcada como REEMBOLSO. O dinheiro entrou, então
   *             o saldo sobe — mas não é renda: você está recebendo de volta
   *             o que adiantou. Marcada assim, ela abate a despesa original
   *             nos relatórios em vez de inflar o seu ganho do mês.
   *
   * Sem conta não há lançamento: dinheiro vivo não passa por conta nenhuma, e
   * um lançamento sem destino não existe neste app.
   */
  private async lancamentoDoAcerto(tx: Prisma.TransactionClient, input: CriarAcerto) {
    if (!input.categoryId || !input.bankAccountId) return null;

    const recebi = input.direction === SettlementDirection.RECEIVED;
    return this.transactions.criarEm(tx, {
      userId: input.userId,
      categoryId: input.categoryId,
      type: recebi ? TransactionType.INCOME : TransactionType.EXPENSE,
      isRefund: recebi,
      amount: input.amount,
      description: input.description,
      transactionDate: new Date(input.settledAt),
      bankAccountId: input.bankAccountId,
      isConfirmed: input.isConfirmed,
      clientKey: input.clientKey ? input.clientKey + ':acerto' : undefined,
    });
  }

  /**
   * RECEIVED entra na conta, PAID sai dela. `sinal` é 1 ao criar e -1 ao
   * apagar, para desfazer ser exatamente o oposto de aplicar — e não uma
   * segunda regra de sinal, livre para discordar da primeira.
   *
   * Sem conta (dinheiro vivo), não há saldo para mexer: a dívida é abatida
   * do mesmo jeito, mas nenhum saldo do app mudou.
   */
  private async mexerNoSaldo(
    tx: Prisma.TransactionClient,
    bankAccountId: string | null,
    direction: SettlementDirection,
    amount: Prisma.Decimal,
    sinal: 1 | -1,
  ) {
    if (!bankAccountId) return;
    const entra = (direction === SettlementDirection.RECEIVED) === (sinal === 1);
    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: { currentBalance: entra ? { increment: amount } : { decrement: amount } },
    });
  }

  private async conferirConta(tx: Prisma.TransactionClient, userId: string, bankAccountId: string) {
    const conta = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, userId },
      select: { id: true },
    });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada');
  }

  private async jaGravado(tx: Prisma.TransactionClient, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    return tx.settlement.findFirst({
      where: { userId, clientKey },
      include: { person: true, bankAccount: true },
    });
  }

  private async perdeuACorrida(e: unknown, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    if ((e as { code?: string })?.code !== 'P2002') return null;
    return this.prisma.settlement.findFirst({
      where: { userId, clientKey },
      include: { person: true, bankAccount: true },
    });
  }
}
