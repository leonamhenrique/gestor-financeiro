// ============================================================
// bank-accounts.service.ts
// ============================================================
// Regras de negócio centrais deste módulo:
//
// 1. `currentBalance` nunca é editado livremente por um PATCH genérico.
//    Ele só muda por: (a) uma transação lançada [ver TransactionsService],
//    ou (b) um ajuste explícito via `adjustBalance` (ex: conciliação
//    com o extrato do banco). Isso evita que o usuário "resolva" uma
//    divergência editando o número direto e perdendo o motivo por trás
//    da mudança.
//
// 2. `initialBalance` só pode ser alterado enquanto a conta ainda não
//    tem nenhuma transação. Depois disso, mudar o saldo "de origem"
//    retroativamente invalidaria todo o histórico já calculado sobre
//    ele. A partir daí, a única via é o ajuste explícito.
//
// 3. Excluir uma conta com histórico (transações ou cartões vinculados)
//    faria a Transaction.bankAccountId virar órfã ou, pior, o Prisma
//    bloquear a operação por FK. Em vez de deixar o usuário tomar um
//    erro de banco de dados, fazemos soft-delete (isActive = false)
//    automaticamente nesses casos, e só removemos de fato quando não
//    há nenhum vínculo.
//
// 4. Conta oculta (`isHidden`) continua valendo — lançamentos, saldo e
//    pagamentos seguem normais —, mas fica fora do saldo geral e dos
//    lançamentos listados por padrão. É diferente de arquivar: arquivada
//    sai da lista de contas; oculta aparece nela, esmaecida.
// ============================================================

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType } from '@prisma/client';
import { ORDEM_DA_LISTA, gravarOrdem, novaOrdem } from '../common/ordering';

interface CreateBankAccountInput {
  userId: string;
  institutionName: string;
  institutionLogoUrl?: string;
  accountType: AccountType;
  initialBalance?: number;
  color?: string;
}

interface UpdateBankAccountInput {
  institutionName?: string;
  institutionLogoUrl?: string;
  accountType?: AccountType;
  color?: string;
  isHidden?: boolean;
}

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateBankAccountInput) {
    const initialBalance = input.initialBalance ?? 0;
    const ultima = await this.prisma.bankAccount.findFirst({
      where: { userId: input.userId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.bankAccount.create({
      data: {
        userId: input.userId,
        institutionName: input.institutionName,
        institutionLogoUrl: input.institutionLogoUrl,
        accountType: input.accountType,
        initialBalance,
        currentBalance: initialBalance, // no nascimento, saldo atual = saldo inicial
        color: input.color,
        sortOrder: ultima ? ultima.sortOrder + 1 : 0, // nova conta entra no fim
      },
    });
  }

  // Lista as contas do usuário para a Tela Inicial / Cadastro de Bancos.
  // Por padrão só traz ativas; `includeInactive` serve para uma tela de
  // "contas arquivadas", se você quiser esse recurso no futuro.
  async findAllByUser(userId: string, includeInactive = false) {
    return this.prisma.bankAccount.findMany({
      where: {
        userId,
        isActive: includeInactive ? undefined : true,
      },
      orderBy: ORDEM_DA_LISTA,
    });
  }

  /** Nova ordem das contas (arrastar na lista). Ver common/ordering.ts. */
  async reorder(userId: string, ids: string[]) {
    const atuais = await this.prisma.bankAccount.findMany({
      where: { userId },
      orderBy: ORDEM_DA_LISTA,
      select: { id: true, sortOrder: true },
    });
    const final = novaOrdem(ids, atuais);
    await this.prisma.$transaction(async (tx) => {
      await gravarOrdem(final, atuais, (id, sortOrder) => tx.bankAccount.update({ where: { id }, data: { sortOrder } }));
    });
    return { order: final };
  }

  async findOneByUser(userId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!account) throw new NotFoundException('Conta bancária não encontrada');
    return account;
  }

  // Soma de currentBalance das contas ativas e NÃO ocultas — usada no
  // card de "saldo geral total" do Dashboard.
  async getTotalBalance(userId: string) {
    const result = await this.prisma.bankAccount.aggregate({
      where: { userId, isActive: true, isHidden: false },
      _sum: { currentBalance: true },
    });
    return result._sum.currentBalance ?? 0;
  }

  // O saldo geral separado em visível e oculto (o app mostra os dois).
  async getBalanceSummary(userId: string) {
    const grupos = await this.prisma.bankAccount.groupBy({
      by: ['isHidden'],
      where: { userId, isActive: true },
      _sum: { currentBalance: true },
      _count: { _all: true },
    });
    const de = (oculta: boolean) => grupos.find((g) => g.isHidden === oculta);
    return {
      visible: Number(de(false)?._sum.currentBalance ?? 0),
      hidden: Number(de(true)?._sum.currentBalance ?? 0),
      hiddenAccounts: de(true)?._count._all ?? 0,
    };
  }

  async update(userId: string, accountId: string, input: UpdateBankAccountInput) {
    await this.findOneByUser(userId, accountId); // valida existência + posse

    return this.prisma.bankAccount.update({
      where: { id: accountId },
      data: input,
    });
  }

  // Único caminho para mudar `initialBalance` depois da criação — e só
  // funciona se a conta ainda não tiver nenhuma transação lançada.
  async updateInitialBalance(userId: string, accountId: string, newInitialBalance: number) {
    const account = await this.findOneByUser(userId, accountId);

    const [transactionCount, paymentCount] = await Promise.all([
      this.prisma.transaction.count({ where: { bankAccountId: accountId } }),
      this.prisma.invoicePayment.count({ where: { bankAccountId: accountId } }),
    ]);

    // Pagamento de fatura também já mexeu no saldo: reescrever o saldo
    // inicial apagaria esse efeito.
    if (transactionCount > 0 || paymentCount > 0) {
      throw new BadRequestException(
        'Esta conta já possui transações. Use o ajuste de saldo em vez de editar o saldo inicial.',
      );
    }

    return this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { initialBalance: newInitialBalance, currentBalance: newInitialBalance },
    });
  }

  // Ajuste explícito de saldo — para quando o número no app não bate
  // com o extrato real do banco (ex: rendimento de poupança não
  // lançado, taxa cobrada que não passou pelo app, etc).
  //
  // NOTA DE EVOLUÇÃO: hoje isso só atualiza `currentBalance` direto.
  // Para ter auditoria completa (quem ajustou, quando, por quê), o
  // próximo passo natural é criar uma tabela `BalanceAdjustment` no
  // schema e gravar esse histórico nela, em vez de só no valor final.
  async adjustBalance(userId: string, accountId: string, newBalance: number, reason?: string) {
    const account = await this.findOneByUser(userId, accountId);

    return this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { currentBalance: newBalance },
    });
  }

  // Exclusão: hard delete só é seguro se não houver nada vinculado.
  // Caso contrário, vira soft-delete (arquivamento).
  async delete(userId: string, accountId: string) {
    await this.findOneByUser(userId, accountId);

    const [transactionCount, creditCardCount, paymentCount] = await Promise.all([
      this.prisma.transaction.count({ where: { bankAccountId: accountId } }),
      this.prisma.creditCard.count({ where: { bankAccountId: accountId } }),
      // Pagamento de fatura que saiu desta conta também é histórico (e a
      // chave estrangeira é Restrict: o banco recusaria a exclusão).
      this.prisma.invoicePayment.count({ where: { bankAccountId: accountId } }),
    ]);

    const hasHistory = transactionCount > 0 || creditCardCount > 0 || paymentCount > 0;

    if (hasHistory) {
      await this.prisma.bankAccount.update({
        where: { id: accountId },
        data: { isActive: false },
      });
      return { deleted: false, archived: true };
    }

    await this.prisma.bankAccount.delete({ where: { id: accountId } });
    return { deleted: true, archived: false };
  }

  // Reativa uma conta previamente arquivada.
  async reactivate(userId: string, accountId: string) {
    await this.findOneByUser(userId, accountId);
    return this.prisma.bankAccount.update({
      where: { id: accountId },
      data: { isActive: true },
    });
  }
}
