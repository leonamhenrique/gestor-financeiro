// ============================================================
// invoice-closing.scheduler.ts
// ============================================================
// MODELO HÍBRIDO — papel deste job após o ajuste:
//
// A leitura individual de fatura (CreditCardInvoicesService) NUNCA
// depende deste cron: ela recalcula o status na hora via `montarFaturas`
// (invoice-statement.ts). Então, mesmo que este job não rode por um dia,
// o app continua mostrando o status correto para o usuário.
//
// Este cron continua existindo por dois motivos:
//
// 1. CONSOLIDAÇÃO: mantém o campo `status` do banco alinhado, para que
//    queries em massa que filtram diretamente por status no SQL (ex:
//    "buscar todas as faturas OVERDUE de todos os usuários para disparar
//    notificação push") não precisem carregar e recalcular fatura por
//    fatura em memória — isso seria caro em escala.
//
// 2. CICLO SEGUINTE: garante que a fatura do próximo mês já exista
//    (com total zerado) assim que a atual fecha, para o dashboard poder
//    exibir "fatura atual: R$ 0,00" mesmo antes da primeira compra.
//    Isso é necessário no cron porque não há leitura "sob demanda" que
//    dispare a criação de uma fatura nova — precisa existir antes de a
//    primeira transação do mês tentar dar upsert nela.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { comUsuario } from '../prisma/contexto';
import { InvoiceStatus } from '@prisma/client';
import { InvoicePaymentsService } from './invoice-payments.service';
import { cicloDoDia, diasDaReferencia } from './billing-cycle';
import { FUSO_DO_APP, hojeNoFuso } from './invoice-statement';

@Injectable()
export class InvoiceClosingScheduler {
  private readonly logger = new Logger(InvoiceClosingScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagamentos: InvoicePaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: FUSO_DO_APP })
  async handleDailyInvoiceMaintenance() {
    const hoje = hojeNoFuso();
    // Antes de qualquer conta: se um período novo começou hoje, as colunas do
    // cartão passam a ser as dele.
    await this.realinharColunasDoCiclo(hoje);
    await this.consolidateStatuses();
    await this.ensureNextCycleInvoices(hoje);
  }

  // Reusa a MESMA consolidação que o pagamento faz (que por sua vez usa a
  // mesma regra da leitura): cron, pagamento e leitura nunca discordam
  // sobre o status. É por cartão, e não por fatura, porque o rotativo liga
  // uma fatura à seguinte — vencer a de setembro muda a de outubro.
  /** Os donos, um a um.
   *
   * A rotina é de sistema, mas o banco tem RLS: uma varredura sem dono no
   * contexto enxergaria zero cartões e não faria nada — em silêncio, que é o
   * pior jeito de falhar. Em vez de criar um atalho para ver tudo (uma porta
   * dos fundos é uma porta, mesmo que só eu use), ela roda de usuário em
   * usuário, com o dono certo em cada volta. `users` não tem RLS: é a tabela
   * de identidade, que o login precisa ler antes de saber quem é quem. */
  private async cadaDono(): Promise<string[]> {
    const donos = await this.prisma.user.findMany({ select: { id: true } });
    return donos.map((d) => d.id);
  }

  private async consolidateStatuses() {
    for (const userId of await this.cadaDono()) {
      await comUsuario(userId, () => this.consolidarDoDono(userId));
    }
  }

  private async consolidarDoDono(userId: string) {
    const cards = await this.prisma.creditCard.findMany({ where: { isActive: true }, include: { cycles: { orderBy: { validFrom: 'asc' } } } });
    for (const card of cards) {
      try {
        await this.prisma.$transaction((tx) => this.pagamentos.consolidar(tx, card.id, card));
      } catch (erro) {
        // Um cartão com problema não pode impedir a consolidação dos outros.
        this.logger.error(`Falha ao consolidar faturas do cartão ${card.id}: ${(erro as Error).message}`);
      }
    }
  }

  // `hoje` é o dia do calendário no fuso do app ('AAAA-MM-DD').
  async ensureNextCycleInvoices(hoje: string) {
    for (const userId of await this.cadaDono()) {
      await comUsuario(userId, () => this.garantirCicloDoDono(hoje));
    }
  }

  /**
   * As colunas `closing_day`/`due_day` do cartão são o período de AGORA, e um
   * período agendado para a fatura seguinte faz elas ficarem para trás quando
   * esse mês chega. Realinhar é daqui.
   *
   * Elas não são a verdade — a verdade é a linha do tempo, e toda leitura que
   * decide fatura já a carrega. São o atalho de quem só quer saber do ciclo
   * de hoje, e um atalho que aponta para o mês passado é pior que atalho
   * nenhum.
   */
  private async realinharColunasDoCiclo(hoje: string) {
    for (const userId of await this.cadaDono()) {
      await comUsuario(userId, async () => {
        const cards = await this.prisma.creditCard.findMany({
          where: { isActive: true },
          include: { cycles: { orderBy: { validFrom: 'asc' } } },
        });
        for (const card of cards) {
          if (!card.cycles.length) continue;
          const ciclo = cicloDoDia(hoje, card);
          const dias = diasDaReferencia(
            ciclo.referenceMonth.getUTCFullYear(),
            ciclo.referenceMonth.getUTCMonth(),
            card,
          );
          if (dias.closingDay === card.closingDay && dias.dueDay === card.dueDay) continue;
          await this.prisma.creditCard.update({
            where: { id: card.id },
            data: { closingDay: dias.closingDay, dueDay: dias.dueDay },
          });
          this.logger.log(`Ciclo do cartão ${card.id} passou a fechar dia ${dias.closingDay}`);
        }
      });
    }
  }

  private async garantirCicloDoDono(hoje: string) {
    const cards = await this.prisma.creditCard.findMany({ where: { isActive: true } });

    for (const card of cards) {
      // Sem a linha do tempo: aqui a pergunta é sobre HOJE, e as colunas do
      // cartão são o período de agora.
      const { referenceMonth, closingDate, dueDate } = cicloDoDia(hoje, card);

      await this.prisma.creditCardInvoice.upsert({
        where: {
          creditCardId_referenceMonth: { creditCardId: card.id, referenceMonth },
        },
        create: {
          creditCardId: card.id,
          referenceMonth,
          closingDate,
          dueDate,
          totalAmount: 0,
          status: InvoiceStatus.OPEN,
        },
        update: {}, // já existe, não faz nada
      });
    }
  }

}
