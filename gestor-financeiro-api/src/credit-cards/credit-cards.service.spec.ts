// ============================================================
// credit-cards.service.spec.ts
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditCardsService } from './credit-cards.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CreditCardsService', () => {
  let service: CreditCardsService;
  let prismaMock: any;

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn((callback) => callback(prismaMock)),
      creditCard: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      creditCardInvoice: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      // A linha do tempo do ciclo: é nela que a troca de vencimento grava.
      creditCardBillingCycle: {
        create: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      transaction: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      invoicePayment: { count: jest.fn().mockResolvedValue(0) },
      bankAccount: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditCardsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<CreditCardsService>(CreditCardsService);
  });

  it('create() gera automaticamente a fatura do ciclo atual com total zero', async () => {
    prismaMock.creditCard.create.mockResolvedValue({ id: 'card-1' });

    await service.create({
      userId: 'user-1',
      name: 'Nubank Roxinho',
      limitAmount: 2000,
      closingDay: 10,
      dueDay: 17,
    });

    expect(prismaMock.creditCardInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creditCardId: 'card-1',
        totalAmount: 0,
        status: 'OPEN',
      }),
    });
  });

  it('create() grava o período de origem do ciclo, valendo desde sempre', async () => {
    // Sem ele, a primeira troca de vencimento deste cartão criaria o único
    // período da lista, e as faturas anteriores passariam a usar os dias
    // novos — o passado mudando de data.
    prismaMock.creditCard.create.mockResolvedValue({ id: 'card-1' });

    await service.create({
      userId: 'user-1',
      name: 'Nubank Roxinho',
      limitAmount: 2000,
      closingDay: 10,
      dueDay: 17,
    });

    expect(prismaMock.creditCardBillingCycle.create).toHaveBeenCalledWith({
      data: {
        creditCardId: 'card-1',
        validFrom: new Date(Date.UTC(1900, 0, 1)),
        closingDay: 10,
        dueDay: 17,
      },
    });
  });

  it('create() valida que a conta bancária vinculada pertence ao usuário', async () => {
    prismaMock.bankAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.create({
        userId: 'user-1',
        name: 'Itaú Click',
        limitAmount: 1000,
        closingDay: 5,
        dueDay: 12,
        bankAccountId: 'conta-de-outro-usuario',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.creditCard.create).not.toHaveBeenCalled();
  });

  // Faturas como o Prisma devolve (@db.Date = meia-noite UTC), com pagamentos.
  const fatura = (mes: string, total: number, pagos: number[] = []) => ({
    id: 'inv-' + mes,
    referenceMonth: new Date(mes + '-01T00:00:00Z'),
    closingDate: new Date(mes + '-10T00:00:00Z'),
    dueDate: new Date(mes + '-17T00:00:00Z'),
    totalAmount: total,
    payments: pagos.map((v, i) => ({ id: 'p' + i, amount: v, paidAt: new Date(mes + '-12T00:00:00Z'), bankAccountId: 'acc-1' })),
  });

  beforeEach(() => {
    prismaMock.creditCard.findUnique.mockResolvedValue({ id: 'card-1', closingDay: 10, dueDay: 17 });
  });

  it('getAvailableLimit() desconta o que está em aberto em TODAS as faturas, não só a atual', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([fatura('2020-01', 300), fatura('2020-02', 500)]);
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(1200);
  });

  it('getAvailableLimit() libera o que já foi pago, inclusive em parte', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([fatura('2020-01', 800, [500])]);
    // Janeiro/2020 já venceu, pagou 500 de 800: os 300 foram para fevereiro —
    // e contam uma vez só.
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(1700);
  });

  it('getAvailableLimit() retorna o limite cheio quando não há faturas', async () => {
    prismaMock.creditCardInvoice.findMany.mockResolvedValue([]);
    await expect(service.getAvailableLimit('card-1', 2000)).resolves.toBe(2000);
  });

  it('delete() vira soft-delete quando há pagamento registrado, mesmo sem compras', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCardInvoice.count.mockResolvedValue(0);
    prismaMock.invoicePayment.count.mockResolvedValue(1);

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCard.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: false, archived: true });
  });

  /* A outra pergunta: o cartao NAO mudou de datas -- o cadastro e que
   * estava errado. Usar a porta de "mudou agora" nesse caso abre um BURACO
   * no calendario, e isso foi medido: trocar o vencimento do dia 28 (mesmo
   * mes) para o dia 7 (mes seguinte) empurrou o vencimento um mes a frente,
   * a fatura de dezembro deixou de existir, e os lancamentos dela
   * apareceram em janeiro. */
  describe('corrigirCiclo() — o cadastro e que estava errado', () => {
    const cartao = { id: 'card-1', userId: 'user-1', closingDay: 20, dueDay: 28, cycles: [] };

    /* O nome de uma fatura e o mes em que ela VENCE. Em todo teste daqui o
     * que se confere e o nome, e nunca a referencia: a referencia e numero
     * interno, e preservar o numero foi justamente o erro. */
    const nome = (d: Date) => d.toISOString().slice(0, 7);

    beforeEach(() => {
      prismaMock.creditCard.findFirst.mockResolvedValue(cartao);
      prismaMock.creditCard.update.mockResolvedValue({ ...cartao, closingDay: 30, dueDay: 7 });
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([]);
      prismaMock.transaction.findMany.mockResolvedValue([]);
    });

    it('reescreve o historico: um ciclo so, desde sempre', async () => {
      await service.corrigirCiclo('user-1', 'card-1', 30, 7);

      expect(prismaMock.creditCardBillingCycle.deleteMany).toHaveBeenCalledWith({
        where: { creditCardId: 'card-1' },
      });
      expect(prismaMock.creditCardBillingCycle.create).toHaveBeenCalledWith({
        data: {
          creditCardId: 'card-1',
          validFrom: new Date(Date.UTC(1900, 0, 1)),
          closingDay: 30,
          dueDay: 7,
        },
      });
    });

    /* Nenhum `upsert`: criar um periodo a partir de hoje e justamente o que
     * abre o buraco. */
    it('nao cria periodo novo a partir de hoje', async () => {
      await service.corrigirCiclo('user-1', 'card-1', 30, 7);
      expect(prismaMock.creditCardBillingCycle.upsert).not.toHaveBeenCalled();
    });

    it('os dias do cartao passam a ser os corrigidos', async () => {
      await service.corrigirCiclo('user-1', 'card-1', 30, 7);
      expect(prismaMock.creditCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { closingDay: 30, dueDay: 7 },
      });
    });

    // ------------------------------------------------- o nome nao escorrega
    /* O defeito medido com a tela na mao, e a razao de tudo o que vem
     * abaixo. Cartao cadastrado 1/7 (vence no MESMO mes do fechamento),
     * corrigido para 30/7 (vence no mes SEGUINTE). A fatura de referencia
     * outubro se chamava outubro; com a regua nova ela passaria a se chamar
     * novembro, e o lancamento que estava nela "mudaria de fatura" sem
     * ninguem ter pedido. */
    describe('o cadastro 1/7 corrigido para 30/7', () => {
      const errado = { id: 'card-1', userId: 'user-1', closingDay: 1, dueDay: 7, cycles: [] };

      beforeEach(() => {
        prismaMock.creditCard.findFirst.mockResolvedValue(errado);
        prismaMock.creditCard.update.mockResolvedValue({ ...errado, closingDay: 30, dueDay: 7 });
      });

      it('a fatura que se chamava outubro continua se chamando outubro', async () => {
        prismaMock.creditCardInvoice.findMany.mockResolvedValue([
          { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) }, // vence 07/10
        ]);

        await service.corrigirCiclo('user-1', 'card-1', 30, 7);

        /* Duas voltas por fatura: o desvio e o destino. A que vale e a
         * segunda, e e nela que o nome tem de estar intacto. */
        const final = prismaMock.creditCardInvoice.update.mock.calls.at(-1)[0];
        expect(final.where).toEqual({ id: 'f1' });
        expect(nome(final.data.dueDate)).toBe('2026-10');
        expect(nome(final.data.referenceMonth)).toBe('2026-09');
      });

      /* O lancamento dos prints: compra de 30/09, hoje na fatura de
       * outubro. Depois da correcao, ainda em outubro. */
      it('o lancamento de 30/09 continua na fatura de outubro', async () => {
        prismaMock.transaction.findMany.mockResolvedValue([
          { id: 't1', transactionDate: new Date(Date.UTC(2026, 8, 30)), invoiceMonthOverride: null },
        ]);

        await service.corrigirCiclo('user-1', 'card-1', 30, 7);

        const preso = prismaMock.transaction.update.mock.calls[0][0].data.invoiceMonthOverride;
        // referencia setembro, que com 30/7 vence em 07/10: outubro.
        expect(nome(preso)).toBe('2026-09');
      });

      /* O importado ja guardava uma referencia -- mas guardava a ANTIGA.
       * Deixa-lo parado seria deixa-lo mudar de nome. */
      it('o importado tambem e renumerado, para nao mudar de nome', async () => {
        prismaMock.transaction.findMany.mockResolvedValue([
          {
            id: 't1',
            transactionDate: new Date(Date.UTC(2026, 8, 30)),
            invoiceMonthOverride: new Date(Date.UTC(2026, 9, 1)), // outubro
          },
        ]);

        await service.corrigirCiclo('user-1', 'card-1', 30, 7);

        const preso = prismaMock.transaction.update.mock.calls[0][0].data.invoiceMonthOverride;
        expect(nome(preso)).toBe('2026-09');
      });

      /* Uma fatura inteira de lancamentos nao pode se separar da fatura:
       * os dois sao traduzidos pela MESMA conta. */
      it('fatura e lancamento vao para a mesma referencia', async () => {
        prismaMock.creditCardInvoice.findMany.mockResolvedValue([
          { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) },
        ]);
        prismaMock.transaction.findMany.mockResolvedValue([
          { id: 't1', transactionDate: new Date(Date.UTC(2026, 8, 30)), invoiceMonthOverride: null },
        ]);

        await service.corrigirCiclo('user-1', 'card-1', 30, 7);

        const fatura = prismaMock.creditCardInvoice.update.mock.calls.at(-1)[0].data.referenceMonth;
        const lancamento = prismaMock.transaction.update.mock.calls[0][0].data.invoiceMonthOverride;
        expect(nome(lancamento)).toBe(nome(fatura));
      });
    });

    /* O caso em que a regua nao muda a distancia: 20/28 e 15/28 vencem os
     * dois no mesmo mes do fechamento. Nada precisa ser renumerado. */
    it('regua que nao muda a distancia nao renumera nada', async () => {
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([
        { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) },
      ]);

      await service.corrigirCiclo('user-1', 'card-1', 15, 28);

      const final = prismaMock.creditCardInvoice.update.mock.calls.at(-1)[0];
      expect(nome(final.data.referenceMonth)).toBe('2026-10');
      expect(nome(final.data.dueDate)).toBe('2026-10');
    });

    // --------------------------------------------------- as faturas em bloco
    /* TODAS, e nao so a corrente: o historico inteiro mudou de regua. E a
     * renumeracao vai em duas voltas porque `(cartao, referencia)` e unico
     * -- mover uma fatura para um mes que a vizinha ainda ocupa estoura o
     * indice no meio do caminho. */
    it('recalcula TODAS as faturas, em duas voltas', async () => {
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([
        { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) },
        { id: 'f2', referenceMonth: new Date(Date.UTC(2026, 10, 1)) },
        { id: 'f3', referenceMonth: new Date(Date.UTC(2026, 11, 1)) },
      ]);

      const r = await service.corrigirCiclo('user-1', 'card-1', 30, 7);

      expect(r.faturasRecalculadas).toBe(3);
      expect(prismaMock.creditCardInvoice.update).toHaveBeenCalledTimes(6);
    });

    it('o desvio da primeira volta sai de perto de qualquer fatura de verdade', async () => {
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([
        { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) },
      ]);

      await service.corrigirCiclo('user-1', 'card-1', 30, 7);

      const desvio = prismaMock.creditCardInvoice.update.mock.calls[0][0].data.referenceMonth;
      expect(desvio.getUTCFullYear()).toBe(2126);
    });

    /* Os nomes seguidos continuam seguidos: e o buraco de dezembro, visto
     * pelo outro lado. */
    it('a sequencia de nomes fica continua', async () => {
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([
        { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 9, 1)) },
        { id: 'f2', referenceMonth: new Date(Date.UTC(2026, 10, 1)) },
        { id: 'f3', referenceMonth: new Date(Date.UTC(2026, 11, 1)) },
      ]);

      await service.corrigirCiclo('user-1', 'card-1', 30, 7);

      const finais = prismaMock.creditCardInvoice.update.mock.calls
        .slice(3)
        .map((c) => nome(c[0].data.dueDate));
      expect(finais).toEqual(['2026-10', '2026-11', '2026-12']);
    });

    /* Ha reguas em que um mes simplesmente nao tem fatura: fecha 28 e vence
     * 29, em fevereiro, caem os dois no dia 28 -- o vencimento escorrega
     * para marco, e fevereiro fica sem nome nenhum. Medido varrendo os 961
     * pares de dias: este caso existe, e colisao de duas faturas numa so
     * nao existe em nenhum deles.
     *
     * Aproximar para o mes vizinho moveria lancamento em silencio, que e a
     * unica coisa que esta operacao promete nunca fazer. Entao recusa, e
     * quem configurou confere os dias com o banco. */
    it('recusa quando a regua nova nao teria uma das faturas', async () => {
      const errado = { id: 'card-1', userId: 'user-1', closingDay: 1, dueDay: 7, cycles: [] };
      prismaMock.creditCard.findFirst.mockResolvedValue(errado);
      prismaMock.creditCardInvoice.findMany.mockResolvedValue([
        { id: 'f1', referenceMonth: new Date(Date.UTC(2026, 1, 1)) }, // hoje: fevereiro
      ]);

      await expect(service.corrigirCiclo('user-1', 'card-1', 28, 29)).rejects.toThrow(/02\/2026/);
    });

    it('olha TODOS os lancamentos do cartao, e nao so os soltos', async () => {
      await service.corrigirCiclo('user-1', 'card-1', 30, 7);
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', creditCardId: 'card-1' },
        }),
      );
    });

    it('cartao de outra pessoa nao se corrige', async () => {
      prismaMock.creditCard.findFirst.mockResolvedValue(null);
      await expect(service.corrigirCiclo('user-1', 'alheio', 30, 7)).rejects.toThrow();
    });
  });

  describe('updateBillingCycle() — a troca de ciclo', () => {
    // Cartão que fecha dia 10 e vence 17. "Hoje" fixo para o mês da fatura
    // aberta não depender do dia em que o teste roda.
    const cartao = { id: 'card-1', userId: 'user-1', closingDay: 10, dueDay: 17, cycles: [] };

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-11-20T12:00:00.000Z')); // fatura aberta: 2026-12
      prismaMock.creditCard.findFirst.mockResolvedValue(cartao);
      prismaMock.creditCard.update.mockResolvedValue({ ...cartao, closingDay: 15, dueDay: 22 });
    });
    afterEach(() => jest.useRealTimers());

    it('cartão sem uso: reescreve o período de origem, sem criar histórico', async () => {
      prismaMock.creditCardInvoice.count.mockResolvedValue(1); // só a fatura do cadastro

      await service.updateBillingCycle('user-1', 'card-1', 15, 22);

      expect(prismaMock.creditCardBillingCycle.deleteMany).toHaveBeenCalledWith({
        where: { creditCardId: 'card-1' },
      });
      expect(prismaMock.creditCardBillingCycle.create).toHaveBeenCalledWith({
        data: {
          creditCardId: 'card-1',
          validFrom: new Date(Date.UTC(1900, 0, 1)),
          closingDay: 15,
          dueDay: 22,
        },
      });
      expect(prismaMock.creditCard.update).toHaveBeenCalledWith({
        where: { id: 'card-1' },
        data: { closingDay: 15, dueDay: 22 },
      });
    });

    it('cartão EM USO: agora troca, criando um período a partir da fatura aberta', async () => {
      // Antes isto era recusado — e a recusa era o remendo que a linha do
      // tempo veio tirar.
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);

      await service.updateBillingCycle('user-1', 'card-1', 15, 22);

      expect(prismaMock.creditCardBillingCycle.upsert).toHaveBeenCalledWith({
        where: {
          creditCardId_validFrom: { creditCardId: 'card-1', validFrom: new Date(Date.UTC(2026, 11, 1)) },
        },
        create: {
          creditCardId: 'card-1',
          validFrom: new Date(Date.UTC(2026, 11, 1)),
          closingDay: 15,
          dueDay: 22,
        },
        update: { closingDay: 15, dueDay: 22 },
      });
      // O período de origem continua lá: o passado não se mexe.
      expect(prismaMock.creditCardBillingCycle.deleteMany).not.toHaveBeenCalled();
    });

    it('vale também para a fatura SEGUINTE, e aí as colunas não mudam', async () => {
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);

      await service.updateBillingCycle('user-1', 'card-1', 15, 22, '2027-01');

      expect(prismaMock.creditCardBillingCycle.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ validFrom: new Date(Date.UTC(2027, 0, 1)) }),
        }),
      );
      // As colunas são o período de AGORA, e agora ainda é o antigo.
      expect(prismaMock.creditCard.update).not.toHaveBeenCalled();
    });

    it('fatura que já fechou não muda de data', async () => {
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);

      await expect(service.updateBillingCycle('user-1', 'card-1', 15, 22, '2026-09')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.updateBillingCycle('user-1', 'card-1', 15, 22, '2026-09')).rejects.toThrow(
        /2026-12.*2027-01/,
      );
      expect(prismaMock.creditCardBillingCycle.upsert).not.toHaveBeenCalled();
      expect(prismaMock.creditCard.update).not.toHaveBeenCalled();
    });

    it('a fatura do ciclo corrente é recalculada na hora, sem esperar o cron', async () => {
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);

      await service.updateBillingCycle('user-1', 'card-1', 15, 22);

      expect(prismaMock.creditCardInvoice.updateMany).toHaveBeenCalledWith({
        where: { creditCardId: 'card-1', referenceMonth: new Date(Date.UTC(2026, 11, 1)) },
        data: { closingDate: new Date(Date.UTC(2026, 11, 15)), dueDate: new Date(Date.UTC(2026, 11, 22)) },
      });
    });
    it('cartão EM USO sem período de origem ganha um, com os dias de HOJE', async () => {
      // Cartão de antes da tabela de períodos: se a troca criasse só o
      // período novo, ele seria o único da lista e responderia também pelas
      // faturas velhas — o passado mudaria de data.
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);
      prismaMock.creditCard.findFirst.mockResolvedValue({ ...cartao, cycles: [] });

      await service.updateBillingCycle('user-1', 'card-1', 15, 22);

      expect(prismaMock.creditCardBillingCycle.create).toHaveBeenCalledWith({
        data: {
          creditCardId: 'card-1',
          validFrom: new Date(Date.UTC(1900, 0, 1)),
          closingDay: 10, // os dias que o cartão tinha, não os novos
          dueDay: 17,
        },
      });
    });

    it('cartão que já tem período de origem não ganha outro', async () => {
      prismaMock.creditCardInvoice.count.mockResolvedValue(3);
      prismaMock.creditCard.findFirst.mockResolvedValue({
        ...cartao,
        cycles: [{ validFrom: new Date(Date.UTC(1900, 0, 1)), closingDay: 10, dueDay: 17 }],
      });

      await service.updateBillingCycle('user-1', 'card-1', 15, 22);

      expect(prismaMock.creditCardBillingCycle.create).not.toHaveBeenCalled();
      expect(prismaMock.creditCardBillingCycle.upsert).toHaveBeenCalled();
    });
  });

  it('delete() remove de fato (cartão + fatura vazia) quando não há uso real', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(0);
    prismaMock.creditCardInvoice.count.mockResolvedValue(0); // nenhuma fatura com total > 0

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCardInvoice.deleteMany).toHaveBeenCalledWith({
      where: { creditCardId: 'card-1' },
    });
    expect(prismaMock.creditCard.delete).toHaveBeenCalledWith({ where: { id: 'card-1' } });
    expect(result).toEqual({ deleted: true, archived: false });
  });

  it('delete() vira soft-delete quando há transações lançadas no cartão', async () => {
    prismaMock.creditCard.findFirst.mockResolvedValue({ id: 'card-1', userId: 'user-1' });
    prismaMock.transaction.count.mockResolvedValue(7);
    prismaMock.creditCardInvoice.count.mockResolvedValue(1);

    const result = await service.delete('user-1', 'card-1');

    expect(prismaMock.creditCard.delete).not.toHaveBeenCalled();
    expect(prismaMock.creditCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { isActive: false },
    });
    expect(result).toEqual({ deleted: false, archived: true });
  });
});
