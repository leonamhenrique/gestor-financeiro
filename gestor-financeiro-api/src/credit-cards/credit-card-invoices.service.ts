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
//
// A única escrita que vive aqui é a VIRADA: a fatura fechou antes do dia do
// calendário, porque o usuário virou no banco. Ela não é pagamento nem
// lançamento — é um fato sobre o ciclo —, e muda só duas respostas: se a
// fatura ainda está aberta e em qual fatura uma compra nova cai.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cicloDaDataVirada, datasDoMesChave } from './billing-cycle';
import { chaveDoMes, faturaAtual, hojeNoFuso, montarFaturas, viradasDe } from './invoice-statement';

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

  /**
   * Vira a fatura: ela fecha HOJE, antes do dia do calendário, e as compras
   * de hoje em diante entram na seguinte. É o "Virar fatura" do Itaú e do Iti.
   *
   * O app não vira nada no banco — quem virou foi o usuário, lá. Aqui ele
   * registra, para o app parar de mandar compra nova para uma fatura que já
   * fechou de verdade.
   *
   * Só a fatura do CICLO DE HOJE pode ser virada, e é o que também permite
   * virar duas vezes no mesmo mês: virada a de dezembro, o ciclo de hoje passa
   * a ser a de janeiro, e ela entra na vez dela. Fatura futura não se vira
   * (não é ela que recebe a compra de hoje), e fatura já fechada, paga,
   * atrasada ou transportada não se vira (já fechou).
   */
  async virar(userId: string, creditCardId: string, mes: string) {
    const cartao = await this.cartao(userId, creditCardId);
    const hoje = hojeNoFuso();
    const faturas = await this.calcular(userId, creditCardId);

    const doCiclo = chaveDoMes(
      cicloDaDataVirada(
        new Date(hoje + 'T00:00:00.000Z'),
        cartao.closingDay,
        cartao.dueDay,
        viradasDe(faturas),
      ).referenceMonth,
    );
    if (mes !== doCiclo) {
      throw new BadRequestException(`Só dá para virar a fatura que está aberta agora (${doCiclo}).`);
    }

    const atual = faturas.find((f) => f.referenceMonth === mes);
    if (atual && atual.status !== 'OPEN') {
      throw new BadRequestException('Essa fatura não está mais aberta.');
    }

    // A fatura pode ainda não existir no banco: virar um mês sem compra
    // nenhuma é legítimo, e é o caso de quem vira para começar o mês limpo.
    const datas = datasDoMesChave(mes, cartao.closingDay, cartao.dueDay);
    await this.prisma.creditCardInvoice.upsert({
      where: { creditCardId_referenceMonth: { creditCardId, referenceMonth: datas.referenceMonth } },
      create: {
        creditCardId,
        referenceMonth: datas.referenceMonth,
        closingDate: datas.closingDate,
        dueDate: datas.dueDate,
        totalAmount: 0,
        status: InvoiceStatus.CLOSED,
        earlyClosedAt: new Date(hoje + 'T00:00:00.000Z'),
      },
      update: { earlyClosedAt: new Date(hoje + 'T00:00:00.000Z'), status: InvoiceStatus.CLOSED },
    });

    return this.findByMonth(userId, creditCardId, mes);
  }

  /**
   * Desfaz a virada. A fatura volta a ficar aberta até o dia do calendário.
   *
   * Duas travas. A primeira: só a virada MAIS RECENTE — desfazer a de dezembro
   * tendo virado janeiro depois deixaria duas faturas disputando a compra de
   * hoje. A segunda: fatura com pagamento registrado não volta atrás; dali em
   * diante a virada é história, pela mesma razão que o app não deixa remover
   * lançamento de fatura paga.
   *
   * O que já foi lançado NÃO se move: a fatura de cada compra fica gravada no
   * lançamento (`invoiceMonthOverride`), e não recalculada. Desfazer muda só o
   * que vem depois — era o contrário disso que faria compras trocarem de mês
   * caladas.
   */
  async desfazerVirada(userId: string, creditCardId: string, mes: string) {
    await this.cartao(userId, creditCardId);
    const faturas = await this.calcular(userId, creditCardId);
    const alvo = faturas.find((f) => f.referenceMonth === mes);
    if (!alvo?.earlyClosedAt) throw new NotFoundException('Essa fatura não foi virada.');

    const ultima = faturas.filter((f) => f.earlyClosedAt).map((f) => f.referenceMonth).sort().pop();
    if (mes !== ultima) {
      throw new BadRequestException(`Desfaça primeiro a virada mais recente (${ultima}).`);
    }
    if (alvo.payments.length) {
      throw new BadRequestException('Essa fatura já tem pagamento registrado: a virada não volta atrás.');
    }

    await this.prisma.creditCardInvoice.update({
      where: { id: alvo.id! },
      // O status volta ao que o calendário disser na próxima leitura; aqui só
      // o campo consolidado, que o cron realinha de qualquer forma.
      data: { earlyClosedAt: null, status: InvoiceStatus.OPEN },
    });

    return this.findByMonth(userId, creditCardId, mes);
  }

  private async cartao(userId: string, creditCardId: string) {
    const cartao = await this.prisma.creditCard.findFirst({ where: { id: creditCardId, userId } });
    if (!cartao) throw new NotFoundException('Cartão de crédito não encontrado');
    return cartao;
  }

  private async calcular(userId: string, creditCardId: string) {
    const cartao = await this.cartao(userId, creditCardId);
    const gravadas = await this.prisma.creditCardInvoice.findMany({
      where: { creditCardId },
      include: { payments: true },
      orderBy: { referenceMonth: 'asc' },
    });
    return montarFaturas(cartao, gravadas, hojeNoFuso());
  }
}
