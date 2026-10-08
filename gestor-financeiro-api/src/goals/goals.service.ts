// ============================================================
// goals.service.ts
// ============================================================
// Objetivo de poupança: uma meta com prazo, e o dinheiro guardado para ela.
//
// Três regras dão sentido a todo o arquivo:
//
// 1. O SALDO INICIAL não entra em total nenhum. É dinheiro que já era do
//    usuário antes do objetivo existir e que nunca passou pelas contas do
//    app. Somá-lo ao saldo geral criaria dinheiro do nada; ignorá-lo no
//    progresso mentiria sobre o quanto falta. Então conta para o progresso,
//    e só.
// 2. O QUE SE APLICA veio de uma conta: sai dela e passa a contar no total
//    como "em objetivos". Dinheiro não evapora por mudar de lugar.
// 3. CONCLUIR não é apagar. O objetivo concluído sai das opções de aplicar
//    (não se guarda mais para o que já terminou) mas continua podendo ser
//    resgatado — senão o dinheiro ficaria preso e o total, errado para
//    sempre.
//
// Como na transferência, aplicar e resgatar mexem no saldo da conta com
// `decrement`/`increment` dentro de uma única transação de banco: nunca
// lendo o saldo para escrever de volta, que é como dois pedidos ao mesmo
// tempo se perdem.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  aplicadoDasContas,
  emReais,
  progressoDoObjetivo,
  saldoDoObjetivo,
  type MovimentoDoObjetivo,
} from './goal.utils';

export interface CriarObjetivo {
  userId: string;
  name: string;
  startDate: string;
  targetDate: string;
  targetAmount: number;
  initialBalance?: number;
  accountId?: string | null;
}

export interface AlterarObjetivo {
  name?: string;
  startDate?: string;
  targetDate?: string;
  targetAmount?: number;
  initialBalance?: number;
  accountId?: string | null;
  /** `true` conclui, `false` reabre. Concluir guarda a data; reabrir a apaga. */
  isCompleted?: boolean;
}

export interface MoverObjetivo {
  userId: string;
  clientKey?: string;
  bankAccountId: string;
  amount: number;
  description?: string;
  movementDate: string;
}

/** Só para ler a data de hoje em UTC, que é como as colunas `@db.Date`
 * voltam do banco. Comparar uma data de banco com um `new Date()` local
 * erra por fuso perto da virada do mês. */
const hojeUTC = (agora = new Date()) =>
  new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------
  // Cadastro
  // ----------------------------------------------------------

  async create(input: CriarObjetivo) {
    const inicio = new Date(input.startDate);
    const prazo = new Date(input.targetDate);
    if (prazo < inicio) {
      throw new BadRequestException('A data final não pode ser antes da inicial.');
    }
    if (input.accountId) {
      await this.conferirConta(this.prisma, input.userId, input.accountId);
    }
    return this.prisma.goal.create({
      data: {
        userId: input.userId,
        name: input.name.trim(),
        startDate: inicio,
        targetDate: prazo,
        targetAmount: new Prisma.Decimal(input.targetAmount),
        initialBalance: new Prisma.Decimal(input.initialBalance ?? 0),
        accountId: input.accountId ?? null,
      },
    });
  }

  /** A lista já vem com as contas feitas: o que tem guardado, quanto falta e
   * quanto precisa entrar por mês. A estimativa mensal é recalculada aqui a
   * cada leitura — é isso que a faz subir para quem depositou menos, no mesmo
   * prazo, sem nenhum campo guardado para ficar velho. */
  async findAllByUser(userId: string) {
    const objetivos = await this.prisma.goal.findMany({
      where: { userId },
      include: { movements: { orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }] } },
      // `nulls: 'first'` explícito: em Postgres, ASC joga NULL para o fim, e
      // seria o concluído abrindo a lista na frente do que ainda está em
      // andamento — o contrário do que a tela quer dizer.
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { targetDate: 'asc' }],
    });
    const hoje = hojeUTC();
    return objetivos.map((o) => this.comAsContas(o, o.movements, hoje));
  }

  async findOne(id: string, userId: string) {
    const o = await this.prisma.goal.findFirst({
      where: { id, userId },
      include: { movements: { orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }] } },
    });
    if (!o) throw new NotFoundException('Objetivo não encontrado');
    return this.comAsContas(o, o.movements, hojeUTC());
  }

  /**
   * Alterar serve para três coisas que parecem diferentes e são a mesma:
   * corrigir o cadastro, POSTERGAR (mudar só a data final) e CONCLUIR.
   * Nenhuma delas mexe em saldo de conta: o dinheiro já aplicado continua
   * onde está, e mudar o prazo só muda a conta da mensalidade — que é
   * recalculada na leitura seguinte.
   */
  async update(id: string, input: AlterarObjetivo, requestingUserId: string) {
    const atual = await this.meu(this.prisma, id, requestingUserId);

    const inicio = input.startDate === undefined ? atual.startDate : new Date(input.startDate);
    const prazo = input.targetDate === undefined ? atual.targetDate : new Date(input.targetDate);
    if (prazo < inicio) {
      throw new BadRequestException('A data final não pode ser antes da inicial.');
    }
    if (input.accountId) {
      await this.conferirConta(this.prisma, requestingUserId, input.accountId);
    }

    return this.prisma.goal.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.startDate === undefined ? {} : { startDate: inicio }),
        ...(input.targetDate === undefined ? {} : { targetDate: prazo }),
        ...(input.targetAmount === undefined
          ? {}
          : { targetAmount: new Prisma.Decimal(input.targetAmount) }),
        ...(input.initialBalance === undefined
          ? {}
          : { initialBalance: new Prisma.Decimal(input.initialBalance) }),
        ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
        ...(input.isCompleted === undefined
          ? {}
          : { completedAt: input.isCompleted ? (atual.completedAt ?? new Date()) : null }),
      },
    });
  }

  /**
   * Excluir só vale para objetivo que não está segurando dinheiro de conta.
   * Apagar um com valor aplicado faria esse dinheiro desaparecer do total sem
   * nunca ter voltado para conta nenhuma — então o app pede o resgate antes,
   * em vez de escolher sozinho para onde o dinheiro vai.
   */
  async remove(id: string, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const atual = await tx.goal.findFirst({
        where: { id, userId: requestingUserId },
        include: { movements: { select: { type: true, amount: true } } },
      });
      if (!atual) throw new NotFoundException('Objetivo não encontrado');

      const aplicado = aplicadoDasContas(atual.movements as MovimentoDoObjetivo[]);
      if (aplicado.greaterThan(0)) {
        throw new BadRequestException(
          `Resgate os R$ ${emReais(aplicado)} aplicados antes de excluir o objetivo.`,
        );
      }
      await tx.goal.delete({ where: { id } });
      return { id };
    });
  }

  // ----------------------------------------------------------
  // Mexer no dinheiro
  // ----------------------------------------------------------

  /** Aplicar: sai da conta, entra no objetivo. */
  async aplicar(goalId: string, input: MoverObjetivo) {
    return this.movimentar(goalId, input, 'DEPOSIT');
  }

  /** Resgatar: sai do objetivo, entra na conta que o usuário escolher. */
  async resgatar(goalId: string, input: MoverObjetivo) {
    return this.movimentar(goalId, input, 'WITHDRAW');
  }

  /** Apagar um movimento desfaz o que ele fez no saldo da conta. */
  async removerMovimento(id: string, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.goalMovement.findFirst({ where: { id, userId: requestingUserId } });
      if (!m) throw new NotFoundException('Movimento não encontrado');

      // DEPOSIT tirou da conta: devolve. WITHDRAW pôs na conta: tira.
      await this.mexerNaConta(tx, m.bankAccountId, m.type === 'DEPOSIT' ? 'increment' : 'decrement', m.amount);
      await tx.goalMovement.delete({ where: { id } });
      return { id };
    });
  }

  private async movimentar(goalId: string, input: MoverObjetivo, tipo: 'DEPOSIT' | 'WITHDRAW') {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const repetido = await this.jaGravado(tx, input.userId, input.clientKey);
        if (repetido) return repetido;

        const objetivo = await tx.goal.findFirst({
          where: { id: goalId, userId: input.userId },
          include: { movements: { select: { type: true, amount: true } } },
        });
        if (!objetivo) throw new NotFoundException('Objetivo não encontrado');

        // Concluído não recebe mais aplicação — mas resgatar continua valendo,
        // senão o dinheiro ficaria preso em algo que já terminou.
        if (tipo === 'DEPOSIT' && objetivo.completedAt) {
          throw new BadRequestException('Este objetivo já foi concluído.');
        }
        await this.conferirConta(tx, input.userId, input.bankAccountId);

        const valor = new Prisma.Decimal(input.amount);
        if (tipo === 'WITHDRAW') {
          const saldo = saldoDoObjetivo(
            objetivo.initialBalance,
            objetivo.movements as MovimentoDoObjetivo[],
          );
          if (valor.greaterThan(saldo)) {
            throw new BadRequestException(
              `O objetivo tem R$ ${emReais(saldo)} guardados — não dá para resgatar mais que isso.`,
            );
          }
        }

        const movimento = await tx.goalMovement.create({
          data: {
            userId: input.userId,
            goalId,
            bankAccountId: input.bankAccountId,
            type: tipo,
            amount: valor,
            description: input.description ?? null,
            movementDate: new Date(input.movementDate),
            clientKey: input.clientKey ?? null,
          },
        });

        await this.mexerNaConta(
          tx,
          input.bankAccountId,
          tipo === 'DEPOSIT' ? 'decrement' : 'increment',
          valor,
        );
        return movimento;
      });
    } catch (e) {
      const existente = await this.perdeuACorrida(e, input.userId, input.clientKey);
      if (existente) return existente;
      throw e;
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  /** Junta ao objetivo as contas que a tela lê: guardado, falta, mensalidade
   * e quanto dele está vindo das contas do usuário. */
  private comAsContas(objetivo: any, movimentos: MovimentoDoObjetivo[], hoje: Date) {
    const saldo = saldoDoObjetivo(objetivo.initialBalance, movimentos);
    return {
      ...objetivo,
      /** Quanto do guardado saiu das contas — é esta parte, e não o saldo
       * inicial, que o saldo geral continua somando. */
      appliedFromAccounts: emReais(aplicadoDasContas(movimentos)),
      progress: progressoDoObjetivo(objetivo.targetAmount, saldo, hoje, objetivo.targetDate),
    };
  }

  private async mexerNaConta(
    tx: Prisma.TransactionClient,
    id: string,
    direcao: 'increment' | 'decrement',
    valor: Prisma.Decimal,
  ) {
    await tx.bankAccount.update({
      where: { id },
      data: { currentBalance: { [direcao]: valor } as any },
    });
  }

  private async conferirConta(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    id: string,
  ) {
    const conta = await tx.bankAccount.findFirst({ where: { id, userId }, select: { id: true } });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada');
  }

  private async meu(
    tx: Prisma.TransactionClient | PrismaService,
    id: string,
    userId: string,
  ) {
    const o = await tx.goal.findFirst({ where: { id, userId } });
    if (!o) throw new NotFoundException('Objetivo não encontrado');
    return o;
  }

  private async jaGravado(tx: Prisma.TransactionClient, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    return tx.goalMovement.findFirst({ where: { userId, clientKey } });
  }

  /** Violação do índice único = alguém gravou esta chave enquanto eu tentava.
   * Não é erro do usuário: é o mesmo movimento, e a resposta certa é ele. */
  private async perdeuACorrida(e: unknown, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    if ((e as { code?: string })?.code !== 'P2002') return null;
    return this.prisma.goalMovement.findFirst({ where: { userId, clientKey } });
  }
}
