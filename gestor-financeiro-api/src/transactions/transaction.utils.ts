// ============================================================
// transaction.utils.ts
// ============================================================
// Funções puras (sem dependência de banco) usadas pelo
// TransactionsService. Extraídas para arquivo separado para que
// possam ser testadas isoladamente, sem precisar instanciar o
// service inteiro nem mockar o Prisma.
// ============================================================

import { BadRequestException } from '@nestjs/common';
import { cicloDaData } from '../credit-cards/billing-cycle';

/**
 * Calcula a qual mês de referência uma compra de cartão pertence, com
 * base no dia de fechamento. Ex: fechamento dia 10 → compra em 15/set
 * pertence à fatura de outubro; compra em 05/set pertence à fatura de
 * setembro; compra exatamente no dia 10 ainda conta como mês corrente.
 *
 * As datas (entrada e saída) são dias em UTC — ver billing-cycle.ts, que é
 * quem faz a conta de verdade, incluindo vencimento no mês seguinte e dias
 * inexistentes no mês.
 */
export function resolveInvoicePeriod(transactionDate: Date, closingDay: number, dueDay: number) {
  return cicloDaData(transactionDate, closingDay, dueDay);
}

export function validateAmount(amount: number) {
  if (!amount || amount <= 0) {
    throw new BadRequestException('O valor da transação deve ser maior que zero.');
  }
}

export function validateAccountXorCard(bankAccountId?: string, creditCardId?: string) {
  const hasAccount = Boolean(bankAccountId);
  const hasCard = Boolean(creditCardId);

  if (hasAccount === hasCard) {
    throw new BadRequestException(
      'A transação deve pertencer a exatamente uma conta bancária OU um cartão de crédito.',
    );
  }
}
