// ============================================================
// category-rules.service.ts
// ============================================================
// O que o usuário ensinou sobre um lojista, para a importação seguinte não
// perguntar de novo.
//
// A regra é uma linha só: lojista → categoria. Não há peso, probabilidade nem
// aprendizado estatístico — o usuário classificou, e isso basta. Modelo
// simples de propósito: um palpite errado que passa despercebido vira dado
// errado, e aqui a origem de cada palpite é sempre rastreável até um clique.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryRuleItemDto } from './dto/category-rule.dto';

@Injectable()
export class CategoryRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** As regras do usuário, da mais específica para a mais genérica.
   *
   * A ordem não é enfeite: o cliente casa por PREFIXO e precisa que a regra
   * mais longa ganhe. Mandando já ordenado, o primeiro casamento é o certo,
   * e a tela não precisa saber dessa regra para acertar. */
  async listar(userId: string) {
    const regras = await this.prisma.categoryRule.findMany({
      where: { userId },
      select: { id: true, merchant: true, categoryId: true, hits: true, updatedAt: true },
    });
    return regras.sort(
      (a, b) => b.merchant.length - a.merchant.length || a.merchant.localeCompare(b.merchant),
    );
  }

  /**
   * Grava o que a importação ensinou.
   *
   * Vem em leva porque é assim que se aprende: uma importação confirma vários
   * lojistas de uma vez, e um pedido por lojista seria uma rajada de escritas
   * para gravar o resultado de um clique só.
   *
   * Ensinar de novo o mesmo lojista TROCA a categoria e soma um acerto. Duas
   * regras para o mesmo lojista brigariam para sempre, e qual venceria
   * dependeria da ordem da listagem — que é exatamente o tipo de resultado
   * que ninguém consegue explicar depois.
   */
  async upsert(userId: string, regras: CategoryRuleItemDto[]) {
    // Lojista repetido DENTRO da mesma leva: fica o último. Sem isto o
    // `upsert` rodaria duas vezes na mesma chave e o `hits` contaria 2 por
    // uma importação só.
    const porLojista = new Map<string, CategoryRuleItemDto>();
    regras.forEach((r) => porLojista.set(r.merchant, r));
    const unicas = [...porLojista.values()];

    await this.conferirCategorias(
      userId,
      unicas.map((r) => r.categoryId),
    );

    await this.prisma.$transaction(
      unicas.map((r) =>
        this.prisma.categoryRule.upsert({
          where: { userId_merchant: { userId, merchant: r.merchant } },
          create: { userId, merchant: r.merchant, categoryId: r.categoryId },
          update: { categoryId: r.categoryId, hits: { increment: 1 } },
        }),
      ),
    );

    return this.listar(userId);
  }

  async remover(userId: string, id: string) {
    // `deleteMany` com o userId junto, e não `delete` pelo id: assim um id de
    // outra pessoa não apaga nada em vez de apagar o que não é dela.
    const { count } = await this.prisma.categoryRule.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Regra não encontrada');
    return { removidas: count };
  }

  /**
   * A categoria tem de ser do usuário (ou padrão do sistema) e tem de ser
   * FOLHA.
   *
   * Folha porque é a mesma regra que vale para lançar: categoria com filhas
   * só agrupa. Uma regra apontando para uma pai geraria, na importação
   * seguinte, um palpite que o próprio app recusaria na hora de gravar.
   */
  private async conferirCategorias(userId: string, ids: string[]) {
    const unicos = [...new Set(ids)];
    const categorias = await this.prisma.category.findMany({
      where: { id: { in: unicos }, OR: [{ userId }, { userId: null }] },
      select: { id: true, _count: { select: { children: true } } },
    });
    const achadas = new Map(categorias.map((c) => [c.id, c]));

    for (const id of unicos) {
      const c = achadas.get(id);
      if (!c) throw new NotFoundException('Categoria não encontrada');
      if (c._count.children > 0) {
        throw new BadRequestException(
          'Categoria com subcategorias não recebe lançamento, então não serve de regra',
        );
      }
    }
  }
}
