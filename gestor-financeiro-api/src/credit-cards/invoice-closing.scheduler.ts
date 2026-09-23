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
import { InvoiceStatus } from '@prisma/client';
import { InvoicePaymentsService } from './invoice-payments.service';
import { cicloDoDia } from './billing-cycle';
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
    await this.consolidateStatuses();
    await this.ensureNextCycleInvoices(hoje);
  }

  // Reusa a MESMA consolidação que o pagamento faz (que por sua vez usa a
  // mesma regra da leitura): cron, pagamento e leitura nunca discordam
  // sobre o status. É por cartão, e não por fatura, porque o rotativo liga
  // uma fatura à seguinte — vencer a de setembro muda a de outubro.
  private async consolidateStatuses() {
    const cards = await this.prisma.creditCard.findMany({ where: { isActive: true } });
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
    const cards = await this.prisma.creditCard.findMany({ where: { isActive: true } });

    for (const card of cards) {
      const { referenceMonth, closingDate, dueDate } = cicloDoDia(hoje, card.closingDay, card.dueDay);

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
