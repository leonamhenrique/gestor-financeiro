// ============================================================
// transaction.utils.ts
// ============================================================
// Funções puras (sem dependência de banco) usadas pelo
// TransactionsService. Extraídas para arquivo separado para que
// possam ser testadas isoladamente, sem precisar instanciar o
// service inteiro nem mockar o Prisma.
// ============================================================

import { BadRequestException } from '@nestjs/common';
import { cicloDaData, datasDoMesChave } from '../credit-cards/billing-cycle';
import { chaveDoMes } from '../reports/report.utils';

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

/**
 * Em que mês um lançamento conta para RELATÓRIO.
 *
 * Compra de cartão conta no mês em que a FATURA VENCE, não no da compra: é
 * quando o dinheiro sai da conta. Lançamento de conta conta na própria data.
 *
 * Esta é a ÚNICA função do backend que decide isso, e é de propósito. Quando
 * duas telas respondem à mesma pergunta por caminhos diferentes, elas acabam
 * dando dois números para o mesmo mês — já aconteceu neste app, com o total
 * contando pela fatura e o mapa de calor pela data da compra. O espelho dela
 * no app web é `dataDeRelatorio`, e os dois têm de concordar.
 *
 * `datasDoMesChave` entra quando a compra foi atribuída a mão a outra fatura:
 * aí vale a fatura escolhida, não a que a data indicaria.
 */
export function mesDeCaixa(
  t: { transactionDate: Date; creditCardId: string | null; invoiceMonthOverride?: Date | null },
  cartoes: Map<string, { closingDay: number; dueDay: number }>,
): string {
  if (!t.creditCardId) return chaveDoMes(t.transactionDate);
  const card = cartoes.get(t.creditCardId);
  if (!card) return chaveDoMes(t.transactionDate); // cartão apagado: cai no próprio mês
  const ciclo = t.invoiceMonthOverride
    ? datasDoMesChave(chaveDoMes(t.invoiceMonthOverride), card.closingDay, card.dueDay)
    : resolveInvoicePeriod(t.transactionDate, card.closingDay, card.dueDay);
  return chaveDoMes(ciclo.dueDate);
}
