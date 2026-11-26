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
import { hojeNoFuso } from '../credit-cards/invoice-statement';

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

  /** Os direitos deste usuário, para quem precisa de um NÚMERO e não de um
   * sim-ou-não — o teto de histórico do Open Finance, por exemplo. */
  async direitosPara(userId: string) {
    return this.billing.direitos(userId);
  }

  /** Esta conta paga (ou tem cortesia)? Estar no TESTE não é pagar — é de
   * quem está no teste que o banco conectado é desligado antes de o mês
   * virar, e é a ele que a tela mostra a data de validade da conexão. */
  async estaPagando(userId: string) {
    return this.billing.estaPagando(userId);
  }

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

  /**
   * O planejamento do grátis vale só para o mês corrente.
   *
   * Não é guard de rota como as outras funções: a rota é a mesma para
   * qualquer mês, e quem decide é o `:month` que veio. O mês corrente sai do
   * fuso do app, e não do relógio do servidor — virada de mês em UTC
   * aconteceria três horas antes aqui.
   */
  async conferirMesDoPlanejamento(userId: string, mes: string) {
    const direitos = await this.billing.direitos(userId);
    if (direitos.planejamentoCompleto) return;

    const atual = hojeNoFuso().slice(0, 7);
    if (mes === atual) return;

    throw new ForbiddenException({
      code: 'PLAN_FEATURE',
      funcao: 'planejamentoCompleto',
      mesPermitido: atual,
      message: 'No seu plano o planejamento vale para o mês corrente. Planejar outros meses é do Pro.',
    });
  }

  /**
   * Conta a mensagem do WhatsApp e diz se ela cabe na cota do mês.
   *
   * Não lança exceção como as outras travas, e isso é de propósito: do outro
   * lado há alguém esperando uma RESPOSTA no WhatsApp. Um 500 viraria
   * silêncio, e silêncio é a pior resposta possível para quem escreveu.
   *
   * No ilimitado nem conta: seria uma escrita no banco por mensagem para
   * chegar num número que ninguém vai consultar.
   *
   * O incremento é atômico (`upsert` com `increment`), porque duas mensagens
   * no mesmo segundo são comuns — quem manda três frases seguidas faz isso
   * sempre — e ler-somar-gravar perderia uma das duas.
   */
  async registrarMensagemDoWhatsapp(
    userId: string,
  ): Promise<{ permitido: boolean; limite: number | null; usadas: number }> {
    const direitos = await this.billing.direitos(userId);
    const limite = direitos.whatsappPorMes;

    if (limite === null) return { permitido: true, limite: null, usadas: 0 };
    /* Cota zero nem conta: o plano não tem WhatsApp, e a resposta é a mesma
     * na primeira e na milésima mensagem. */
    if (limite === 0) return { permitido: false, limite: 0, usadas: 0 };

    const mes = hojeNoFuso().slice(0, 7);
    const uso = await this.prisma.whatsappUsage.upsert({
      where: { userId_month: { userId, month: mes } },
      create: { userId, month: mes, count: 1 },
      update: { count: { increment: 1 } },
    });
    return { permitido: uso.count <= limite, limite, usadas: uso.count };
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
