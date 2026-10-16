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
import { Prisma, SettlementDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';
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
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
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
          },
          include: { person: true, bankAccount: true },
        });

        await this.mexerNoSaldo(tx, acerto.bankAccountId, acerto.direction, acerto.amount, 1);
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

  /** Apagar devolve o dinheiro para onde ele estava, se o acerto chegou a
   * mexer em saldo. */
  async remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const acerto = await tx.settlement.findFirst({ where: { id, userId } });
      if (!acerto) throw new NotFoundException('Acerto não encontrado');

      await this.mexerNoSaldo(tx, acerto.bankAccountId, acerto.direction, acerto.amount, -1);
      await tx.settlement.delete({ where: { id } });
      return { id };
    }, PRAZO);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

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
