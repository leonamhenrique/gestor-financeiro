// ============================================================
// categories.service.ts
// ============================================================
// Regras de negócio centrais deste módulo:
//
// 1. Categorias "padrão" (isDefault = true, userId = null) são visíveis
//    para todo mundo, mas não pertencem a ninguém — nenhum usuário pode
//    editá-las ou excluí-las. Isso evita que um usuário edite
//    "Alimentação" e quebre a experiência de todos os outros.
//
// 2. Uma categoria é OU de receita OU de despesa (`type`), nunca as
//    duas. O tipo não é editável depois de criada (ver DTO) porque
//    mudar o tipo de uma categoria que já tem transações tornaria o
//    histórico incoerente.
//
// 3. Excluir uma categoria com transações vinculadas quebraria o
//    histórico (FK) ou deixaria transações "sem categoria". Por isso,
//    a exclusão só é permitida se: (a) não há nenhuma transação usando
//    a categoria, ou (b) o usuário explicitamente pede para reatribuir
//    as transações existentes para outra categoria antes de excluir.
//
// 4. Subcategorias (mesmas regras do app): um nível só — a pai é sempre
//    raiz e do mesmo tipo. Pode ser uma categoria padrão ("Alimentação >
//    Mercado"); a filha é sempre do usuário. Categoria com filhas não vira
//    filha, não é excluída e não recebe lançamento NOVO (o lançamento desce
//    para a filha); os que já apontavam para ela continuam válidos.
//
// 5. Nome único entre irmãs (mesmo pai e tipo), sem diferenciar maiúsculas
//    e acentos: duas irmãs "Luz" e "luz" deixam a escolha ambígua. Em pais
//    diferentes o mesmo nome é legítimo.
// ============================================================

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType } from '@prisma/client';
import { ORDEM_DA_LISTA, gravarOrdem, novaOrdem } from '../common/ordering';

interface CreateCategoryInput {
  userId: string;
  name: string;
  type: TransactionType;
  icon?: string;
  color?: string;
  parentId?: string | null;
}

interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  parentId?: string | null; // null = volta a ser raiz
}

export function normalizarNome(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateCategoryInput) {
    const parentId = input.parentId ?? null;
    if (parentId) await this.conferirPai(input.userId, parentId, input.type);
    await this.conferirNome(input.userId, input.name, input.type, parentId);

    const ultima = await this.prisma.category.findFirst({
      where: { userId: input.userId, type: input.type, parentId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.category.create({
      data: {
        userId: input.userId,
        name: input.name,
        type: input.type,
        icon: input.icon,
        color: input.color,
        parentId,
        sortOrder: ultima ? ultima.sortOrder + 1 : 0,
        isDefault: false,
      },
    });
  }

  // Retorna as categorias padrão do sistema + as personalizadas do
  // usuário, opcionalmente filtradas por tipo. Lista plana com `parentId`
  // (o app monta a árvore) e `childrenCount` — só as filhas DO USUÁRIO, que
  // são as que ele vê. `childrenCount > 0` = não recebe lançamento novo.
  async findAllForUser(userId: string, type?: TransactionType) {
    const categorias = await this.prisma.category.findMany({
      where: {
        type,
        OR: [{ userId }, { isDefault: true }],
      },
      include: { _count: { select: { children: { where: { userId } } } } },
      orderBy: [{ isDefault: 'desc' }, ...ORDEM_DA_LISTA, { name: 'asc' }],
    });
    return categorias.map(({ _count, ...c }) => ({ ...c, childrenCount: _count.children }));
  }

  async findOneForUser(userId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { isDefault: true }] },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    return category;
  }

  async update(userId: string, categoryId: string, input: UpdateCategoryInput) {
    const category = await this.getOwnedCategoryOrThrow(userId, categoryId);

    const mudaPai = input.parentId !== undefined && (input.parentId ?? null) !== (category.parentId ?? null);
    const parentId = input.parentId === undefined ? category.parentId ?? null : input.parentId;

    if (mudaPai) {
      if (parentId === categoryId) throw new BadRequestException('Uma categoria não pode ser pai dela mesma.');
      if (parentId && (await this.quantasFilhas(userId, categoryId)) > 0) {
        throw new BadRequestException('Esta categoria já tem filhas, então ela própria não pode virar filha de outra.');
      }
      if (parentId) await this.conferirPai(userId, parentId, category.type);
    }
    if (mudaPai || (input.name !== undefined && normalizarNome(input.name) !== normalizarNome(category.name))) {
      await this.conferirNome(userId, input.name ?? category.name, category.type, parentId, categoryId);
    }

    return this.prisma.category.update({
      where: { id: categoryId },
      data: { name: input.name, icon: input.icon, color: input.color, ...(mudaPai ? { parentId } : {}) },
    });
  }

  /** Reordena irmãs (mesmo pai e tipo) do usuário. Categoria padrão não
   * entra: a ordem dela é a mesma para todo mundo. */
  async reorder(userId: string, ids: string[]) {
    if (!ids.length) throw new BadRequestException('Informe a nova ordem.');
    const primeira = await this.getOwnedCategoryOrThrow(userId, ids[0]);
    const irmas = await this.prisma.category.findMany({
      where: { userId, type: primeira.type, parentId: primeira.parentId ?? null },
      orderBy: ORDEM_DA_LISTA,
      select: { id: true, sortOrder: true },
    });
    let final: string[];
    try {
      final = novaOrdem(ids, irmas);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new BadRequestException('Só dá para reordenar categorias irmãs: mesmo pai e mesmo tipo.');
      }
      throw e;
    }
    await this.prisma.$transaction(async (tx) => {
      await gravarOrdem(final, irmas, (id, sortOrder) => tx.category.update({ where: { id }, data: { sortOrder } }));
    });
    return { order: final };
  }

  // `reassignToCategoryId`: se informado, todas as transações da
  // categoria excluída são movidas para essa outra categoria antes da
  // exclusão (dentro da mesma transação de banco, para não deixar
  // nenhuma transação "solta" no meio do caminho).
  async delete(userId: string, categoryId: string, reassignToCategoryId?: string) {
    const category = await this.getOwnedCategoryOrThrow(userId, categoryId);

    const filhas = await this.quantasFilhas(userId, categoryId);
    if (filhas > 0) {
      throw new BadRequestException(
        `${category.name} tem ${filhas} ${filhas === 1 ? 'subcategoria' : 'subcategorias'}. ` +
          `Mova ou exclua ${filhas === 1 ? 'ela' : 'elas'} antes, para nenhum lançamento ficar órfão.`,
      );
    }

    const transactionCount = await this.prisma.transaction.count({
      where: { categoryId },
    });

    if (transactionCount > 0 && !reassignToCategoryId) {
      throw new BadRequestException(
        `Esta categoria tem ${transactionCount} transação(ões) vinculada(s). ` +
          'Informe "reassignToCategoryId" para migrá-las antes de excluir.',
      );
    }

    if (transactionCount > 0 && reassignToCategoryId) {
      if (reassignToCategoryId === categoryId) {
        throw new BadRequestException('Escolha outra categoria para receber os lançamentos.');
      }
      const target = await this.findOneForUser(userId, reassignToCategoryId);
      if (target.type !== category.type) {
        throw new BadRequestException(
          'A categoria de destino precisa ser do mesmo tipo (receita/despesa) da categoria excluída.',
        );
      }
      // Só folha recebe lançamento.
      if ((await this.quantasFilhas(userId, target.id)) > 0) {
        throw new BadRequestException(
          `${target.name} tem subcategorias: escolha uma delas para receber os lançamentos.`,
        );
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.transaction.updateMany({
          where: { categoryId },
          data: { categoryId: reassignToCategoryId },
        });
        await tx.category.delete({ where: { id: categoryId } });
        return { deleted: true, reassignedTransactions: transactionCount };
      });
    }

    await this.prisma.category.delete({ where: { id: categoryId } });
    return { deleted: true, reassignedTransactions: 0 };
  }

  // ----------------------------------------------------------
  // Helpers privados
  // ----------------------------------------------------------

  private quantasFilhas(userId: string, categoryId: string) {
    return this.prisma.category.count({ where: { parentId: categoryId, userId } });
  }

  private async conferirPai(userId: string, parentId: string, type: TransactionType) {
    const pai = await this.prisma.category.findFirst({
      where: { id: parentId, OR: [{ userId }, { isDefault: true }] },
    });
    if (!pai) throw new NotFoundException('Categoria pai não encontrada');
    if (pai.type !== type) {
      throw new BadRequestException('A categoria pai precisa ser do mesmo tipo (receita/despesa).');
    }
    if (pai.parentId) {
      throw new BadRequestException(`${pai.name} já é uma subcategoria. Só há um nível: escolha uma categoria raiz.`);
    }
  }

  private async conferirNome(
    userId: string,
    nome: string,
    type: TransactionType,
    parentId: string | null,
    ignorarId?: string,
  ) {
    const irmas = await this.prisma.category.findMany({
      where: { type, parentId, OR: [{ userId }, { isDefault: true }] },
      select: { id: true, name: true },
    });
    const alvo = normalizarNome(nome);
    if (!irmas.some((c) => c.id !== ignorarId && normalizarNome(c.name) === alvo)) return;

    if (parentId) {
      const pai = await this.prisma.category.findFirst({ where: { id: parentId }, select: { name: true } });
      throw new ConflictException(
        `Já existe "${nome}" dentro de ${pai?.name ?? 'esta categoria'}. Duas subcategorias irmãs não podem ter o mesmo nome.`,
      );
    }
    throw new ConflictException(
      `Você já tem uma categoria de ${type === 'INCOME' ? 'receita' : 'despesa'} chamada "${nome}".`,
    );
  }

  // Garante que a categoria existe, pertence ao usuário (não é
  // padrão/de outro usuário) — usado antes de qualquer edição/exclusão.
  private async getOwnedCategoryOrThrow(userId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, userId }, // note: sem isDefault:true aqui de propósito
    });

    if (!category) {
      // Mesma mensagem tanto para "não existe" quanto para "é padrão/de
      // outro usuário" — não vale a pena vazar qual dos dois casos é.
      throw new NotFoundException('Categoria não encontrada ou não pode ser editada.');
    }

    return category;
  }
}
