// ============================================================
// people.service.ts
// ============================================================
// As pessoas com quem se divide gasto.
//
// Não são usuários do app: não têm login, não têm e-mail e não recebem nada
// por aqui. É a agenda de quem divide — um nome, e no máximo uma chave Pix
// para a página pública poder mostrar "copiar chave".
//
// Excluir segue a regra do resto do sistema: pessoa com histórico (parte em
// despesa, despesa paga por ela, acerto) é arquivada (`isActive = false`),
// nunca apagada. As chaves estrangeiras são Restrict justamente para o banco
// recusar o apagão — e aqui a contagem vem ANTES, para o usuário receber uma
// conta arquivada em vez de um erro cru de banco.
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ORDEM_DA_LISTA, gravarOrdem, novaOrdem } from '../common/ordering';

interface CriarPessoa {
  userId: string;
  name: string;
  pixKey?: string;
}

interface AlterarPessoa {
  name?: string;
  pixKey?: string;
}

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CriarPessoa) {
    const quantas = await this.prisma.person.count({ where: { userId: input.userId } });
    return this.prisma.person.create({
      data: {
        userId: input.userId,
        name: input.name.trim(),
        pixKey: input.pixKey?.trim() || null,
        sortOrder: quantas,
      },
    });
  }

  findAllByUser(userId: string, incluirArquivadas = false) {
    return this.prisma.person.findMany({
      where: { userId, isActive: incluirArquivadas ? undefined : true },
      orderBy: ORDEM_DA_LISTA,
    });
  }

  /** A pessoa, conferindo que ela é de quem está pedindo. Todo lugar que
   * recebe um `personId` de fora passa por aqui: posse se confere, não se
   * presume. */
  async minha(userId: string, personId: string) {
    const pessoa = await this.prisma.person.findFirst({ where: { id: personId, userId } });
    if (!pessoa) throw new NotFoundException('Pessoa não encontrada');
    return pessoa;
  }

  async update(userId: string, personId: string, input: AlterarPessoa) {
    await this.minha(userId, personId);
    return this.prisma.person.update({
      where: { id: personId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.pixKey === undefined ? {} : { pixKey: input.pixKey.trim() || null }),
      },
    });
  }

  /** Apaga de verdade só quem nunca participou de nada. Com histórico,
   * arquiva — o passado continua somando no saldo de quem já dividiu. */
  async delete(userId: string, personId: string) {
    await this.minha(userId, personId);

    const [partes, pagouPor, acertos, links] = await Promise.all([
      this.prisma.expenseShare.count({ where: { personId } }),
      this.prisma.sharedExpense.count({ where: { paidByPersonId: personId } }),
      this.prisma.settlement.count({ where: { personId } }),
      // O link não impede apagar (é Cascade), mas apagar a pessoa derrubaria
      // um link que pode estar na mão de alguém. Quem tem link tem histórico.
      this.prisma.shareLink.count({ where: { personId, revokedAt: null } }),
    ]);

    if (partes > 0 || pagouPor > 0 || acertos > 0 || links > 0) {
      await this.prisma.person.update({ where: { id: personId }, data: { isActive: false } });
      return { deleted: false, archived: true };
    }

    await this.prisma.person.delete({ where: { id: personId } });
    return { deleted: true, archived: false };
  }

  async reactivate(userId: string, personId: string) {
    await this.minha(userId, personId);
    return this.prisma.person.update({ where: { id: personId }, data: { isActive: true } });
  }

  async reorder(userId: string, ids: string[]) {
    const atuais = await this.prisma.person.findMany({
      where: { userId },
      orderBy: ORDEM_DA_LISTA,
      select: { id: true, sortOrder: true },
    });
    const final = novaOrdem(ids, atuais);
    await gravarOrdem(final, atuais, (id, sortOrder) =>
      this.prisma.person.update({ where: { id }, data: { sortOrder } }),
    );
    return this.findAllByUser(userId, true);
  }
}
