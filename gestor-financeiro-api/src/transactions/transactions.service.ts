// ============================================================
// transactions.service.ts
// ============================================================
// Responsabilidade única deste service: garantir que TODA escrita
// de transação (criar / editar / excluir) atualize o saldo da conta
// bancária ou da fatura do cartão de forma ATÔMICA.
//
// Regra de ouro: nunca gravar uma Transaction sem, na MESMA
// transação de banco (Prisma $transaction), atualizar o saldo
// correspondente. Se uma das duas escritas falhar, as duas devem
// ser revertidas — senão o saldo dessincroniza do histórico real.
//
// Previsto × confirmado: só lançamento CONFIRMADO tem efeito no saldo e
// na fatura. Um previsto é gravado sem mexer em nada; confirmar aplica o
// efeito, "desconfirmar" desfaz. Toda operação segue o mesmo desenho —
// desfaz o efeito da versão antiga SE ela era confirmada, aplica o da nova
// SE ela é confirmada —, o que cobre também editar um previsto (nenhum
// efeito) e confirmar e editar o valor ao mesmo tempo.
//
// Fatura escolhida (`invoiceMonthOverride`): compra no cartão pode entrar
// numa fatura diferente da que a data indicaria (escolha no lançamento ou
// antecipação de parcela). Todo cálculo de "em qual fatura cai" passa por
// `cicloDoLancamento`, que respeita essa escolha.
//
// Séries: repetição fixa ou parcelamento. Cada ocorrência é um lançamento
// normal; a série só as agrupa. Parcelas que caem em fatura paga ou
// transportada ficam protegidas: não saem numa exclusão em massa nem são
// antecipadas — o valor pago daquela fatura ficaria sem lastro.
// ============================================================

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  TransactionType,
  TransactionSource,
  InvoiceStatus,
  SeriesKind,
  SeriesFrequency,
} from '@prisma/client';
import { resolveInvoicePeriod, validateAmount, validateAccountXorCard } from './transaction.utils';
import { datasDoMesChave } from '../credit-cards/billing-cycle';
import { FaturaCalculada, faturaAtual, hojeNoFuso, montarFaturas } from '../credit-cards/invoice-statement';
import { MAX_OCORRENCIAS, MIN_OCORRENCIAS, dataDaOcorrencia, dataParaMes, mesParaData } from './series.utils';

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CreateTransactionInput {
  userId: string;
  categoryId: string;
  type: TransactionType;
  amount: number; // sempre positivo; o sinal é resolvido pelo `type`
  description?: string;
  transactionDate: Date;
  bankAccountId?: string; // XOR com creditCardId
  creditCardId?: string;
  isRecurring?: boolean;
  // Dinheiro que ENTRA abatendo uma despesa, em vez de ser receita (ver o
  // comentário de  no schema). Só faz sentido com type INCOME.
  isRefund?: boolean;
  isConfirmed?: boolean; // padrão: true (dinheiro que já entrou ou saiu)
  invoiceMonth?: string; // 'AAAA-MM', só para cartão
  source?: TransactionSource;
  clientKey?: string; // idempotência: ver `create`
}

interface RepeatInput {
  kind: SeriesKind;
  frequency: SeriesFrequency;
  count: number;
}

interface UpdateTransactionInput {
  categoryId?: string;
  // Trocar o sinal e o destino e permitido: o update estorna o efeito antigo
  // e aplica o novo, entao mudar de conta, de cartao ou de tipo e so uma
  // versao diferente do mesmo lancamento.
  type?: TransactionType;
  bankAccountId?: string | null;
  creditCardId?: string | null;
  // Acompanha o tipo quando um acerto troca de sentido: "recebi" é reembolso
  // (abate despesa), "paguei" é despesa comum. Sem isto, inverter a direção
  // deixaria o lançamento com o sinal novo e a marca velha.
  isRefund?: boolean;
  amount?: number;
  description?: string;
  transactionDate?: Date;
  isConfirmed?: boolean;
  invoiceMonth?: string | null; // null volta para a fatura da própria data
}

export type EscopoDaSerie = 'ONLY' | 'FOLLOWING' | 'ALL';

// O que muda saldo ou fatura numa versão de um lançamento.
interface Efeito {
  bankAccountId: string | null;
  creditCardId: string | null;
  type: TransactionType;
  amount: number;
  transactionDate: Date;
  invoiceMonthOverride: Date | null;
  isConfirmed: boolean;
}

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------
  /** Cria um lançamento.
   *
   * Com `clientKey`, criar é **idempotente**: mandar a mesma chave de novo
   * devolve o lançamento que já existe em vez de criar outro. Isso não é
   * luxo — a fila offline só tira um item dela depois que a resposta chega,
   * então um servidor que grava e perde a resposta no caminho recebe o mesmo
   * lançamento de novo, e sem a chave o dinheiro entrava duas vezes.
   *
   * Duas defesas, porque uma não basta: a consulta antes de criar resolve o
   * reenvio normal (o comum), e o índice único resolve a corrida de dois
   * envios ao mesmo tempo, em que os dois consultariam antes de qualquer um
   * gravar. No segundo caso o perdedor lê o vencedor e devolve ele. */
  async create(input: CreateTransactionInput) {
    try {
      return await this.prisma.$transaction((tx) => this.criarEm(tx, input));
    } catch (e) {
      const existente = await this.perdeuACorrida(e, input.userId, input.clientKey);
      if (existente) return existente;
      throw e;
    }
  }

  /**
   * O miolo do `create`, numa transação de banco JÁ ABERTA.
   *
   * Existe público para quem precisa criar um lançamento junto com outra
   * coisa, atomicamente — hoje o módulo de despesas compartilhadas, que grava
   * o lançamento e a divisão dele de uma vez. Chamar `create()` de lá abriria
   * uma segunda transação dentro da primeira, e uma falha na divisão deixaria
   * o lançamento gravado sozinho, já tendo mexido no saldo.
   *
   * Quem chama é responsável por tratar a corrida de `clientKey` (P2002) como
   * `create` faz — aqui dentro ela não tem como ser resolvida.
   */
  async criarEm(tx: Prisma.TransactionClient, input: CreateTransactionInput) {
    const override = this.validarEntrada(input);

    const repetido = await this.jaGravado(tx, input.userId, input.clientKey);
    if (repetido) return repetido;

    await this.conferirDestino(tx, input.userId, input.bankAccountId, input.creditCardId);
    await this.conferirCategoria(tx, input.userId, input.categoryId);

    // 1. Cria a transação
    const transaction = await tx.transaction.create({
      data: { ...this.dadosDoLancamento(input), invoiceMonthOverride: override },
    });

    // 2. Atualiza o saldo (conta) ou a fatura (cartão), dentro da mesma tx
    //    — só se o lançamento nasceu confirmado.
    await this.applyEffect(tx, this.efeitoDe(transaction));

    return transaction;
  }

  /** O lançamento desta chave, se já estiver gravado. */
  private async jaGravado(tx: Prisma.TransactionClient, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    return tx.transaction.findFirst({ where: { userId, clientKey } });
  }

  /** Violação do índice único = alguém gravou esta chave enquanto eu tentava.
   * Não é erro do usuário: é o mesmo lançamento, e a resposta certa é ele. */
  private async perdeuACorrida(e: unknown, userId: string, clientKey?: string) {
    if (!clientKey) return null;
    const codigo = (e as { code?: string })?.code;
    if (codigo !== 'P2002') return null;
    return this.prisma.transaction.findFirst({ where: { userId, clientKey } });
  }

  /** Cria uma série (repetição fixa ou parcelamento) com `count` ocorrências.
   * A fatura escolhida vale só para a PRIMEIRA: as seguintes caem na fatura
   * da própria data.
   *
   * Já o "já confirmado" depende do que a série é:
   *
   *   parcelamento no cartão  TODAS nascem confirmadas. A compra aconteceu
   *                           uma vez só; as 12 parcelas são a mesma compra
   *                           repartida, e cada fatura futura já as espera.
   *                           Deixar as seguintes previstas era pedir para
   *                           confirmar, mês a mês, uma dívida que já existe.
   *   qualquer outra série    só a primeira. Aluguel todo mês, assinatura
   *                           que renova: as próximas ainda não aconteceram,
   *                           e previsto é o estado honesto.
   *
   * Desmarcar "já confirmado" vale para todas nos dois casos: quem planeja
   * uma compra parcelada para a semana que vem não quer nada confirmado. */
  async createSeries(input: CreateTransactionInput, repeat: RepeatInput) {
    const override = this.validarEntrada(input);
    if (!Number.isInteger(repeat.count) || repeat.count < MIN_OCORRENCIAS || repeat.count > MAX_OCORRENCIAS) {
      throw new BadRequestException(`Informe de ${MIN_OCORRENCIAS} a ${MAX_OCORRENCIAS} ocorrências.`);
    }

    // Uma chave por ocorrência: a série inteira nasce de um pedido só, mas
    // são N linhas, e a mesma chave nas N colidiria consigo mesma. O sufixo
    // mantém cada uma única e o reenvio reconhecível pela primeira.
    const chaveDa = (i: number) => (input.clientKey ? `${input.clientKey}#${i}` : undefined);

    try {
      return await this.criarSerie(input, repeat, override, chaveDa);
    } catch (e) {
      const primeira = await this.perdeuACorrida(e, input.userId, chaveDa(0));
      if (primeira?.seriesId) return this.serieGravada(input.userId, primeira.seriesId);
      throw e;
    }
  }

  /** A série já gravada desta chave, do jeito que `createSeries` devolve. */
  private async serieGravada(userId: string, seriesId: string) {
    const [series, transactions] = await Promise.all([
      this.prisma.transactionSeries.findFirst({ where: { id: seriesId, userId } }),
      this.prisma.transaction.findMany({ where: { userId, seriesId }, orderBy: { seriesIndex: 'asc' } }),
    ]);
    return { series, transactions };
  }

  private async criarSerie(
    input: CreateTransactionInput,
    repeat: RepeatInput,
    override: Date | null | undefined,
    chaveDa: (i: number) => string | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Reenvio da série inteira: a primeira ocorrência responde por todas.
      const repetida = await this.jaGravado(tx, input.userId, chaveDa(0));
      if (repetida?.seriesId) {
        const [series, transactions] = await Promise.all([
          tx.transactionSeries.findFirst({ where: { id: repetida.seriesId, userId: input.userId } }),
          tx.transaction.findMany({
            where: { userId: input.userId, seriesId: repetida.seriesId },
            orderBy: { seriesIndex: 'asc' },
          }),
        ]);
        return { series, transactions };
      }

      await this.conferirDestino(tx, input.userId, input.bankAccountId, input.creditCardId);
      await this.conferirCategoria(tx, input.userId, input.categoryId);
      const series = await tx.transactionSeries.create({
        data: { userId: input.userId, kind: repeat.kind, frequency: repeat.frequency, count: repeat.count },
      });

      // A compra parcelada no cartão já aconteceu inteira — ver o cabeçalho.
      const parceladoNoCartao =
        repeat.kind === SeriesKind.INSTALLMENT && !!input.creditCardId;
      const confirmadaEscolhida = input.isConfirmed ?? true;

      const transactions = [];
      for (let i = 0; i < repeat.count; i++) {
        const primeira = i === 0;
        const t = await tx.transaction.create({
          data: {
            ...this.dadosDoLancamento(input),
            transactionDate: dataDaOcorrencia(input.transactionDate, repeat.frequency, i),
            isConfirmed: primeira || parceladoNoCartao ? confirmadaEscolhida : false,
            invoiceMonthOverride: primeira ? override : null,
            isRecurring: true,
            seriesId: series.id,
            seriesIndex: i,
            clientKey: chaveDa(i) ?? null,
          },
        });
        await this.applyEffect(tx, this.efeitoDe(t));
        transactions.push(t);
      }
      return { series, transactions };
    });
  }

  // ----------------------------------------------------------
  // READ (listagem com filtro por data — requisito central do MVP)
  // ----------------------------------------------------------
  async findAllByUser(
    userId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      categoryId?: string;
      bankAccountId?: string;
      creditCardId?: string;
      type?: TransactionType;
      status?: 'CONFIRMED' | 'PLANNED';
      seriesId?: string;
      includeHidden?: boolean;
    },
  ) {
    // Conta oculta fica fora da lista, como no app — a não ser que peçam
    // (includeHidden) ou filtrem justamente por ela.
    const semOcultas = !filters.includeHidden && !filters.bankAccountId;
    return this.prisma.transaction.findMany({
      where: {
        userId,
        ...(semOcultas ? { OR: [{ bankAccountId: null }, { bankAccount: { isHidden: false } }] } : {}),
        categoryId: filters.categoryId,
        bankAccountId: filters.bankAccountId,
        creditCardId: filters.creditCardId,
        type: filters.type,
        seriesId: filters.seriesId,
        isConfirmed: filters.status ? filters.status === 'CONFIRMED' : undefined,
        transactionDate: {
          gte: filters.startDate ? new Date(filters.startDate) : undefined,
          lte: filters.endDate ? new Date(filters.endDate) : undefined,
        },
      },
      include: { category: true, bankAccount: true, creditCard: true, series: true },
      orderBy: { transactionDate: 'desc' },
    });
  }

  async findOneByUser(userId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId },
      include: { category: true, bankAccount: true, creditCard: true, series: true },
    });
    if (!transaction) throw new NotFoundException('Transação não encontrada');
    return transaction;
  }

  // ----------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------
  // Estratégia mais simples e segura: estornar o efeito da transação
  // antiga por completo, depois aplicar o efeito da nova versão.
  // Evita ter que calcular "diffs" propensos a erro (ex: usuário troca
  // valor E também troca de conta/cartão ao mesmo tempo).
  //
  // `requestingUserId` garante que ninguém edite transação de outro usuário.
  // É OBRIGATÓRIO de propósito: opcional, quem esquecesse de passar desligava
  // a verificação em silêncio, e um `undefined` não faz barulho nenhum. Assim
  // o compilador recusa a chamada antes de ela existir.
  async update(transactionId: string, input: UpdateTransactionInput, requestingUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Mudar o valor de um gasto DIVIDIDO mudaria em silêncio o que a outra
      // pessoa deve — as partes gravadas continuariam as antigas, e a minha
      // parte (que é o que sobra) absorveria sozinha a diferença: um gasto de
      // 200 dividido 100/100 virando 300 deixaria o amigo com 100 e eu com
      // 200. Pior: ele já pode ter visto 100 na página compartilhada.
      //
      // A trava fica AQUI, e não em `atualizarEm`: quem edita pelo módulo das
      // compartilhadas refaz o rateio na mesma transação, e para esse caminho
      // a trava não faz sentido — ele é justamente a saída que esta mensagem
      // manda procurar.
      if (input.amount !== undefined) {
        const atual = await tx.transaction.findUnique({
          where: { id: transactionId },
          select: { amount: true },
        });
        if (atual && input.amount !== Number(atual.amount)) {
          const dividido = await tx.sharedExpense.findUnique({
            where: { transactionId },
            select: { id: true },
          });
          if (dividido) {
            throw new BadRequestException(
              'Este gasto está dividido com outra pessoa. Edite pela tela de Compartilhadas: lá o valor e o rateio mudam juntos.',
            );
          }
        }
      }

      return this.atualizarEm(tx, transactionId, input, requestingUserId);
    });
  }

  /**
   * O miolo do `update`, numa transação de banco JÁ ABERTA e SEM a trava do
   * gasto dividido.
   *
   * Existe público pelo mesmo motivo de `criarEm`: o módulo das despesas
   * compartilhadas precisa mudar o valor do lançamento e refazer as partes
   * de uma vez só. Chamar `update()` de lá abriria transação dentro de
   * transação e esbarraria na trava que o próprio módulo é a resposta.
   */
  async atualizarEm(
    tx: Prisma.TransactionClient,
    transactionId: string,
    input: UpdateTransactionInput,
    requestingUserId: string,
  ) {
    {
      const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!existing) throw new NotFoundException('Transação não encontrada');
      // Mesma mensagem de "não encontrada" para dono errado: dizer "proibido"
      // confirmaria que o lançamento existe.
      if (existing.userId !== requestingUserId) {
        throw new NotFoundException('Transação não encontrada');
      }
      // Só confere quando TROCA de categoria: manter uma que depois ganhou
      // subcategorias continua valendo.
      if (input.categoryId && input.categoryId !== existing.categoryId) {
        await this.conferirCategoria(tx, existing.userId, input.categoryId);
      }

      // ---- destino e tipo ----
      // Trocar de conta, de cartão ou o sinal é só reverter o efeito antigo e
      // aplicar o novo — que é exatamente o que este método já faz. O que
      // muda é QUAL efeito se desfaz: o da versão antiga, com a conta e o
      // sinal dela. Por isso `reverseEffect` lê `existing` e `applyEffect` lê
      // o registro já atualizado.
      const trocouDestino =
        (input.bankAccountId !== undefined && (input.bankAccountId || null) !== existing.bankAccountId) ||
        (input.creditCardId !== undefined && (input.creditCardId || null) !== existing.creditCardId);
      const novaConta =
        input.bankAccountId === undefined ? existing.bankAccountId : (input.bankAccountId || null);
      const novoCartao =
        input.creditCardId === undefined ? existing.creditCardId : (input.creditCardId || null);
      const novoTipo = input.type ?? existing.type;

      if (trocouDestino || novoTipo !== existing.type) {
        validateAccountXorCard(novaConta ?? undefined, novoCartao ?? undefined);
        await this.conferirDestino(tx, existing.userId, novaConta ?? undefined, novoCartao ?? undefined);

        // Sair de uma fatura PAGA ou TRANSPORTADA mexe no total de uma fatura
        // que já foi fechada — o mesmo estrago que excluir, que o app já
        // impede. Onde ele impede remover, precisa impedir mover para fora.
        const presos = await this.protegidos(tx, [existing]);
        if (presos.has(existing.id)) {
          throw new BadRequestException(
            'Esta compra está numa fatura já paga ou transportada. Mudar o destino dela mudaria o total de uma fatura fechada.',
          );
        }

        // Um gasto dividido vira receita = uma receita dividida, que não
        // existe: só despesa se reparte. Desfaça a divisão antes.
        if (novoTipo !== existing.type) {
          const dividido = await tx.sharedExpense.findUnique({
            where: { transactionId },
            select: { id: true },
          });
          if (dividido) {
            throw new BadRequestException(
              'Este gasto está dividido com outra pessoa. Receita não se divide — desfaça a divisão antes de mudar o tipo.',
            );
          }
        }
      }

      let newOverride = existing.invoiceMonthOverride ?? null;
      if (input.invoiceMonth !== undefined) {
        if (input.invoiceMonth !== null && !novoCartao) {
          throw new BadRequestException('Só compra no cartão tem fatura para escolher.');
        }
        newOverride = input.invoiceMonth === null ? null : this.mesDaFaturaInformado(input.invoiceMonth);
      }
      // Saiu do cartão: a fatura escolhida deixa de existir junto. Mantê-la
      // deixaria um lançamento de conta apontando para uma fatura — lixo que
      // só aparece quando alguém devolve o lançamento para um cartão.
      if (!novoCartao) newOverride = null;

      // 1. Reverte o efeito da transação atual (se ela era confirmada)
      await this.reverseEffect(tx, this.efeitoDe(existing));

      // 2. Monta os novos valores (mantém o que não foi alterado)
      const newAmount = input.amount ?? Number(existing.amount);
      const newDate = input.transactionDate ?? existing.transactionDate;
      const newConfirmed = input.isConfirmed ?? existing.isConfirmed;
      validateAmount(newAmount);

      // 3. Atualiza o registro da transação
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          categoryId: input.categoryId ?? existing.categoryId,
          type: novoTipo,
          // Reembolso so existe em entrada: uma despesa marcada assim seria
          // uma despesa que abate despesa, e nao existe isso.
          isRefund: (input.isRefund ?? existing.isRefund) && novoTipo === TransactionType.INCOME,
          bankAccountId: novaConta,
          creditCardId: novoCartao,
          amount: newAmount,
          description: input.description ?? existing.description,
          transactionDate: newDate,
          isConfirmed: newConfirmed,
          invoiceMonthOverride: newOverride,
        },
      });

      // 4. Reaplica o efeito com os novos valores (se a nova versão é confirmada)
      await this.applyEffect(tx, this.efeitoDe(updated));

      return updated;
    }
  }

  // ----------------------------------------------------------
  // DELETE
  // ----------------------------------------------------------
  async delete(transactionId: string, requestingUserId: string) {
    return this.prisma.$transaction((tx) => this.apagarEm(tx, transactionId, requestingUserId));
  }

  /** O miolo do `delete`, numa transação de banco JÁ ABERTA. Existe pelo
   * mesmo motivo de `criarEm` e `atualizarEm`: quem apaga um lançamento junto
   * com outra coisa precisa de tudo na mesma transação. */
  async apagarEm(tx: Prisma.TransactionClient, transactionId: string, requestingUserId: string) {
    const existing = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!existing) throw new NotFoundException('Transação não encontrada');
    if (existing.userId !== requestingUserId) {
      throw new NotFoundException('Transação não encontrada');
    }

    await this.reverseEffect(tx, this.efeitoDe(existing));

    await tx.transaction.delete({ where: { id: transactionId } });

    return { success: true };
  }

  /** Exclusão a partir de uma ocorrência de série: só ela (ONLY), ela e as
   * seguintes (FOLLOWING) ou a série inteira (ALL). Parcelas em fatura paga
   * ou transportada ficam — e a resposta diz quantas. Se nenhuma puder sair,
   * nada é excluído e o motivo vem no erro. */
  async deleteSeries(userId: string, transactionId: string, scope: EscopoDaSerie) {
    return this.prisma.$transaction(async (tx) => {
      const alvo = await tx.transaction.findFirst({ where: { id: transactionId, userId } });
      if (!alvo) throw new NotFoundException('Transação não encontrada');
      if (!alvo.seriesId) throw new BadRequestException('Este lançamento não faz parte de uma série.');

      const candidatos =
        scope === 'ONLY'
          ? [alvo]
          : await tx.transaction.findMany({
              where: {
                seriesId: alvo.seriesId,
                userId,
                ...(scope === 'FOLLOWING' ? { seriesIndex: { gte: alvo.seriesIndex ?? 0 } } : {}),
              },
            });

      const protegidos = await this.protegidos(tx, candidatos);
      const permitidos = candidatos.filter((t) => !protegidos.has(t.id));
      if (!permitidos.length) {
        throw new BadRequestException(
          (candidatos.length === 1 ? 'Esse lançamento pertence' : 'Todos esses lançamentos pertencem') +
            ' a uma fatura já paga. Desfaça o pagamento da fatura antes de excluir.',
        );
      }

      for (const t of permitidos) {
        await this.reverseEffect(tx, this.efeitoDe(t));
        await tx.transaction.delete({ where: { id: t.id } });
      }
      return { deleted: permitidos.length, protectedCount: candidatos.length - permitidos.length };
    });
  }

  /** Antecipa parcelas de uma série no cartão para a fatura `destino`.
   *
   * Antecipar não muda a data da compra — é fato histórico —, só a fatura em
   * que ela entra (`invoiceMonthOverride`). Entram as primeiras `quantity`
   * parcelas que hoje caem DEPOIS do destino e cuja fatura não foi paga nem
   * transportada. O destino não pode ser anterior à fatura atual, nem uma
   * fatura paga/transportada. `confirm` lança as antecipadas como
   * confirmadas (padrão no app: "Lançar como confirmadas nessa fatura"). */
  async anticipate(
    userId: string,
    seriesId: string,
    dados: { destinationMonth: string; quantity: number; confirm?: boolean },
  ) {
    if (!MES_VALIDO.test(dados.destinationMonth)) throw new BadRequestException('Mês da fatura inválido. Use AAAA-MM.');
    if (!Number.isInteger(dados.quantity) || dados.quantity < 1) {
      throw new BadRequestException('Informe quantas parcelas antecipar (1 ou mais).');
    }

    return this.prisma.$transaction(async (tx) => {
      const parcelas = await tx.transaction.findMany({
        where: { seriesId, userId, creditCardId: { not: null } },
        orderBy: { seriesIndex: 'asc' },
      });
      if (!parcelas.length) throw new NotFoundException('Série de cartão não encontrada');
      const cardId = parcelas[0].creditCardId!;
      const card = await tx.creditCard.findUnique({ where: { id: cardId } });
      if (!card) throw new NotFoundException('Cartão de crédito não encontrado');
      await tx.$queryRaw`SELECT id FROM credit_cards WHERE id = ${cardId} FOR UPDATE`;

      const faturas = await this.faturasDoCartao(tx, card);
      const destino = dados.destinationMonth;
      const statusDestino = faturas.get(destino)?.status;
      if (statusDestino === 'PAID' || statusDestino === 'CARRIED') {
        throw new BadRequestException('Não dá para antecipar para uma fatura já paga ou transportada.');
      }
      // A mais antiga com algo a pagar; se ela é futura (a de agora já foi
      // paga), vale o ciclo de hoje.
      const doCiclo = this.mesDoCicloDeHoje(card);
      const aPagar = faturaAtual([...faturas.values()])?.referenceMonth;
      const atual = aPagar && aPagar < doCiclo ? aPagar : doCiclo;
      if (destino < atual) {
        throw new BadRequestException(`O destino não pode ser anterior à fatura atual (${atual}).`);
      }

      const antecipaveis = parcelas.filter((p) => {
        const mes = this.mesDaFatura(p, card);
        const s = faturas.get(mes)?.status;
        return mes > destino && s !== 'PAID' && s !== 'CARRIED';
      });
      if (!antecipaveis.length) {
        throw new BadRequestException('Nenhuma parcela desta série cai depois dessa fatura para ser antecipada.');
      }

      const escolhidas = antecipaveis.slice(0, dados.quantity);
      for (const p of escolhidas) {
        await this.reverseEffect(tx, this.efeitoDe(p));
        const movida = await tx.transaction.update({
          where: { id: p.id },
          data: {
            invoiceMonthOverride: mesParaData(destino),
            isConfirmed: dados.confirm ? true : p.isConfirmed,
          },
        });
        await this.applyEffect(tx, this.efeitoDe(movida));
      }
      return { anticipated: escolhidas.length, remaining: antecipaveis.length - escolhidas.length };
    });
  }

  // ----------------------------------------------------------
  // Helpers privados
  // ----------------------------------------------------------

  /** A categoria precisa ser visível ao usuário (dele ou padrão) e não ter
   * subcategorias dele: só folha recebe lançamento novo. */
  /** A conta ou o cartão do lançamento precisa ser DO usuário. Sem esta
   * conferência, mandar o id da conta de outra pessoa fazia o saldo dela mudar:
   * o efeito era aplicado por id, e ninguém perguntava de quem era. Também
   * transforma violação de chave estrangeira (conta apagada) em 404 com
   * mensagem, em vez de erro 500. */
  private async conferirDestino(
    tx: Prisma.TransactionClient,
    userId: string,
    bankAccountId?: string,
    creditCardId?: string,
  ) {
    if (bankAccountId) {
      const conta = await tx.bankAccount.findFirst({ where: { id: bankAccountId, userId } });
      if (!conta) throw new NotFoundException('Conta bancária não encontrada');
    }
    if (creditCardId) {
      const cartao = await tx.creditCard.findFirst({ where: { id: creditCardId, userId } });
      if (!cartao) throw new NotFoundException('Cartão de crédito não encontrado');
    }
  }

  private async conferirCategoria(tx: Prisma.TransactionClient, userId: string, categoryId: string) {
    const categoria = await tx.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { isDefault: true }] },
    });
    if (!categoria) throw new NotFoundException('Categoria não encontrada');
    const filhas = await tx.category.count({ where: { parentId: categoryId, userId } });
    if (filhas > 0) {
      throw new BadRequestException(
        `${categoria.name} tem subcategorias: escolha uma delas para o lançamento.`,
      );
    }
  }

  private validarEntrada(input: CreateTransactionInput): Date | null {
    validateAccountXorCard(input.bankAccountId, input.creditCardId);
    validateAmount(input.amount);
    if (input.invoiceMonth === undefined) return null;
    if (!input.creditCardId) throw new BadRequestException('Só compra no cartão tem fatura para escolher.');
    return this.mesDaFaturaInformado(input.invoiceMonth);
  }

  private mesDaFaturaInformado(mes: string): Date {
    if (!MES_VALIDO.test(mes)) throw new BadRequestException('Mês da fatura inválido. Use AAAA-MM.');
    return mesParaData(mes);
  }

  private dadosDoLancamento(input: CreateTransactionInput) {
    return {
      userId: input.userId,
      categoryId: input.categoryId,
      type: input.type,
      amount: input.amount,
      description: input.description,
      transactionDate: input.transactionDate,
      bankAccountId: input.bankAccountId,
      creditCardId: input.creditCardId,
      isRecurring: input.isRecurring ?? false,
      // Só marca reembolso o que de fato ENTRA: uma despesa marcada assim
      // viraria uma despesa que abate despesa, e não existe isso.
      isRefund: (input.isRefund ?? false) && input.type === TransactionType.INCOME,
      isConfirmed: input.isConfirmed ?? true,
      source: input.source ?? TransactionSource.APP,
      clientKey: input.clientKey ?? null,
    };
  }

  private efeitoDe(t: {
    bankAccountId: string | null;
    creditCardId: string | null;
    type: TransactionType;
    amount: Prisma.Decimal | number;
    transactionDate: Date;
    invoiceMonthOverride?: Date | null;
    isConfirmed: boolean;
  }): Efeito {
    return {
      bankAccountId: t.bankAccountId ?? null,
      creditCardId: t.creditCardId ?? null,
      type: t.type,
      amount: Number(t.amount),
      transactionDate: t.transactionDate,
      invoiceMonthOverride: t.invoiceMonthOverride ?? null,
      isConfirmed: t.isConfirmed,
    };
  }

  /** Mês ('AAAA-MM') da fatura em que um lançamento de cartão entra. */
  private mesDaFatura(
    t: { transactionDate: Date; invoiceMonthOverride?: Date | null },
    card: { closingDay: number; dueDay: number },
  ): string {
    return dataParaMes(this.cicloDoLancamento(t, card).referenceMonth);
  }

  private cicloDoLancamento(
    t: { transactionDate: Date; invoiceMonthOverride?: Date | null },
    card: { closingDay: number; dueDay: number },
  ) {
    return t.invoiceMonthOverride
      ? datasDoMesChave(dataParaMes(t.invoiceMonthOverride), card.closingDay, card.dueDay)
      : resolveInvoicePeriod(t.transactionDate, card.closingDay, card.dueDay);
  }

  private mesDoCicloDeHoje(card: { closingDay: number; dueDay: number }) {
    return this.mesDaFatura({ transactionDate: new Date(hojeNoFuso() + 'T00:00:00.000Z') }, card);
  }

  private async faturasDoCartao(
    tx: Prisma.TransactionClient,
    card: { id: string; closingDay: number; dueDay: number },
  ): Promise<Map<string, FaturaCalculada>> {
    const gravadas = await tx.creditCardInvoice.findMany({
      where: { creditCardId: card.id },
      include: { payments: true },
      orderBy: { referenceMonth: 'asc' },
    });
    return new Map(montarFaturas(card, gravadas, hojeNoFuso()).map((f) => [f.referenceMonth, f]));
  }

  /** Ids dos lançamentos de cartão que estão em fatura paga ou transportada. */
  private async protegidos(
    tx: Prisma.TransactionClient,
    lancamentos: { id: string; creditCardId: string | null; transactionDate: Date; invoiceMonthOverride: Date | null }[],
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    const porCartao = new Map<string, typeof lancamentos>();
    for (const t of lancamentos) {
      if (!t.creditCardId) continue;
      porCartao.set(t.creditCardId, [...(porCartao.get(t.creditCardId) ?? []), t]);
    }
    for (const [cardId, lista] of porCartao) {
      const card = await tx.creditCard.findUnique({ where: { id: cardId } });
      if (!card) continue;
      const faturas = await this.faturasDoCartao(tx, card);
      for (const t of lista) {
        const s = faturas.get(this.mesDaFatura(t, card))?.status;
        if (s === 'PAID' || s === 'CARRIED') ids.add(t.id);
      }
    }
    return ids;
  }

  /** Aplica o impacto financeiro de uma versão da transação — nada, se ela
   * é prevista. Par exato de `reverseEffect`. */
  private async applyEffect(tx: Prisma.TransactionClient, t: Efeito) {
    if (!t.isConfirmed) return;
    if (t.bankAccountId) {
      await this.applyToBankAccount(tx, t.bankAccountId, t.type, t.amount);
    } else if (t.creditCardId) {
      await this.applyToCreditCardInvoice(tx, t.creditCardId, this.invoiceDelta(t.type, t.amount), t);
    }
  }

  /** Reverte o impacto financeiro de uma transação existente (usado em
   * update/delete). Prevista nunca teve efeito, então não há o que desfazer. */
  private async reverseEffect(tx: Prisma.TransactionClient, existing: Efeito) {
    if (!existing.isConfirmed) return;
    if (existing.bankAccountId) {
      // Inverte o tipo para desfazer o efeito original
      const inverseType =
        existing.type === TransactionType.INCOME ? TransactionType.EXPENSE : TransactionType.INCOME;
      await this.applyToBankAccount(tx, existing.bankAccountId, inverseType, existing.amount);
    } else if (existing.creditCardId) {
      // O oposto exato do que foi aplicado: desfaz uma compra subtraindo e
      // um estorno somando. Negar sempre, sem olhar o tipo, só funcionava
      // enquanto create também ignorava o tipo — um erro cancelava o outro.
      // Sai da MESMA fatura em que entrou (inclusive a escolhida).
      await this.applyToCreditCardInvoice(
        tx,
        existing.creditCardId,
        -this.invoiceDelta(existing.type, existing.amount),
        existing,
      );
    }
  }

  /**
   * Quanto uma transação de cartão move a fatura. Despesa aumenta o valor a
   * pagar; receita no cartão é estorno e diminui. É a mesma regra de sinal
   * que `applyToBankAccount` aplica pelo `type`, e precisa ser a ÚNICA fonte
   * dela: create, update e reverseEffect usam esta função, para aplicar e
   * desfazer sempre serem simétricos.
   */
  private invoiceDelta(type: TransactionType, amount: number): number {
    return type === TransactionType.INCOME ? -amount : amount;
  }

  /**
   * Aplica o efeito de uma transação no saldo de uma conta bancária.
   * INCOME soma, EXPENSE subtrai. Usa `increment`/`decrement` do Prisma
   * (executa como UPDATE atômico no banco, evitando race conditions
   * de leitura-e-escrita separadas).
   */
  private async applyToBankAccount(
    tx: Prisma.TransactionClient,
    bankAccountId: string,
    type: TransactionType,
    amount: number,
  ) {
    const account = await tx.bankAccount.findUnique({ where: { id: bankAccountId } });
    if (!account) throw new NotFoundException('Conta bancária não encontrada');

    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        currentBalance:
          type === TransactionType.INCOME
            ? { increment: amount }
            : { decrement: amount },
      },
    });
  }

  /**
   * Aplica um delta com sinal na fatura do lançamento (a da data, ou a
   * escolhida — ver `cicloDoLancamento`). Cria a fatura se ainda não existir.
   *
   * `totalAmount` é o acúmulo dos deltas, e por isso PODE ficar negativo: é
   * o que acontece quando um estorno é registrado antes da compra, ou quando
   * os estornos superam as compras do mês (saldo credor). Não há trava que
   * zere o negativo, e isso é proposital — zerar descarta parte do acúmulo, e
   * a exclusão seguinte devolve um valor que nunca foi subtraído. Com a trava,
   * estorno de 80 → compra de 300 → excluir o estorno deixava a fatura em 380
   * em vez de 300.
   */
  private async applyToCreditCardInvoice(
    tx: Prisma.TransactionClient,
    creditCardId: string,
    amount: number,
    lancamento: { transactionDate: Date; invoiceMonthOverride?: Date | null },
  ) {
    const card = await tx.creditCard.findUnique({ where: { id: creditCardId } });
    if (!card) throw new NotFoundException('Cartão de crédito não encontrado');

    const { referenceMonth, closingDate, dueDate } = this.cicloDoLancamento(lancamento, card);

    // upsert: garante a fatura do mês sem duplicar (respeita o @@unique
    // [creditCardId, referenceMonth] definido no schema)
    await tx.creditCardInvoice.upsert({
      where: {
        creditCardId_referenceMonth: { creditCardId, referenceMonth },
      },
      create: {
        creditCardId,
        referenceMonth,
        closingDate,
        dueDate,
        totalAmount: amount,
        status: InvoiceStatus.OPEN,
      },
      update: {
        totalAmount: { increment: amount },
      },
    });
  }
}
