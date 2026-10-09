// ============================================================
// budgets.service.ts
// ============================================================
// Planejamento mensal: quanto espero receber, quanto me permito gastar, e o
// teto de cada categoria.
//
// O que este serviço NÃO faz, de propósito: somar o que já foi gasto. Esse
// número depende da configuração de exibição de relatório — se a compra no
// cartão conta no mês da compra ou no mês em que a fatura vence —, e essa
// escolha é do aparelho, não da conta. Gravá-lo aqui seria gravar a resposta
// de ontem para uma pergunta que muda a cada lançamento novo. O app recalcula
// na leitura, sobre os lançamentos que ele já tem.
//
// Salvar é SUBSTITUIR o conjunto de metas, não casar item por item. A tela
// manda o planejamento inteiro toda vez; um merge parcial deixaria para trás
// a meta de uma categoria que a pessoa desmarcou.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  aplicarTotalDasFilhas,
  comprometido,
  emReais,
  mesValido,
  type CategoriaNaArvore,
  type MetaDeCategoria,
} from './budget.utils';

export interface MetaEntrada {
  categoryId: string;
  amount: number;
  fromChildren?: boolean;
}

export interface SalvarPlanejamento {
  userId: string;
  month: string;
  income?: number;
  total: number;
  items: MetaEntrada[];
}

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todos os planejamentos da pessoa, com as metas dentro. São uma linha por
   * mês e algumas dezenas de metas em cada — ordens de grandeza menos que a
   * lista de lançamentos que o app já carrega inteira. Trazer tudo de uma vez
   * deixa a navegação entre meses instantânea e a tela de copiar sem um
   * segundo pedido. */
  async findAllByUser(userId: string) {
    return this.prisma.budget.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { month: 'desc' },
    });
  }

  /**
   * Cria ou substitui o planejamento do mês. Tudo numa transação só: um
   * planejamento que perdeu as metas antigas e não ganhou as novas seria pior
   * que nenhum.
   */
  async save(input: SalvarPlanejamento) {
    this.conferirMes(input.month);
    if (input.total < 0) throw new BadRequestException('O planejamento não pode ser negativo.');

    const metas = await this.metasConferidas(input.userId, input.items, input.total);

    return this.prisma.$transaction(async (tx) => {
      const existente = await tx.budget.findFirst({
        where: { userId: input.userId, month: input.month },
        select: { id: true },
      });

      const budget = existente
        ? await tx.budget.update({
            where: { id: existente.id },
            data: {
              total: new Prisma.Decimal(input.total),
              ...(input.income === undefined ? {} : { income: new Prisma.Decimal(input.income) }),
            },
          })
        : await tx.budget.create({
            data: {
              userId: input.userId,
              month: input.month,
              total: new Prisma.Decimal(input.total),
              income: new Prisma.Decimal(input.income ?? 0),
            },
          });

      if (existente) await tx.budgetItem.deleteMany({ where: { budgetId: budget.id } });
      for (const m of metas) {
        await tx.budgetItem.create({
          data: {
            userId: input.userId,
            budgetId: budget.id,
            categoryId: m.categoryId,
            amount: m.amount,
            fromChildren: !!m.fromChildren,
          },
        });
      }

      return tx.budget.findFirst({ where: { id: budget.id }, include: { items: true } });
    });
  }

  async remove(userId: string, month: string) {
    this.conferirMes(month);
    const atual = await this.prisma.budget.findFirst({
      where: { userId, month },
      select: { id: true },
    });
    if (!atual) throw new NotFoundException('Planejamento não encontrado');
    await this.prisma.budget.delete({ where: { id: atual.id } });
    return { month };
  }

  /**
   * Copiar é salvar de novo com as metas de outro mês. Passa pelas mesmas
   * conferências do salvar — a categoria pode ter sido apagada desde então, e
   * uma meta órfã quebraria a tela no mês de destino.
   */
  async copy(userId: string, fromMonth: string, toMonth: string) {
    this.conferirMes(fromMonth);
    this.conferirMes(toMonth);
    if (fromMonth === toMonth) {
      throw new BadRequestException('Escolha um mês diferente para copiar.');
    }
    const origem = await this.prisma.budget.findFirst({
      where: { userId, month: fromMonth },
      include: { items: true },
    });
    if (!origem) throw new NotFoundException('Não há planejamento nesse mês para copiar.');

    return this.save({
      userId,
      month: toMonth,
      income: Number(origem.income),
      total: Number(origem.total),
      items: origem.items.map((i) => ({
        categoryId: i.categoryId,
        amount: Number(i.amount),
        fromChildren: i.fromChildren,
      })),
    });
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------

  private conferirMes(month: string) {
    if (!mesValido(month)) {
      throw new BadRequestException('Mês inválido. Use o formato AAAA-MM.');
    }
  }

  /**
   * Confere as metas e devolve-as prontas para gravar.
   *
   * Três recusas, e nenhuma é capricho:
   *   - categoria repetida deixaria duas metas para o mesmo lugar, e a tela
   *     não saberia qual mostrar;
   *   - categoria que não é de despesa (ou não é da pessoa) não tem teto a
   *     cumprir;
   *   - repartir mais do que o teto faria a sobra de "outras categorias"
   *     ficar negativa — o todo não cabe dentro das partes.
   */
  private async metasConferidas(
    userId: string,
    itens: MetaEntrada[],
    total: number,
  ): Promise<MetaDeCategoria[]> {
    if (!itens.length) return [];

    const ids = itens.map((i) => i.categoryId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A mesma categoria apareceu duas vezes no planejamento.');
    }

    // Categoria padrão do sistema tem `userId` nulo e vale para todo mundo.
    const categorias = await this.prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }] },
      select: { id: true, parentId: true, type: true },
    });
    const porId = new Map(categorias.map((c) => [c.id, c]));
    for (const i of itens) {
      const c = porId.get(i.categoryId);
      if (!c) throw new NotFoundException('Categoria não encontrada');
      if (c.type !== 'EXPENSE') {
        throw new BadRequestException('Planejamento é teto de gasto: só categoria de despesa entra.');
      }
      if (i.amount < 0) throw new BadRequestException('A meta não pode ser negativa.');
    }

    const arvore: CategoriaNaArvore[] = categorias.map((c) => ({ id: c.id, parentId: c.parentId }));
    const metas = aplicarTotalDasFilhas(
      itens.map((i) => ({
        categoryId: i.categoryId,
        amount: new Prisma.Decimal(i.amount),
        fromChildren: !!i.fromChildren,
      })),
      arvore,
    );

    const prometido = comprometido(metas, arvore);
    if (prometido.greaterThan(total)) {
      throw new BadRequestException(
        `As metas somam R$ ${emReais(prometido)} e o planejamento do mês é R$ ${emReais(
          new Prisma.Decimal(total),
        )}. Aumente o planejamento ou diminua alguma meta.`,
      );
    }
    return metas;
  }
}
