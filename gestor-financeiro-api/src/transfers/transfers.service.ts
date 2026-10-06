// ============================================================
// transfers.service.ts
// ============================================================
// Transferência entre contas do próprio usuário.
//
// O que ela NÃO é: receita, despesa, ou um par das duas. Mover dinheiro da
// conta A para a conta B não muda o patrimônio de ninguém — muda só onde ele
// está. Por isso vive em tabela própria e não encosta em nenhum relatório de
// receita e despesa: não é preciso excluí-la de lugar nenhum, porque ela
// nunca entrou.
//
// O que ela faz: quando CONFIRMADA, debita a origem e credita o destino na
// mesma transação de banco, com `decrement`/`increment` — nunca lendo o saldo
// para escrever de volta, que é como dois pedidos ao mesmo tempo se perdem.
// Prevista não mexe em saldo nenhum: intenção não move dinheiro.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CriarTransferencia {
  userId: string;
  clientKey?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  description?: string;
  transferDate: string;
  isConfirmed?: boolean;
}

export interface AlterarTransferencia {
  fromAccountId?: string;
  toAccountId?: string;
  amount?: number;
  description?: string;
  transferDate?: string;
  isConfirmed?: boolean;
}

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Com `clientKey`, criar é idempotente: a mesma chave devolve a
   * transferência que já existe. Duas defesas, como nos lançamentos — a
   * consulta antes de criar resolve o reenvio normal, e o índice único
   * resolve a corrida de dois envios simultâneos, em que ninguém teria
   * gravado ainda na hora da consulta.
   */
  async create(input: CriarTransferencia) {
    this.conferirContasDistintas(input.fromAccountId, input.toAccountId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const repetida = await this.jaGravada(tx, input.userId, input.clientKey);
        if (repetida) return repetida;

        await this.conferirContas(tx, input.userId, [input.fromAccountId, input.toAccountId]);

        const transferencia = await tx.transfer.create({
          data: {
            userId: input.userId,
            clientKey: input.clientKey ?? null,
            fromAccountId: input.fromAccountId,
            toAccountId: input.toAccountId,
            amount: new Prisma.Decimal(input.amount),
            description: input.description ?? null,
            transferDate: new Date(input.transferDate),
            isConfirmed: input.isConfirmed ?? true,
          },
        });

        if (transferencia.isConfirmed) {
          await this.mover(tx, transferencia.fromAccountId, transferencia.toAccountId, transferencia.amount);
        }
        return transferencia;
      });
    } catch (e) {
      const existente = await this.perdeuACorrida(e, input.userId, input.clientKey);
      if (existente) return existente;
      throw e;
    }
  }

  async findAllByUser(userId: string, filtro: { from?: string; to?: string } = {}) {
    const where: Prisma.TransferWhereInput = { userId };
    if (filtro.from || filtro.to) {
      where.transferDate = {
        ...(filtro.from ? { gte: new Date(filtro.from) } : {}),
        ...(filtro.to ? { lte: new Date(filtro.to) } : {}),
      };
    }
    return this.prisma.transfer.findMany({
      where,
      orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Alterar é desfazer o efeito antigo e aplicar o novo, na mesma transação.
   * Reaplicar sem desfazer deixaria o saldo com a soma dos dois — e trocar a
   * conta de origem sem desfazer deixaria dinheiro faltando na conta velha
   * para sempre.
   */
  async update(id: string, input: AlterarTransferencia, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const atual = await this.minha(tx, id, requestingUserId);

      const depois = {
        fromAccountId: input.fromAccountId ?? atual.fromAccountId,
        toAccountId: input.toAccountId ?? atual.toAccountId,
        amount: input.amount === undefined ? atual.amount : new Prisma.Decimal(input.amount),
        isConfirmed: input.isConfirmed === undefined ? atual.isConfirmed : input.isConfirmed,
      };
      this.conferirContasDistintas(depois.fromAccountId, depois.toAccountId);
      await this.conferirContas(tx, requestingUserId, [depois.fromAccountId, depois.toAccountId]);

      if (atual.isConfirmed) {
        await this.mover(tx, atual.toAccountId, atual.fromAccountId, atual.amount); // desfaz
      }
      if (depois.isConfirmed) {
        await this.mover(tx, depois.fromAccountId, depois.toAccountId, depois.amount);
      }

      return tx.transfer.update({
        where: { id },
        data: {
          fromAccountId: depois.fromAccountId,
          toAccountId: depois.toAccountId,
          amount: depois.amount,
          isConfirmed: depois.isConfirmed,
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.transferDate === undefined ? {} : { transferDate: new Date(input.transferDate) }),
        },
      });
    });
  }

  /** Apagar devolve o dinheiro para onde ele estava, se a transferência
   * chegou a mexer em saldo. */
  async remove(id: string, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const atual = await this.minha(tx, id, requestingUserId);
      if (atual.isConfirmed) {
        await this.mover(tx, atual.toAccountId, atual.fromAccountId, atual.amount);
      }
      await tx.transfer.delete({ where: { id } });
      return { id };
    });
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /** Tira de uma conta e põe na outra, atomicamente: um `decrement` e um
   * `increment`. É o banco quem faz a conta, então dois pedidos ao mesmo
   * tempo não se sobrescrevem. */
  private async mover(tx: Prisma.TransactionClient, deId: string, paraId: string, valor: Prisma.Decimal) {
    await tx.bankAccount.update({ where: { id: deId }, data: { currentBalance: { decrement: valor } } });
    await tx.bankAccount.update({ where: { id: paraId }, data: { currentBalance: { increment: valor } } });
  }

  private conferirContasDistintas(de: string, para: string) {
    if (de === para) {
      throw new BadRequestException('A conta de origem e a de destino precisam ser diferentes.');
    }
  }

  private async conferirContas(tx: Prisma.TransactionClient, userId: string, ids: string[]) {
    const contas = await tx.bankAccount.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true },
    });
    const achadas = new Set(contas.map((c) => c.id));
    for (const id of ids) {
      if (!achadas.has(id)) throw new NotFoundException('Conta bancária não encontrada');
    }
  }

  private async minha(tx: Prisma.TransactionClient, id: string, userId: string) {
    const t = await tx.transfer.findFirst({ where: { id, userId } });
    if (!t) throw new NotFoundException('Transferência não encontrada');
    return t;
  }

  private async jaGravada(tx: Prisma.TransactionClient, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    return tx.transfer.findFirst({ where: { userId, clientKey } });
  }

  /** Violação do índice único = alguém gravou esta chave enquanto eu tentava.
   * Não é erro do usuário: é a mesma transferência, e a resposta certa é ela. */
  private async perdeuACorrida(e: unknown, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    if ((e as { code?: string })?.code !== 'P2002') return null;
    return this.prisma.transfer.findFirst({ where: { userId, clientKey } });
  }
}
