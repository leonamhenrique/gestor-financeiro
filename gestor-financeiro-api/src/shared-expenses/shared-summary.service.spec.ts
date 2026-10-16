// ============================================================
// shared-summary.service.spec.ts
// ============================================================
// Os números destes testes são os das telas do desenho: a do Rafael
// (quatro gastos meus mais um Pix dele) e a da Bruna (um gasto dela).
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { SharedSummaryService } from './shared-summary.service';
import { PeopleService } from './people.service';
import { PrismaService } from '../prisma/prisma.service';

const RAFAEL = { id: 'rafael', name: 'Rafael', pixKey: null, sortOrder: 0, isActive: true };
const BRUNA = { id: 'bruna', name: 'Bruna', pixKey: 'bruna@pix', sortOrder: 1, isActive: true };

/** Gasto meu, dividido. */
function meu(id: string, total: number, parteDele: number, data: string, desc: string, personId = 'rafael') {
  return {
    id,
    transactionId: 'tx-' + id,
    paidByPersonId: null,
    transaction: {
      amount: total,
      description: desc,
      transactionDate: new Date(data + 'T00:00:00Z'),
      categoryId: 'cat',
    },
    shares: [{ personId, amount: parteDele, percent: null }],
  };
}

/** Gasto do outro: não há lançamento nenhum. */
function dela(id: string, total: number, parteDela: number, data: string, desc: string, personId: string) {
  return {
    id,
    transactionId: null,
    transaction: null,
    paidByPersonId: personId,
    // A consulta real traz quem pagou junto (`include: { paidBy: true }`).
    paidBy: personId === 'bruna' ? BRUNA : RAFAEL,
    amount: total,
    description: desc,
    expenseDate: new Date(data + 'T00:00:00Z'),
    categoryId: 'cat',
    shares: [{ personId, amount: parteDela, percent: 50 }],
  };
}

function acerto(personId: string, direction: 'RECEIVED' | 'PAID', amount: number, data: string) {
  return {
    id: 'a-' + data,
    personId,
    direction,
    amount,
    description: null,
    settledAt: new Date(data + 'T00:00:00Z'),
    // A consulta real traz a pessoa junto (`include: { person: true }`).
    person: personId === 'bruna' ? BRUNA : RAFAEL,
  };
}

describe('SharedSummaryService', () => {
  let service: SharedSummaryService;
  let prisma: any;

  const DESPESAS = [
    meu('d1', 200, 100, '2026-10-12', 'Jantar'),
    meu('d2', 220, 110, '2026-10-09', 'Gasolina'),
    meu('d3', 380, 190, '2026-10-05', 'Mercado'),
    meu('d4', 1200, 600, '2026-10-02', 'Aluguel da casa'),
    dela('d5', 240, 120, '2026-10-07', 'Ingressos do show', 'bruna'),
  ];
  const ACERTOS = [acerto('rafael', 'RECEIVED', 300, '2026-10-14')];

  beforeEach(async () => {
    prisma = {
      person: { findMany: jest.fn(async () => [RAFAEL, BRUNA]) },
      sharedExpense: { findMany: jest.fn(async () => DESPESAS) },
      // O mock HONRA o `where.personId`. Ignorá-lo deixaria passar um
      // serviço que esquecesse o filtro — e o acerto de um apareceria no
      // extrato do outro.
      settlement: {
        findMany: jest.fn(async ({ where }: any) =>
          ACERTOS.filter((a) => !where?.personId || a.personId === where.personId),
        ),
      },
    };
    const people = {
      minha: jest.fn(async (_u: string, id: string) => (id === 'bruna' ? BRUNA : RAFAEL)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedSummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: people },
      ],
    }).compile();

    service = module.get(SharedSummaryService);
  });

  describe('resumo()', () => {
    it('o saldo do Rafael é o que ele me deve menos o que já pagou', async () => {
      const r = await service.resumo('u1');
      const rafael = r.pessoas.find((p) => p.personId === 'rafael')!;
      // 100 + 110 + 190 + 600 = 1000, menos o Pix de 300.
      expect(rafael.saldo).toBe(700);
      expect(rafael.lancamentos).toBe(4);
      expect(rafael.acertos).toBe(1);
    });

    it('o saldo da Bruna é negativo: ela pagou e eu devo a MINHA parte', async () => {
      const r = await service.resumo('u1');
      const bruna = r.pessoas.find((p) => p.personId === 'bruna')!;
      expect(bruna.saldo).toBe(-120);
    });

    it('a receber e a pagar não se cancelam na mesma linha', async () => {
      const r = await service.resumo('u1');
      // "Tenho 700 a receber e devo 120" é outra informação que "líquido 580",
      // e a tela mostra as duas.
      expect(r.aReceber).toBe(700);
      expect(r.aPagar).toBe(120);
      expect(r.liquido).toBe(580);
    });

    it('pessoa sem nada aparece zerada, não some', async () => {
      prisma.sharedExpense.findMany.mockResolvedValue([]);
      prisma.settlement.findMany.mockResolvedValue([]);

      const r = await service.resumo('u1');
      expect(r.pessoas).toHaveLength(2);
      expect(r.pessoas.every((p) => p.saldo === 0)).toBe(true);
      expect(r.liquido).toBe(0);
    });
  });

  describe('extratoDaPessoa()', () => {
    it('sem mês, traz tudo e o saldo anterior é zero', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael');
      expect(e.saldoAnterior).toBe(0);
      expect(e.saldoFinal).toBe(700);
      expect(e.lancamentos).toHaveLength(4);
    });

    it('o saldo final é sempre anterior + movimento: a coluna fecha', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-10');
      expect(e.saldoFinal).toBe(e.saldoAnterior + e.movimentoDoMes);
    });

    // O mês não sabe o que ficou para trás: sem o saldo anterior, quem
    // abrisse novembro veria zero e acharia que está quite.
    it('o mês seguinte começa do saldo que veio de trás', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-11');
      expect(e.saldoAnterior).toBe(700);
      expect(e.movimentoDoMes).toBe(0);
      expect(e.saldoFinal).toBe(700);
      expect(e.lancamentos).toHaveLength(0);
    });

    it('o mês anterior ainda não tem nada', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-09');
      expect(e.saldoAnterior).toBe(0);
      expect(e.saldoFinal).toBe(0);
    });

    it('traz o total do mês e a minha parte, como a tela mostra', async () => {
      const e = await service.extratoDaPessoa('u1', 'bruna', '2026-10');
      expect(e.totalDoMes).toBe(240);
      expect(e.minhaParteNoMes).toBe(120);
      expect(e.saldoFinal).toBe(-120);
    });

    it('os lançamentos vêm do mais recente para o mais antigo', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-10');
      const datas = e.lancamentos.map((l: any) => l.date.toISOString().slice(0, 10));
      expect(datas).toEqual(['2026-10-12', '2026-10-09', '2026-10-05', '2026-10-02']);
    });

    it('cada lançamento traz a parte dela e o percentual guardado', async () => {
      const e = await service.extratoDaPessoa('u1', 'bruna', '2026-10');
      expect(e.lancamentos[0].parteDela).toBe(120);
      expect(e.lancamentos[0].percent).toBe(50);
      expect(e.lancamentos[0].euPaguei).toBe(false);
    });

    it('o acerto do mês aparece no extrato', async () => {
      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-10');
      expect(e.acertos).toHaveLength(1);
      expect(e.acertos[0].direction).toBe('RECEIVED');
    });

    it('a pessoa é conferida antes de qualquer leitura', async () => {
      const people = { minha: jest.fn().mockRejectedValue(new Error('não é sua')) };
      const mod = await Test.createTestingModule({
        providers: [
          SharedSummaryService,
          { provide: PrismaService, useValue: prisma },
          { provide: PeopleService, useValue: people },
        ],
      }).compile();

      await expect(
        mod.get(SharedSummaryService).extratoDaPessoa('u1', 'de-outro'),
      ).rejects.toThrow('não é sua');
    });

    // O dia 1 em @db.Date é meia-noite UTC. Comparado com data local, em
    // qualquer fuso a oeste de Greenwich ele cairia no mês anterior.
    it('o dia 1 pertence ao próprio mês, não ao anterior', async () => {
      prisma.sharedExpense.findMany.mockResolvedValue([
        meu('d9', 100, 50, '2026-10-01', 'Primeiro do mês'),
      ]);
      prisma.settlement.findMany.mockResolvedValue([]);

      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-10');
      expect(e.lancamentos).toHaveLength(1);
      expect(e.saldoAnterior).toBe(0);
      expect(e.movimentoDoMes).toBe(50);
    });

    it('o último dia do mês também é do mês', async () => {
      prisma.sharedExpense.findMany.mockResolvedValue([
        meu('d9', 100, 50, '2026-10-31', 'Último do mês'),
      ]);
      prisma.settlement.findMany.mockResolvedValue([]);

      const e = await service.extratoDaPessoa('u1', 'rafael', '2026-10');
      expect(e.lancamentos).toHaveLength(1);
      expect(e.movimentoDoMes).toBe(50);
    });
  });

  // ----------------------------------------------------------
  // extrato geral: a aba COMPARTILHADAS da tela 7
  // ----------------------------------------------------------
  describe('extratoGeral()', () => {
    it('junta despesas e acertos numa lista só, do mais recente ao mais antigo', async () => {
      const e = await service.extratoGeral('u1');
      const datas = e.linhas.map((l: any) => new Date(l.date).toISOString().slice(0, 10));
      expect(datas).toEqual([
        '2026-10-14', // Pix do Rafael
        '2026-10-12', // Jantar
        '2026-10-09', // Gasolina
        '2026-10-07', // Ingressos (pagos pela Bruna)
        '2026-10-05', // Mercado
        '2026-10-02', // Aluguel
      ]);
    });

    it('o gasto que EU paguei entra negativo, com a minha parte ao lado', async () => {
      const e = await service.extratoGeral('u1');
      const jantar: any = e.linhas.find((l: any) => l.description === 'Jantar');
      expect(jantar.tipo).toBe('DESPESA');
      expect(jantar.valor).toBe(-200); // o valor cheio saiu de mim
      expect(jantar.minhaParte).toBe(100); // a parte do outro é informação, não desconto
      expect(jantar.foraDaConta).toBe(false);
    });

    // A linha 'fora da conta' da tela: o dinheiro não passou por conta nem
    // cartão meu, então ela não pesa no meu mês — gera dívida, não despesa.
    it('o gasto que ELA pagou fica fora da conta', async () => {
      const e = await service.extratoGeral('u1');
      const show: any = e.linhas.find((l: any) => l.description === 'Ingressos do show');
      expect(show.foraDaConta).toBe(true);
      expect(show.valor).toBe(0);
      expect(show.minhaParte).toBe(120);
      expect(show.paidBy.name).toBe('Bruna');
    });

    it('o acerto entra com sinal mas diz que não é receita', async () => {
      const e = await service.extratoGeral('u1');
      const pix: any = e.linhas.find((l: any) => l.tipo === 'ACERTO');
      expect(pix.valor).toBe(300);
      expect(pix.contaComoReceita).toBe(false);
      expect(pix.pessoa.name).toBe('Rafael');
    });

    it('mostra a forma de pagamento do gasto', async () => {
      prisma.sharedExpense.findMany.mockResolvedValue([
        {
          ...meu('dx', 200, 100, '2026-10-12', 'Jantar'),
          transaction: {
            amount: 200,
            description: 'Jantar',
            transactionDate: new Date('2026-10-12T00:00:00Z'),
            categoryId: 'cat',
            creditCard: { name: 'Nubank' },
          },
        },
      ]);

      const e = await service.extratoGeral('u1');
      const despesa: any = e.linhas.find((l: any) => l.tipo === 'DESPESA');
      expect(despesa.forma).toBe('Cartão Nubank');
    });

    // Este número vem do saldo ACUMULADO, e por isso pode passar do total
    // do próprio mês: ele carrega o que ficou de trás.
    it('o topo mostra o a receber acumulado, não o do mês', async () => {
      const e = await service.extratoGeral('u1', { from: '2026-10-13', to: '2026-10-31' });
      expect(e.linhas).toHaveLength(1); // só o Pix cai nessa faixa
      expect(e.aReceber).toBe(700); // mas o acumulado continua 700
      expect(e.aPagar).toBe(120);
    });

    it('a faixa de datas filtra os dois tipos de linha', async () => {
      const e = await service.extratoGeral('u1', { from: '2026-10-01', to: '2026-10-08' });
      const datas = e.linhas.map((l: any) => new Date(l.date).toISOString().slice(0, 10));
      expect(datas).toEqual(['2026-10-07', '2026-10-05', '2026-10-02']);
    });
  });
});

describe('SharedSummaryService — impacto no relatório', () => {
  let service: SharedSummaryService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      person: { findMany: jest.fn(async () => []) },
      sharedExpense: {
        findMany: jest.fn(async () => [
          meu('d1', 200, 100, '2026-10-12', 'Jantar'),
          meu('d2', 1200, 600, '2026-10-02', 'Aluguel'),
          dela('d5', 240, 120, '2026-10-07', 'Ingressos', 'bruna'),
          meu('d9', 500, 250, '2026-09-30', 'Mês passado'),
        ]),
      },
      settlement: { findMany: jest.fn(async () => []) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedSummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn() } },
      ],
    }).compile();

    service = module.get(SharedSummaryService);
  });

  it('separa o que gastei do que era dos outros', async () => {
    const i = await service.impactoNoMes('u1', '2026-10');
    expect(i.gastoDividido).toBe(1400); // 200 + 1200
    expect(i.dosOutros).toBe(700); // 100 + 600
    expect(i.meu).toBe(700);
  });

  it('as três partes sempre fecham', async () => {
    const i = await service.impactoNoMes('u1', '2026-10');
    expect(i.meu + i.dosOutros).toBe(i.gastoDividido);
  });

  // O que o amigo pagou nunca entrou no meu mês: não há o que descontar.
  it('o gasto pago por outra pessoa fica de fora da conta', async () => {
    const i = await service.impactoNoMes('u1', '2026-10');
    expect(i.gastoDividido).not.toBe(1640);
  });

  it('não invade o mês vizinho', async () => {
    const i = await service.impactoNoMes('u1', '2026-09');
    expect(i.gastoDividido).toBe(500);
    expect(i.meu).toBe(250);
  });

  it('mês sem nada devolve zeros, não NaN', async () => {
    const i = await service.impactoNoMes('u1', '2026-01');
    expect(i).toMatchObject({ gastoDividido: 0, dosOutros: 0, meu: 0 });
  });
});

// Compra no cartao sai da conta quando a FATURA VENCE, e o app inteiro ja
// conta assim por padrao. Esta tela lia a data crua e mostrava em outubro um
// gasto que o resto do app mostra em novembro -- dois numeros para o mesmo
// mes, que e exatamente o que a regra existe para evitar.
describe('SharedSummaryService — o mes de uma compra de cartao', () => {
  // Fecha dia 25, vence dia 5: como 5 vem ANTES de 25, o vencimento cai no
  // mes seguinte. E o arranjo mais comum do mercado.
  const CARTAO = { closingDay: 25, dueDay: 5, name: 'Itaucard' };

  function noCartao(data: string, total: number, parte: number) {
    return {
      id: 'dc',
      transactionId: 'tx-c',
      paidByPersonId: null,
      transaction: {
        amount: total,
        description: 'Despesa dividida',
        transactionDate: new Date(data + 'T00:00:00Z'),
        categoryId: 'cat',
        creditCardId: 'card-1',
        creditCard: CARTAO,
        invoiceMonthOverride: null,
      },
      shares: [{ personId: 'rafael', amount: parte, percent: null }],
    };
  }

  async function montar(despesas: any[]) {
    const prisma: any = {
      person: { findMany: jest.fn(async () => [RAFAEL]) },
      sharedExpense: { findMany: jest.fn(async () => despesas) },
      settlement: { findMany: jest.fn(async () => []) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        SharedSummaryService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn(async () => RAFAEL) } },
      ],
    }).compile();
    return mod.get(SharedSummaryService);
  }

  it('compra de 16/10 entra em NOVEMBRO, que é quando a fatura vence', async () => {
    const s = await montar([noCartao('2026-10-16', 40, 20)]);

    const outubro = await s.extratoDaPessoa('u1', 'rafael', '2026-10');
    expect(outubro.lancamentos).toHaveLength(0);
    expect(outubro.movimentoDoMes).toBe(0);

    const novembro = await s.extratoDaPessoa('u1', 'rafael', '2026-11');
    expect(novembro.lancamentos).toHaveLength(1);
    expect(novembro.movimentoDoMes).toBe(20);
  });

  it('no modo "compra" ela volta para outubro', async () => {
    const s = await montar([noCartao('2026-10-16', 40, 20)]);

    const outubro = await s.extratoDaPessoa('u1', 'rafael', '2026-10', 'compra');
    expect(outubro.lancamentos).toHaveLength(1);
    expect(outubro.movimentoDoMes).toBe(20);
  });

  // O saldo acumulado tem de enxergar a mesma coisa: uma compra que pertence
  // a novembro nao pode aparecer como "saldo anterior" de novembro.
  it('o saldo anterior respeita o mesmo mês', async () => {
    const s = await montar([noCartao('2026-10-16', 40, 20)]);

    const novembro = await s.extratoDaPessoa('u1', 'rafael', '2026-11');
    expect(novembro.saldoAnterior).toBe(0);
    expect(novembro.saldoFinal).toBe(20);

    const dezembro = await s.extratoDaPessoa('u1', 'rafael', '2026-12');
    expect(dezembro.saldoAnterior).toBe(20);
    expect(dezembro.lancamentos).toHaveLength(0);
  });

  it('gasto em conta não se move: não há fatura para esperar', async () => {
    const naConta = {
      id: 'dk', transactionId: 'tx-k', paidByPersonId: null,
      transaction: {
        amount: 40, description: 'Mercado',
        transactionDate: new Date('2026-10-16T00:00:00Z'),
        categoryId: 'cat', creditCardId: null, creditCard: null, invoiceMonthOverride: null,
      },
      shares: [{ personId: 'rafael', amount: 20, percent: null }],
    };
    const s = await montar([naConta]);

    expect((await s.extratoDaPessoa('u1', 'rafael', '2026-10')).lancamentos).toHaveLength(1);
    expect((await s.extratoDaPessoa('u1', 'rafael', '2026-11')).lancamentos).toHaveLength(0);
  });

  it('o impacto no relatório usa o mesmo mês que o relatório', async () => {
    const s = await montar([noCartao('2026-10-16', 40, 20)]);

    expect((await s.impactoNoMes('u1', '2026-10')).gastoDividido).toBe(0);
    expect((await s.impactoNoMes('u1', '2026-11')).gastoDividido).toBe(40);
  });

  it('o resumo não muda: dívida é acumulada, não tem mês', async () => {
    const s = await montar([noCartao('2026-10-16', 40, 20)]);
    const r = await s.resumo('u1');
    expect(r.pessoas[0].saldo).toBe(20);
  });
});
