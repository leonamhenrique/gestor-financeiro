// ============================================================
// credit-card-invoices.service.ts
// ============================================================
// Leitura de faturas. Status, valor em aberto, pagamentos e rotativo vêm
// sempre de `montarFaturas` (invoice-statement.ts), calculados na hora —
// nunca do campo `status` gravado, que é só consolidação para consultas em
// massa e pode estar um dia atrasado.
//
// Não existe mais "marcar como paga": fatura fica paga quando os
// pagamentos registrados cobrem o devido (InvoicePaymentsService).
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { faturaAtual, hojeNoFuso, montarFaturas } from './invoice-statement';

@Injectable()
export class CreditCardInvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Faturas do cartão, da mais recente para a mais antiga. */
  async findAllByCard(userId: string, creditCardId: string) {
    return (await this.calcular(userId, creditCardId)).reverse();
  }

  async findByMonth(userId: string, creditCardId: string, mes: string) {
    const fatura = (await this.calcular(userId, creditCardId)).find((f) => f.referenceMonth === mes);
    if (!fatura) throw new NotFoundException('Fatura não encontrada');
    return fatura;
  }

  /** A fatura "atual": a mais antiga com algo a pagar. */
  async findCurrentInvoice(userId: string, creditCardId: string) {
    return faturaAtual(await this.calcular(userId, creditCardId));
  }

  private async calcular(userId: string, creditCardId: string) {
    const cartao = await this.prisma.creditCard.findFirst({ where: { id: creditCardId, userId } });
    if (!cartao) throw new NotFoundException('Cartão de crédito não encontrado');
    const gravadas = await this.prisma.creditCardInvoice.findMany({
      where: { creditCardId },
      include: { payments: true },
      orderBy: { referenceMonth: 'asc' },
    });
    return montarFaturas(cartao, gravadas, hojeNoFuso());
  }
}
