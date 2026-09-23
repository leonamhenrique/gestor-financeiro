// ============================================================
// invoice-payments.service.ts
// ============================================================
// Pagar, editar e desfazer pagamentos de fatura.
//
// Toda operação acontece numa transação de banco que:
//   1. trava o cartão (SELECT ... FOR UPDATE), para dois pagamentos
//      simultâneos não passarem juntos pela conferência de "quanto falta";
//   2. calcula a sequência de faturas com `montarFaturas` — a mesma regra
//      da leitura — e confere o valor contra o que ainda é pagável;
//   3. grava o pagamento e mexe no saldo da conta de origem;
//   4. reconsolida status/paidAt gravados das faturas do cartão.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FaturaCalculada, chaveDoMes, datasDoMes, dia, hojeNoFuso, montarFaturas } from './invoice-statement';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class InvoicePaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sequência de faturas do cartão, com pagamentos, rotativo e status. */
  async extrato(userId: string, creditCardId: string) {
    const cartao = await this.cartaoDoUsuario(this.prisma, userId, creditCardId);
    return montarFaturas(cartao, await this.faturasGravadas(this.prisma, creditCardId), hojeNoFuso());
  }

  async pagar(
    userId: string,
    creditCardId: string,
    mes: string,
    dados: { bankAccountId: string; amount: number; paidAt?: string },
  ) {
    if (!MES_VALIDO.test(mes)) throw new BadRequestException('Mês da fatura inválido. Use AAAA-MM.');
    const valor = this.validarValor(dados.amount);

    return this.prisma.$transaction(async (tx) => {
      const cartao = await this.travarCartao(tx, userId, creditCardId);
      await this.contaDoUsuario(tx, userId, dados.bankAccountId);

      const faturas = montarFaturas(cartao, await this.faturasGravadas(tx, creditCardId), hojeNoFuso());
      const alvo = faturas.find((f) => f.referenceMonth === mes);
      this.conferirPagavel(alvo, faturas, mes, valor, 0);

      // Fatura que só existe por causa do transporte ainda não tem linha no
      // banco: nasce agora, com as datas do ciclo do cartão.
      const invoiceId = alvo!.id ?? (await this.criarFatura(tx, creditCardId, mes, cartao)).id;

      const pagamento = await tx.invoicePayment.create({
        data: {
          invoiceId,
          bankAccountId: dados.bankAccountId,
          amount: valor,
          paidAt: this.dataDoPagamento(dados.paidAt),
        },
      });
      await tx.bankAccount.update({
        where: { id: dados.bankAccountId },
        data: { currentBalance: { decrement: valor } },
      });

      await this.consolidar(tx, creditCardId, cartao);
      return this.paraResposta(pagamento);
    });
  }

  async editar(
    userId: string,
    creditCardId: string,
    paymentId: string,
    dados: { bankAccountId?: string; amount?: number; paidAt?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cartao = await this.travarCartao(tx, userId, creditCardId);
      const atual = await this.pagamentoDoCartao(tx, creditCardId, paymentId);

      const novoValor = dados.amount === undefined ? Number(atual.amount) : this.validarValor(dados.amount);
      const novaConta = dados.bankAccountId ?? atual.bankAccountId;
      if (novaConta !== atual.bankAccountId) await this.contaDoUsuario(tx, userId, novaConta);

      // O pagamento sendo editado não conta contra ele mesmo: o teto é o que
      // falta pagar MAIS o valor que ele já tinha.
      const gravadas = await this.faturasGravadas(tx, creditCardId);
      const faturas = montarFaturas(cartao, gravadas, hojeNoFuso());
      const mes = chaveDoMes(atual.invoice.referenceMonth);
      this.conferirPagavel(faturas.find((f) => f.referenceMonth === mes), faturas, mes, novoValor, Number(atual.amount));
      this.conferirTransporteJaPago(cartao, gravadas, paymentId, novoValor);

      // Devolve à conta antiga e cobra da nova (podem ser a mesma).
      await tx.bankAccount.update({
        where: { id: atual.bankAccountId },
        data: { currentBalance: { increment: Number(atual.amount) } },
      });
      await tx.bankAccount.update({
        where: { id: novaConta },
        data: { currentBalance: { decrement: novoValor } },
      });

      const editado = await tx.invoicePayment.update({
        where: { id: paymentId },
        data: {
          amount: novoValor,
          bankAccountId: novaConta,
          paidAt: dados.paidAt ? this.dataDoPagamento(dados.paidAt) : atual.paidAt,
        },
      });
      await this.consolidar(tx, creditCardId, cartao);
      return this.paraResposta(editado);
    });
  }

  /** Desfaz o pagamento: o dinheiro volta para a conta, e a fatura volta a
   * dever esse valor (se já tinha vencido, isso pode desfazer um rotativo). */
  async desfazer(userId: string, creditCardId: string, paymentId: string) {
    await this.prisma.$transaction(async (tx) => {
      const cartao = await this.travarCartao(tx, userId, creditCardId);
      const atual = await this.pagamentoDoCartao(tx, creditCardId, paymentId);
      this.conferirTransporteJaPago(cartao, await this.faturasGravadas(tx, creditCardId), paymentId, 0);
      await tx.bankAccount.update({
        where: { id: atual.bankAccountId },
        data: { currentBalance: { increment: Number(atual.amount) } },
      });
      await tx.invoicePayment.delete({ where: { id: paymentId } });
      await this.consolidar(tx, creditCardId, cartao);
    });
  }

  // ----------------------------------------------------------
  // Consolidação: grava o que foi calculado, para consultas em massa
  // ----------------------------------------------------------
  // Além de status e paidAt, corrige fechamento/vencimento gravados que
  // divergem do ciclo do cartão — faturas criadas antes da correção de
  // billing-cycle.ts tinham vencimento no mês errado. É ajuste de dado pelo
  // próprio app, na próxima vez que o cartão é consolidado; não migração.
  async consolidar(tx: Prisma.TransactionClient, creditCardId: string, cartao: { closingDay: number; dueDay: number }) {
    const gravadas = await this.faturasGravadas(tx, creditCardId);
    const calculadas = montarFaturas(cartao, gravadas, hojeNoFuso());
    for (const f of calculadas) {
      if (!f.id) continue;
      const original = gravadas.find((g) => g.id === f.id)!;
      const quitadaEm = f.status === 'PAID'
        ? (original.payments.map((p) => p.paidAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date())
        : null;
      const status = f.status as InvoiceStatus;
      const datasErradas = dia(original.closingDate) !== f.closingDate || dia(original.dueDate) !== f.dueDate;
      if (datasErradas || original.status !== status || String(original.paidAt ?? '') !== String(quitadaEm ?? '')) {
        await tx.creditCardInvoice.update({
          where: { id: f.id },
          data: {
            status,
            paidAt: quitadaEm,
            closingDate: new Date(f.closingDate + 'T00:00:00.000Z'),
            dueDate: new Date(f.dueDate + 'T00:00:00.000Z'),
          },
        });
      }
    }
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  private conferirPagavel(
    alvo: FaturaCalculada | undefined,
    faturas: FaturaCalculada[],
    mes: string,
    valor: number,
    jaPagoPorEste: number,
  ) {
    if (!alvo) throw new NotFoundException('Não há fatura deste cartão nesse mês.');
    const edicao = jaPagoPorEste > 0;
    if (alvo.status === 'CARRIED' && !edicao) {
      const seguinte = faturas[faturas.findIndex((f) => f.referenceMonth === mes) + 1];
      throw new BadRequestException(
        `Esta fatura já venceu paga em parte e o restante foi transportado para a fatura de ${seguinte?.referenceMonth ?? 'o mês seguinte'}. Pague por lá.`,
      );
    }
    // Pagamento novo: até o que falta pagar. Edição: até o devido menos os
    // OUTROS pagamentos — vale também para corrigir um pagamento de fatura já
    // transportada (o rotativo é recalculado com o valor corrigido).
    const teto = edicao
      ? Math.round((alvo.due - (alvo.paid - jaPagoPorEste)) * 100)
      : Math.round(alvo.payable * 100);
    if (teto <= 0) throw new BadRequestException('Esta fatura não tem valor em aberto.');
    if (Math.round(valor * 100) > teto) {
      throw new BadRequestException(`O valor passa do que está em aberto nesta fatura (${brl(teto / 100)}).`);
    }
  }

  /** Desfazer um pagamento de fatura já vencida desfaz o rotativo que ele
   * gerou (sem pagamento não há transporte); aumentá-lo encolhe o transporte.
   * Se a fatura seguinte já pagou esse transporte, ela ficaria com mais pago
   * do que devido — e a de origem voltaria a cobrar: o usuário pagaria duas
   * vezes. Reduzir é seguro (o transporte cresce e a seguinte passa a dever a
   * diferença). Simula a mudança e recusa se alguma fatura passaria a ter
   * pagamento em excesso. */
  private conferirTransporteJaPago(
    cartao: { closingDay: number; dueDay: number },
    gravadas: Awaited<ReturnType<InvoicePaymentsService['faturasGravadas']>>,
    paymentId: string,
    novoValor: number, // 0 = remover
  ) {
    const hoje = hojeNoFuso();
    const antes = montarFaturas(cartao, gravadas, hoje);
    const simuladas = gravadas.map((f) => ({
      ...f,
      payments: f.payments.flatMap((p) =>
        p.id !== paymentId ? [p] : novoValor > 0 ? [{ ...p, amount: new Prisma.Decimal(novoValor) }] : [],
      ),
    }));
    const depois = montarFaturas(cartao, simuladas, hoje);
    const excesso = (f?: FaturaCalculada) => (f ? Math.round((f.paid - f.due) * 100) : 0);
    for (const f of depois) {
      const anterior = antes.find((a) => a.referenceMonth === f.referenceMonth);
      if (f.paid > 0 && excesso(f) > 0 && excesso(f) > excesso(anterior)) {
        throw new BadRequestException(
          `O restante desta fatura foi transportado para a fatura de ${f.referenceMonth} e já foi pago lá. ` +
            `Desfaça primeiro o pagamento de ${f.referenceMonth}.`,
        );
      }
    }
  }

  private validarValor(valor: number) {
    const v = Math.round(Number(valor) * 100) / 100;
    if (!Number.isFinite(v) || v <= 0) throw new BadRequestException('O valor do pagamento deve ser maior que zero.');
    return v;
  }

  private dataDoPagamento(iso?: string) {
    // Coluna @db.Date: meia-noite UTC do dia informado (ou de hoje no fuso do app).
    const diaStr = (iso ?? hojeNoFuso()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(diaStr)) throw new BadRequestException('Data do pagamento inválida.');
    return new Date(diaStr + 'T00:00:00.000Z');
  }

  private async travarCartao(tx: Prisma.TransactionClient, userId: string, creditCardId: string) {
    const cartao = await this.cartaoDoUsuario(tx, userId, creditCardId);
    await tx.$queryRaw`SELECT id FROM credit_cards WHERE id = ${creditCardId} FOR UPDATE`;
    return cartao;
  }

  private async cartaoDoUsuario(db: Prisma.TransactionClient | PrismaService, userId: string, creditCardId: string) {
    const cartao = await db.creditCard.findFirst({ where: { id: creditCardId, userId } });
    if (!cartao) throw new NotFoundException('Cartão de crédito não encontrado');
    return cartao;
  }

  private async contaDoUsuario(tx: Prisma.TransactionClient, userId: string, bankAccountId: string) {
    const conta = await tx.bankAccount.findFirst({ where: { id: bankAccountId, userId } });
    if (!conta) throw new NotFoundException('Conta bancária não encontrada');
    if (!conta.isActive) throw new BadRequestException('Esta conta está arquivada. Escolha outra para pagar.');
    return conta;
  }

  private async pagamentoDoCartao(tx: Prisma.TransactionClient, creditCardId: string, paymentId: string) {
    const pagamento = await tx.invoicePayment.findFirst({
      where: { id: paymentId, invoice: { creditCardId } },
      include: { invoice: true },
    });
    if (!pagamento) throw new NotFoundException('Pagamento não encontrado');
    return pagamento;
  }

  private faturasGravadas(db: Prisma.TransactionClient | PrismaService, creditCardId: string) {
    return db.creditCardInvoice.findMany({
      where: { creditCardId },
      include: { payments: true },
      orderBy: { referenceMonth: 'asc' },
    });
  }

  private criarFatura(tx: Prisma.TransactionClient, creditCardId: string, mes: string, cartao: { closingDay: number; dueDay: number }) {
    const d = datasDoMes(mes, cartao.closingDay, cartao.dueDay);
    return tx.creditCardInvoice.create({
      data: {
        creditCardId,
        referenceMonth: d.referenceMonth,
        closingDate: d.closingDate,
        dueDate: d.dueDate,
        totalAmount: 0,
        status: InvoiceStatus.OPEN,
      },
    });
  }

  private paraResposta(p: { id: string; invoiceId: string; bankAccountId: string; amount: unknown; paidAt: Date }) {
    return {
      id: p.id,
      invoiceId: p.invoiceId,
      bankAccountId: p.bankAccountId,
      amount: Number(p.amount),
      paidAt: p.paidAt.toISOString().slice(0, 10),
    };
  }
}
