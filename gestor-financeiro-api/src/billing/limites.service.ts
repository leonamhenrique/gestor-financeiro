// ============================================================
// limites.service.ts — a trava, no único lugar que conta
// ============================================================
// A tela apaga o que não está no plano, mas isso é cortesia: quem manda um
// POST na mão passa por cima dela. A trava é AQUI, antes de criar.
//
// O que ela NÃO faz: apagar, esconder ou bloquear leitura. Quem tem cinco
// contas e cai para o grátis continua com as cinco, vendo e editando todas —
// o que ele não pode é criar a sexta. Dado registrado pela pessoa não vira
// refém de cobrança.
//
// O erro carrega `code` e o número, não só uma frase: é o que deixa a tela
// dizer "o grátis vai até 1 cartão; no Pro são 10" em vez de repetir uma
// mensagem genérica que não ajuda ninguém a decidir.
// ============================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { cabeMais } from './entitlements';

/** O que se conta, e como se chama na frase do erro. */
type Recurso = 'contas' | 'cartoes' | 'objetivos' | 'bancos';

const NOME: Record<Recurso, { singular: string; plural: string }> = {
  contas: { singular: 'conta', plural: 'contas' },
  cartoes: { singular: 'cartão', plural: 'cartões' },
  objetivos: { singular: 'objetivo', plural: 'objetivos' },
  bancos: { singular: 'banco conectado', plural: 'bancos conectados' },
};

@Injectable()
export class LimitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  /** Cabe mais uma conta? Senão, 403 com o limite e o que ele tem. */
  async conferirConta(userId: string) {
    return this.conferir(userId, 'contas', () =>
      this.prisma.bankAccount.count({ where: { userId, isActive: true } }),
    );
  }

  async conferirCartao(userId: string) {
    return this.conferir(userId, 'cartoes', () =>
      this.prisma.creditCard.count({ where: { userId, isActive: true } }),
    );
  }

  /* Objetivo concluído não conta: ele sai das escolhas e vira histórico, e
   * cobrar limite por histórico seria obrigar a apagar o que deu certo. */
  async conferirObjetivo(userId: string) {
    return this.conferir(userId, 'objetivos', () =>
      this.prisma.goal.count({ where: { userId, completedAt: null } }),
    );
  }

  /** Conexão de Open Finance: conta só as que estão de pé. */
  async conferirBanco(userId: string) {
    return this.conferir(userId, 'bancos', () =>
      this.prisma.openFinanceConnection.count({ where: { userId, revokedAt: null } }),
    );
  }

  private async conferir(userId: string, recurso: Recurso, contar: () => Promise<number>) {
    const direitos = await this.billing.direitos(userId);
    const limite = direitos[recurso] as number | null;
    const nome = NOME[recurso];

    /* As duas respostas que não dependem de contar nada: sem limite sempre
     * cabe, e em limite ZERO nunca cabe. Contar nesses dois casos seria uma
     * consulta ao banco por cadastro para chegar numa conclusão que já estava
     * dada. */
    if (limite === null) return;
    if (limite === 0) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT',
        recurso,
        limite,
        message: `O seu plano não inclui ${nome.plural}.`,
      });
    }

    const quantos = await contar();
    if (cabeMais(limite, quantos)) return;

    throw new ForbiddenException({
      code: 'PLAN_LIMIT',
      recurso,
      limite,
      quantos,
      message: `O seu plano vai até ${limite} ${limite === 1 ? nome.singular : nome.plural}.`,
    });
  }
}
