// ============================================================
// conversa.service.spec.ts
// ============================================================
// A conversa inteira, sem rede: chega texto, sai resposta.
//
// A coisa mais importante provada aqui é o que NÃO acontece: nenhuma frase
// vira lançamento antes do "sim". Uma leitura errada gravada em silêncio só
// aparece dias depois, num saldo que não fecha.
// ============================================================

import { Prisma } from '@prisma/client';
import type { BankAccount, Category, CategoryRule, CreditCard } from '@prisma/client';

/** Decimal como o Prisma devolve, para o mock nao mentir sobre o tipo. */
const dec = (n: number) => new Prisma.Decimal(n);
import {
  ConversaService,
  diaDoUsuario,
  mesDaPergunta,
  nomeDoObjetivoDito,
  partesDoObjetivo,
  pedidoDeCriarObjetivo,
  prazoDoObjetivo,
  perguntaDeFatura,
  perguntaDeMaiores,
  perguntaDeMeta,
  perguntaDeObjetivos,
  perguntaDeResultado,
  perguntaDeSaldo,
  regimeDaPergunta,
} from './conversa.service';
import type {
  FaturasDoMes,
  ObjetivosDeHoje,
  PlanoDoMes,
  RelatorioService,
  ResultadoDoMes,
} from '../relatorio/relatorio.service';
import type { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import type { CreditCardsService } from '../credit-cards/credit-cards.service';
import type { GoalsService } from '../goals/goals.service';
import type { CategoriesService } from '../categories/categories.service';
import type { Cupom, CupomService } from './cupom.service';
import { assinaturaConfere, mensagensDoPayload, responder, semNumeros } from './meta';
import { createHmac } from 'node:crypto';

const DE = '5531988887777';
const msg = (texto: string, id = 'm' + Math.random()) => ({ de: DE, texto, id });

describe('ConversaService', () => {
  let service: ConversaService;
  let prisma: any;
  let transactions: any;
  let transfers: any;
  let transferidas: any[];
  let series: any[];
  let contaUnica: any;
  let movimentos: any[];
  /** As faturas VIRADAS que o banco devolve. Vazio no caminho normal; o teste
   * da virada põe uma aqui. */
  let viradasDoBanco: any[];
  /** Os cartões do usuário, alcançáveis pelo teste: um deles pode ter o mesmo
   * nome de uma conta que ainda não existe. */
  /** O cartão como a consulta o traz: com a linha do tempo do ciclo junto.
   * `cycles` vazio é o cartão que nunca mudou de vencimento. */
  let cartoes: (Pick<CreditCard, 'id' | 'name' | 'bankAccountId' | 'closingDay'> & {
    cycles: { validFrom: Date; closingDay: number; dueDay: number }[];
  })[];
  /** O serviço de categorias e o que ele criou — a criação pela mensagem passa
   * pelo mesmo caminho do formulário. */
  let servicoDeCategorias: any;
  let criadas: any[];
  let servicoDeContas: any;
  let contasCriadas: any[];
  let servicoDeCartoes: any;
  let servicoDeObjetivos: any;
  /** O que foi pedido ao servico de objetivos. */
  let movidos: any[];
  /** E os objetivos que ele foi mandado criar, como o pedido chegou. */
  let objetivosCriados: any[];
  /** Os objetivos como o banco os devolve para o contexto. */
  let objetivosDoBanco: any[];
  let cartoesCriados: any[];
  let whatsapp: any;
  let audio: any;
  /* Tipado como o servico: um mock solto poderia devolver um campo que o
   * leitor de cupom nao devolve, e o teste passaria defendendo uma crenca. */
  let lidoDoCupom: Cupom | null;
  let cupom: Pick<CupomService, 'disponivel' | 'ler'>;
  let criados: any[];
  let aprendidas: any[];
  let dono: string | null;
  let ouvido: string | null;
  /* O resultado do mes vem tipado de proposito: a conta de verdade esta
   * provada em relatorio.spec.ts, e o que se prova aqui e o TEXTO. Tipado,
   * este mock nao consegue inventar um campo que o servico nao devolve. */
  let resultado: ResultadoDoMes;
  let faturasDoMes: FaturasDoMes;
  let relatorio: Pick<
    RelatorioService,
    'doMes' | 'faturasDoMes' | 'maioresDoMes' | 'planoDoMes' | 'objetivos' | 'regime'
  >;
  /** O regime guardado no cadastro de quem perguntou. */
  let preferido: 'compra' | 'fatura';
  /** O ranking do mês, como o serviço o devolve. */
  let maiores: any;
  /* O planejamento do mês, TIPADO pelo mesmo motivo do resultado: a conta
   * está provada em relatorio.spec.ts, e o que se prova aqui é o texto. Um
   * mock solto poderia trazer um campo que o serviço não devolve, e o teste
   * passaria defendendo uma crença. */
  let plano: PlanoDoMes;
  /** Os objetivos, como o servico os devolve. Tipado pelo mesmo motivo dos
   * outros: o que se prova aqui e o TEXTO, e um mock solto poderia trazer um
   * campo que o servico nao tem. */
  let objetivos: ObjetivosDeHoje;

  beforeEach(() => {
    criados = [];
    transferidas = [];
    series = [];
    aprendidas = [];
    dono = 'user-1';
    ouvido = null;

    /* Os tipos do Prisma nas linhas de mentira, e não um objeto solto.
     *
     * Este mock foi escrito uma vez com `name` na conta, porque era isso que
     * eu achava que a coluna se chamava. O serviço lia `c.name` pela mesma
     * crença, os dois concordaram, e o teste passou verde enquanto, em
     * produção, nenhuma conta era encontrada — a coluna é `institutionName`.
     * Um mock tipado não consegue concordar com uma crença errada. */
    const contas: Pick<
      BankAccount,
      'id' | 'institutionName' | 'isActive' | 'isHidden' | 'currentBalance'
    >[] = [
      { id: 'a1', institutionName: 'Nubank', isActive: true, isHidden: false, currentBalance: dec(2500) },
      { id: 'a2', institutionName: 'Cofre', isActive: true, isHidden: false, currentBalance: dec(230) },
    ];
    contaUnica = contas[0];
    cartoes = [
      // Fecha dia 1: é o dia em que as duas regras de fatura do app discordam.
      { id: 'k1', name: 'Nubank Roxinho', bankAccountId: 'a1', closingDay: 1, cycles: [] },
    ];
    const categorias: Pick<Category, 'id' | 'name' | 'type' | 'parentId'>[] = [
      { id: 'c1', name: 'Alimentação', type: 'EXPENSE', parentId: null },
      { id: 'c9', name: 'Compras', type: 'EXPENSE', parentId: null },
      { id: 'c4', name: 'Freelance', type: 'INCOME', parentId: null },
    ];
    const regrasDoBanco: Pick<CategoryRule, 'merchant' | 'categoryId'>[] = [
      { merchant: 'magazine', categoryId: 'c9' },
    ];
    movimentos = [];
    viradasDoBanco = [];
    criadas = [];
    contasCriadas = [];
    cartoesCriados = [];

    prisma = {
      bankAccount: {
        findMany: jest.fn(async ({ where }: any) =>
          // O filtro de oculta/arquivada e o mesmo da tela de Resumo.
          where?.isHidden === false ? contas.filter((c) => !c.isHidden && c.isActive) : contas,
        ),
      },
      goalMovement: { findMany: jest.fn(async () => movimentos) },
      creditCard: { findMany: jest.fn(async () => cartoes) },
      // As faturas viradas do usuário. `viradasDoBanco` é vazio por padrão: o
      // caminho normal é o cartão que fecha no dia do calendário.
      creditCardInvoice: { findMany: jest.fn(async () => viradasDoBanco) },
      category: { findMany: jest.fn(async () => categorias) },
      // Os objetivos do dono da mensagem: e por eles que "apliquei 500 na
      // viagem" vira um id.
      goal: { findMany: jest.fn(async () => objetivosDoBanco) },
      categoryRule: {
        findMany: jest.fn(async () => regrasDoBanco),
        upsert: jest.fn(async (args: any) => {
          aprendidas.push(args);
          return {};
        }),
      },
    };

    transactions = {
      create: jest.fn(async (input: any) => {
        criados.push(input);
        return { id: 't1', ...input };
      }),
      createSeries: jest.fn(async (input: any, repeat: any) => {
        series.push({ input, repeat });
        return { series: { id: 's1' }, transactions: [] };
      }),
    };

    whatsapp = {
      donoDoTelefone: jest.fn(async () => dono),
      registrarUso: jest.fn(async () => undefined),
      vincularPorCodigo: jest.fn(async () => null),
    };

    // O transcritor entra por fora: aqui ele é uma função, e nenhum byte
    // sai para lugar nenhum.
    audio = {
      disponivel: jest.fn(() => ouvido !== null),
      ouvir: jest.fn(async () => ouvido),
    };

    lidoDoCupom = {
      valor: 182.94,
      data: '2026-10-30',
      parcelas: 1,
      estabelecimento: 'DMA Distribuidora',
    };
    cupom = {
      disponivel: jest.fn(() => true),
      ler: jest.fn(async () => lidoDoCupom),
    };

    transfers = {
      create: jest.fn(async (input: any) => {
        transferidas.push(input);
        return { id: 'tr1', ...input };
      }),
    };

    resultado = {
      mes: '2026-11',
      regime: 'fatura',
      entradas: 5000,
      saidas: 3200,
      resultado: 1800,
      vazio: false,
      lancamentos: 12,
      faturas: [
        {
          cartaoId: 'k1',
          cartao: 'Nubank Roxinho',
          referencia: '2026-11',
          vencimento: '2026-11-17',
          valor: 1200,
          status: 'OPEN',
          situacao: 'Aberta',
        },
      ],
    };
    faturasDoMes = {
      mes: '2026-11',
      total: 1500,
      faturas: [
        {
          cartaoId: 'k1',
          cartao: 'Nubank Roxinho',
          referencia: '2026-11',
          vencimento: '2026-11-17',
          valor: 1200,
          status: 'OPEN',
          situacao: 'Aberta',
        },
        {
          // Fecha 25 e vence 5: a fatura de outubro e cobrada em novembro.
          cartaoId: 'k2',
          cartao: 'Carrefour',
          referencia: '2026-10',
          vencimento: '2026-11-05',
          valor: 300,
          status: 'PAID',
          situacao: 'Paga',
        },
      ],
      cartoes: 2,
    };
    preferido = 'fatura';
    maiores = {
      mes: '2026-11',
      tipo: 'EXPENSE',
      regime: 'fatura',
      total: 550,
      restantes: 0,
      itens: [
        { categoria: 'Alimentação', valor: 350, lancamentos: 2, parte: 63.63 },
        { categoria: 'Transporte', valor: 200, lancamentos: 1, parte: 36.37 },
      ],
    };
    // Novembro planejado: teto de 3.000, meta de 800 em Alimentação (que já
    // usou 650, com a filha dentro) e 300 em Compras (que passou).
    plano = {
      mes: '2026-11',
      regime: 'fatura',
      temPlano: true,
      planejados: ['2026-11', '2026-10'],
      teto: 3000,
      gasto: 1150,
      resta: 1850,
      pct: 38,
      nivel: 'accent',
      repartido: 1100,
      sobraDoTeto: 1900,
      receitaEsperada: 6000,
      receitaLancada: 5000,
      filtros: { previsto: true, cartao: true, ocultas: false },
      linhas: [
        { id: 'c1', nome: 'Alimentação', filha: false, outras: false, meta: 800, gasto: 650, resta: 150, pct: 81, nivel: 'warn' },
        { id: 'c9', nome: 'Compras', filha: false, outras: false, meta: 300, gasto: 420, resta: -120, pct: 140, nivel: 'caro' },
        { id: null, nome: 'Outras categorias', filha: false, outras: true, meta: 1900, gasto: 80, resta: 1820, pct: 4, nivel: 'accent' },
      ],
    };
    /* Dois objetivos em andamento e um concluído, com o saldo inicial que
     * separa "guardado" de "aplicado das contas". */
    objetivos = {
      guardado: 3900,
      dasContas: 3300,
      inicial: 2000,
      quantos: 3,
      ativos: [
        { id: 'g1', nome: 'Viagem', meta: 12000, guardado: 2900, falta: 9100, pct: 24, prazo: '2027-06-30', meses: 8, mensal: 1137.5, atrasado: false, concluido: false, dasContas: 800 },
        { id: 'g2', nome: 'Notebook', meta: 5000, guardado: 1000, falta: 4000, pct: 20, prazo: '2026-10-31', meses: 1, mensal: 4000, atrasado: true, concluido: false, dasContas: 1000 },
      ],
      concluidos: [
        { id: 'g3', nome: 'Cadeira', meta: 1500, guardado: 1500, falta: 0, pct: 100, prazo: '2026-08-31', meses: 1, mensal: 0, atrasado: false, concluido: true, dasContas: 1500 },
      ],
    };
    relatorio = {
      doMes: jest.fn(async () => resultado),
      faturasDoMes: jest.fn(async () => faturasDoMes),
      maioresDoMes: jest.fn(async () => maiores),
      planoDoMes: jest.fn(async () => plano),
      objetivos: jest.fn(async () => objetivos),
      regime: jest.fn(async () => preferido),
    };

    servicoDeCartoes = {
      create: jest.fn(async ({ name, limitAmount, closingDay, dueDay }: any) => {
        const novo = { id: 'k-novo', name, limitAmount, closingDay, dueDay };
        cartoesCriados.push(novo);
        return novo;
      }),
    };

    servicoDeContas = {
      create: jest.fn(async ({ institutionName, accountType, initialBalance }: any) => {
        const nova = { id: 'acc-nova', institutionName, accountType, initialBalance };
        contasCriadas.push(nova);
        return nova;
      }),
    };

    servicoDeCategorias = {
      create: jest.fn(async ({ name, type }: any) => {
        const nova = { id: 'cat-nova', name, type, parentId: null };
        criadas.push(nova);
        return nova;
      }),
    };

    /* Aplicar e resgatar passam pelo serviço de objetivos — o mesmo do app.
     * O mock registra o que foi pedido; a trava do guardado é dele e está
     * provada em goals.service.spec, não aqui. */
    objetivosDoBanco = [
      { id: "g1", name: "Viagem", accountId: "a1", completedAt: null },
      { id: "g2", name: "Notebook", accountId: null, completedAt: new Date("2026-08-01T00:00:00.000Z") },
    ];
    movidos = [];
    objetivosCriados = [];
    servicoDeObjetivos = {
      /* Criar passa pelo MESMO serviço do formulário — é ele que confere o
       * prazo contra a data de início e guarda o valor como decimal. */
      create: jest.fn(async (entrada: any) => {
        objetivosCriados.push(entrada);
        return {
          id: 'g-novo',
          name: entrada.name,
          targetAmount: dec(entrada.targetAmount),
          startDate: new Date(entrada.startDate + 'T00:00:00.000Z'),
          targetDate: new Date(entrada.targetDate + 'T00:00:00.000Z'),
          initialBalance: dec(entrada.initialBalance ?? 0),
        };
      }),
      /* As contas do objetivo recém-criado. Os números são os de verdade para
       * R$ 6.000,00 até 31/12/2027 vistos em 10/11/2026 (14 meses contando o
       * corrente, 6000 ÷ 14 arredondado para cima) — a DIVISÃO está provada
       * em goals.service.spec; o que se prova aqui é o texto. */
      findOne: jest.fn(async () => ({
        appliedFromAccounts: '0.00',
        progress: {
          saved: '0.00',
          remaining: '6000.00',
          percent: 0,
          monthsLeft: 14,
          monthlyTarget: '428.58',
          onTrack: true,
        },
      })),
      aplicar: jest.fn(async (goalId: string, entrada: any) => {
        movidos.push({ goalId, tipo: 'DEPOSIT', ...entrada });
        return { id: 'mv-nova' };
      }),
      resgatar: jest.fn(async (goalId: string, entrada: any) => {
        movidos.push({ goalId, tipo: 'WITHDRAW', ...entrada });
        return { id: 'mv-nova' };
      }),
    };

    service = new ConversaService(
      prisma,
      transactions,
      transfers,
      whatsapp,
      audio,
      cupom as CupomService,
      relatorio as RelatorioService,
      servicoDeCategorias as CategoriesService,
      servicoDeContas as BankAccountsService,
      servicoDeCartoes as CreditCardsService,
      servicoDeObjetivos as GoalsService,
    );
  });

  describe('quem ainda nao conectou', () => {
    beforeEach(() => {
      dono = null;
    });

    it('recebe o mesmo recado, tenha conta ou nao', async () => {
      const r = await service.responderA(msg('oi'));
      expect(r?.texto).toMatch(/não reconheço este número/i);
      // E nada do que ele disser vira lançamento.
      expect(criados).toHaveLength(0);
    });

    it('mas o codigo de pareamento conecta', async () => {
      whatsapp.vincularPorCodigo = jest.fn(async () => ({ userId: 'user-1', ultimos4: '7777' }));
      const r = await service.responderA(msg('SALDO-K7P2M9QX'));
      expect(r?.texto).toMatch(/agora lança na sua conta/i);
    });
  });

  it('a frase vira um resumo, e NADA e gravado ainda', async () => {
    const r = await service.responderA(
      msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
    );
    expect(r?.texto).toContain('R$ 40,00');
    expect(r?.texto).toContain('Mercado');
    expect(r?.texto).toContain('Nubank');
    expect(r?.texto).toContain('Alimentação');
    expect(r?.texto).toMatch(/Confirma\?/);
    expect(criados).toHaveLength(0);
  });

  it('a conta e achada pelo nome que esta no banco', async () => {
    // O defeito que isto pega: a conta vinha sem nome do tradutor, o ditado
    // nao achava nenhuma, e a resposta dizia "Faltou destino" para uma frase
    // que nomeava a conta corretamente.
    const r = await service.responderA(msg('despesa de 10 reais no pix conta do nubank'));
    expect(r?.texto).toContain('Conta: Nubank');
    expect(r?.texto).not.toMatch(/Faltou destino/);
  });

  it('o sim grava, e so entao', async () => {
    await service.responderA(
      msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
    );
    const r = await service.responderA(msg('sim'));
    expect(criados).toHaveLength(1);
    expect(criados[0]).toMatchObject({
      userId: 'user-1',
      type: 'EXPENSE',
      amount: 40,
      categoryId: 'c1',
      bankAccountId: 'a1',
      description: 'Mercado',
      isConfirmed: true,
    });
    expect(r?.texto).toMatch(/^✅ Lançado\./);
  });

  describe('o lojista aprendido pelo WhatsApp', () => {
    // O WhatsApp lia as regras e nunca escrevia nenhuma: era o unico lugar
    // que nunca ficava mais esperto, justamente onde se lanca com pressa.
    async function lancar(frase: string) {
      await service.responderA(msg(frase));
      await service.responderA(msg('sim'));
    }

    it('guarda o lojista com a chave e o rotulo certos', async () => {
      await lancar('gastei 12 na padaria pelo debito da conta Nubank categoria alimentacao');
      expect(aprendidas).toHaveLength(1);
      expect(aprendidas[0].where.userId_merchant).toEqual({ userId: 'user-1', merchant: 'padaria' });
      // Chave normalizada para casar; rotulo como a pessoa escreveu, para ler.
      expect(aprendidas[0].create).toMatchObject({ merchant: 'padaria', label: 'Padaria', categoryId: 'c1' });
    });

    it('nao reescreve o que ja tem regra', async () => {
      // "magazine" ja esta na tabela, e foi ela que sugeriu Compras.
      await lancar('compra no pix na magazine valor de 10 pago nubank');
      expect(criados).toHaveLength(1);
      expect(aprendidas).toHaveLength(0);
    });

    it('lojista curto demais nao vira regra', async () => {
      await lancar('gastei 12 no bar pelo debito da conta Nubank categoria alimentacao');
      expect(criados).toHaveLength(1);
      expect(aprendidas).toHaveLength(0);
    });

    it('sem descricao nao ha lojista para aprender', async () => {
      await lancar('gastei 12 pelo debito da conta Nubank categoria alimentacao');
      expect(criados).toHaveLength(1);
      expect(aprendidas).toHaveLength(0);
    });

    it('falhar ao aprender nao faz o lancamento parecer que falhou', async () => {
      prisma.categoryRule.upsert = jest.fn(async () => {
        throw new Error('banco fora');
      });
      await service.responderA(msg('gastei 12 na padaria pelo debito da conta Nubank categoria alimentacao'));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(1);
      expect(r?.texto).toMatch(/^✅ Lançado\./);
    });
  });

  it('o nao joga fora', async () => {
    await service.responderA(msg('gastei 40 no debito da conta Nubank categoria alimentacao'));
    const r = await service.responderA(msg('não'));
    expect(criados).toHaveLength(0);
    expect(r?.texto).toMatch(/não lancei nada/i);
    // E o "sim" depois do "não" não ressuscita o rascunho.
    await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
  });

  it('sim sem rascunho nenhum e so mais uma frase', async () => {
    const r = await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
    expect(r?.texto).toMatch(/Faltou/);
  });

  it('a regra de lojista do usuario classifica, e o resumo diz de onde veio', async () => {
    const r = await service.responderA(msg('compra no pix na magazine valor de 10 pago nubank'));
    expect(r?.texto).toContain('Compras');
    expect(r?.texto).toContain('(do lojista)');
  });

  it('frase incompleta pergunta, e nao guarda rascunho', async () => {
    const r = await service.responderA(msg('gastei 30 reais'));
    expect(r?.texto).toMatch(/Faltou destino, categoria/);
    await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
  });

  describe('recado de voz', () => {
    it('sem transcritor configurado, diz que nao escuta', async () => {
      ouvido = null;
      const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      expect(r?.texto).toMatch(/não escuto áudio/i);
      expect(audio.ouvir).not.toHaveBeenCalled();
      expect(criados).toHaveLength(0);
    });

    it('o audio segue o MESMO caminho da frase digitada', async () => {
      ouvido = 'gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao';
      const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      // O que foi ouvido vem antes do resumo: e assim que a pessoa pega o
      // transcritor trocando uma palavra.
      expect(r?.texto).toMatch(/^Ouvi: /);
      expect(r?.texto).toContain('R$ 40,00');
      expect(r?.texto).toContain('Mercado');
      expect(r?.texto).toMatch(/Confirma\?/);
      expect(criados).toHaveLength(0);
    });

    it('e o sim depois do audio grava, como no texto', async () => {
      ouvido = 'gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao';
      await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      await service.responderA(msg('sim'));
      expect(criados).toHaveLength(1);
      expect(criados[0]).toMatchObject({ amount: 40, description: 'Mercado' });
    });

    it('audio que nao deu para entender pede de novo, sem inventar nada', async () => {
      ouvido = '';
      audio.disponivel = jest.fn(() => true);
      audio.ouvir = jest.fn(async () => null);
      const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      expect(r?.texto).toMatch(/não consegui entender o áudio/i);
      expect(criados).toHaveLength(0);
    });

    it('falar "sim" tambem confirma', async () => {
      ouvido = 'gastei 40 no debito da conta Nubank categoria alimentacao';
      await service.responderA({ de: DE, texto: '', id: 'm1', audioId: 'a1' });
      ouvido = 'sim';
      await service.responderA({ de: DE, texto: '', id: 'm2', audioId: 'a2' });
      expect(criados).toHaveLength(1);
    });
  });

  // A frase que o usuario mandou, inteira: "em dois dias" e data, e a
  // descricao e o que sobra depois dela.
  it('numero por extenso nao rouba o lugar da descricao', async () => {
    const r = await service.responderA(
      msg('Vou gastar em dois dias 10 na padaria pelo cartao de credito do nubank'),
    );
    expect(r?.texto).toContain('Descrição: Padaria');
    expect(r?.texto).not.toContain('Descrição: Dois');
  });

  describe('a pergunta de confirmacao pede botao', () => {
    // Digitar "sim" erra: um "aim" vira frase nova, que o app tenta ler como
    // lancamento. So a pergunta fechada ganha botao.
    it('a pergunta do lancamento vem marcada para botao', async () => {
      const r = await service.responderA(
        msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
      );
      expect(r?.confirmar).toBe(true);
    });

    it('a da transferencia tambem', async () => {
      const r = await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
      expect(r?.confirmar).toBe(true);
    });

    it('o que nao e pergunta nao ganha botao', async () => {
      const faltando = await service.responderA(msg('gastei 30 reais'));
      expect(faltando?.confirmar).toBeFalsy();
      await service.responderA(
        msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
      );
      const lancado = await service.responderA(msg('sim'));
      expect(lancado?.confirmar).toBeFalsy();
    });

    // Quem prefere digitar continua digitando: o botao e atalho.
    it('digitar sim continua lancando', async () => {
      await service.responderA(
        msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
      );
      await service.responderA(msg('sim'));
      expect(criados).toHaveLength(1);
    });
  });

  describe('quando o nome nao bate, a resposta diz quais existem', () => {
    // "Faltou destino" sozinho e um beco: quem esta no WhatsApp nao tem a tela
    // a mao para conferir se cadastrou "Itau" ou "Itau Corrente".
    it('no destino de despesa, lista contas e cartoes', async () => {
      const r = await service.responderA(msg('gastei 30 reais em alimentacao'));
      expect(r?.texto).toContain('Suas contas: Nubank, Cofre.');
      expect(r?.texto).toContain('Seus cartões: Nubank Roxinho.');
    });

    it('na transferencia, lista so as contas', async () => {
      const r = await service.responderA(msg('transferi 50 do Nubank'));
      expect(r?.texto).toContain('Suas contas: Nubank, Cofre.');
      expect(r?.texto).not.toContain('cartões');
    });

    // Categoria nao entra: sao dezenas, e a parede de texto nao ajuda.
    it('faltando so a categoria, nao despeja lista nenhuma', async () => {
      const r = await service.responderA(msg('gastei 30 reais no debito da conta Nubank'));
      expect(r?.texto).toMatch(/Faltou categoria/);
      expect(r?.texto).not.toContain('Suas contas');
    });
  });

  describe('foto de cupom fiscal', () => {
    const foto = (legenda = '', id = 'm' + Math.random()) => ({
      de: DE,
      texto: legenda,
      id,
      imagemId: 'img-1',
    });

    it('o cupom da valor e data; a legenda diz onde lancar', async () => {
      const r = await service.responderA(foto('cartao de credito nubank categoria compras'));
      expect(r?.texto).toContain('💵 Valor: R$ 182,94');
      expect(r?.texto).toContain('📅 Data: 30/10/2026');
      expect(r?.texto).toContain('💳 Cartão: Nubank Roxinho');
      expect(r?.texto).toContain('🏷️ Categoria: Compras');
      expect(r?.confirmar).toBe(true);
      // Nada gravado antes do sim, aqui tambem.
      expect(criados).toHaveLength(0);
    });

    it('o estabelecimento vira a descricao', async () => {
      const r = await service.responderA(foto('credito do nubank categoria compras'));
      expect(r?.texto).toContain('📝 Descrição: DMA Distribuidora');
    });

    it('a descricao da legenda ganha da do cupom', async () => {
      const r = await service.responderA(
        foto('credito do nubank categoria compras descricao almoco do time'),
      );
      expect(r?.texto).toContain('📝 Descrição: almoco do time');
    });

    it('a fatura segue a data do CUPOM, nao a do dia em que a foto chegou', async () => {
      // O cartao da fixture fecha dia 1: compra de 30/10 cai na fatura de
      // novembro. Se a data usada fosse a de hoje, seria outra fatura.
      const r = await service.responderA(foto('credito do nubank categoria compras'));
      expect(r?.texto).toContain('🧾 Fatura: 11/2026');
    });

    it('cupom parcelado reparte, e avisa o centavo', async () => {
      lidoDoCupom = { ...lidoDoCupom!, valor: 20, parcelas: 3 };
      const r = await service.responderA(foto('credito do nubank categoria compras'));
      expect(r?.texto).toContain('💵 Valor: R$ 6,67 por parcela');
      expect(r?.texto).toContain('🔢 Parcelas: 3x — total R$ 20,01 (R$ 20,00 não divide certo por 3)');
    });

    it('o sim grava o que foi lido', async () => {
      await service.responderA(foto('credito do nubank categoria compras'));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(1);
      expect(criados[0]).toMatchObject({
        amount: 182.94,
        // A data do cupom, e nao a do dia em que a foto chegou.
        transactionDate: new Date('2026-10-30T12:00:00.000Z'),
        creditCardId: 'k1',
        isConfirmed: true,
      });
      expect(r?.texto).toContain('Lançado');
    });

    it('foto sem legenda pergunta onde lancar, mostrando o que ja leu', async () => {
      const r = await service.responderA(foto(''));
      expect(r?.texto).toContain('💵 Valor: R$ 182,94');
      expect(r?.texto).toContain('Li o cupom, mas faltou destino, categoria.');
      expect(r?.texto).toContain('Suas contas: Nubank, Cofre');
      expect(r?.texto).toContain('Suas categorias de despesa:');
      expect(r?.confirmar).toBeFalsy();
    });

    it('cupom ilegivel diz o que fazer, e nao some', async () => {
      lidoDoCupom = null;
      const r = await service.responderA(foto('credito do nubank'));
      expect(r?.texto).toMatch(/n[ãa]o consegui ler esse cupom/i);
      expect(criados).toHaveLength(0);
    });

    it('sem leitor configurado, o app diz que nao enxerga', async () => {
      cupom.disponivel = jest.fn(() => false);
      const r = await service.responderA(foto('credito do nubank'));
      expect(r?.texto).toMatch(/ainda n[ãa]o leio foto/i);
      // E nenhum byte sai: nem tenta.
      expect(cupom.ler).not.toHaveBeenCalled();
    });

    it('o lojista aprendido classifica o cupom seguinte', async () => {
      // A regra da fixture e "magazine"; o estabelecimento do cupom passa
      // pela MESMA consulta que o formulario digitado faz.
      lidoDoCupom = { ...lidoDoCupom!, estabelecimento: 'Magazine Luiza' };
      const r = await service.responderA(foto('credito do nubank'));
      expect(r?.texto).toContain('🏷️ Categoria: Compras (do lojista)');
      expect(r?.confirmar).toBe(true);
    });
  });

  describe('o resumo, linha por linha', () => {
    /* O bloco inteiro num teste so, e nao um toContain por linha.
     *
     * O resumo e a UNICA coisa que a pessoa le antes de dizer "sim": e nele
     * que ela confere o que vai ser gravado. Uma linha que desaparece ou troca
     * de lugar passaria por quinze asserts soltos sem derrubar nenhum. Relogio
     * preso porque o bloco mostra a data.
     */
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('despesa simples, em conta', async () => {
      const r = await service.responderA(
        msg('gastei 10 reais no mercado pelo debito da conta nubank categoria alimentacao'),
      );
      expect(r?.texto).toBe(
        [
          '📉 Despesa',
          '💵 Valor: R$ 10,00',
          '📝 Descrição: Mercado',
          '🏦 Conta: Nubank',
          '🏷️ Categoria: Alimentação',
          '📅 Data: 10/11/2026',
          '✅ Situação: confirmado',
          '',
          'Confirma?',
        ].join('\n'),
      );
    });

    it('receita prevista', async () => {
      const r = await service.responderA(
        msg('vou receber 1500 do projeto do site na conta nubank categoria freelance dia 20'),
      );
      expect(r?.texto).toBe(
        [
          '📈 Receita',
          '💵 Valor: R$ 1.500,00',
          '📝 Descrição: Projeto do site',
          '🏦 Conta: Nubank',
          '🏷️ Categoria: Freelance',
          '📅 Data: 20/11/2026',
          '🕒 Situação: previsto',
          '',
          'Confirma?',
        ].join('\n'),
      );
    });

    it('parcelada no cartao, com fatura', async () => {
      const r = await service.responderA(
        msg('gastei 30 em 3x na padaria no cartao nubank categoria alimentacao'),
      );
      expect(r?.texto).toBe(
        [
          '📉 Despesa',
          '💵 Valor: R$ 10,00 por parcela',
          '📝 Descrição: Padaria',
          '🔢 Parcelas: 3x — total R$ 30,00',
          '💳 Cartão: Nubank Roxinho',
          '🏷️ Categoria: Alimentação',
          // O cartao da fixture fecha dia 1: comprando dia 10, a fatura e a
          // de dezembro.
          '🧾 Fatura: 12/2026',
          '📅 Data: 10/11/2026',
          '✅ Situação: confirmado',
          '',
          'Confirma?',
        ].join('\n'),
      );
    });

    it('transferencia usa as mesmas marcas', async () => {
      const r = await service.responderA(msg('transferi 200 do nubank para o cofre'));
      expect(r?.texto).toBe(
        [
          '🔄 Transferência',
          '💵 Valor: R$ 200,00',
          '🏦 Sai de: Nubank',
          '🏦 Entra em: Cofre',
          '📅 Data: 10/11/2026',
          '✅ Situação: confirmada',
          '',
          'Confirma?',
        ].join('\n'),
      );
    });
  });

  describe('a pergunta das maiores categorias', () => {
    it('responde o ranking, com a fatia e o total', async () => {
      const r = await service.responderA(msg('quais foram meus maiores gastos em novembro'));
      expect(r?.texto).toBe(
        [
          '📉 Maiores despesas de Novembro 2026',
          '',
          '🏷️ Alimentação: R$ 350,00 (64%)',
          '🏷️ Transporte: R$ 200,00 (36%)',
          '',
          '💵 Total: R$ 550,00',
          '',
          '🧮 Contado pelo vencimento da fatura: compra no cartão pesa no mês em que a fatura vence.',
        ].join('\n'),
      );
    });

    it('o mes dito na frase manda', async () => {
      await service.responderA(msg('maiores despesas de outubro'));
      expect(relatorio.maioresDoMes).toHaveBeenCalledWith('user-1', '2026-10', 'EXPENSE', 'fatura');
    });

    it('receita pede o outro tipo', async () => {
      await service.responderA(msg('quais minhas maiores receitas de novembro'));
      expect(relatorio.maioresDoMes).toHaveBeenCalledWith('user-1', '2026-11', 'INCOME', 'fatura');
    });

    it('a frase pode pedir o outro regime, so para aquela resposta', async () => {
      maiores = { ...maiores, regime: 'compra' };
      const r = await service.responderA(
        msg('maiores gastos de novembro pela data da compra'),
      );
      expect(relatorio.maioresDoMes).toHaveBeenCalledWith('user-1', '2026-11', 'EXPENSE', 'compra');
      expect(r?.texto).toContain('Contado pela data da compra, só nesta resposta.');
      // E o aviso de que a preferencia nao mudou.
      expect(r?.texto).toContain('continua sendo o vencimento da fatura');
    });

    it('mes sem nada responde pelo nome, sem lista vazia', async () => {
      maiores = { ...maiores, itens: [], total: 0, restantes: 0 };
      const r = await service.responderA(msg('maiores gastos de novembro'));
      expect(r?.texto).toContain('Sem despesas neste mês.');
      expect(r?.texto).not.toContain('Total');
    });

    it('com mais de cinco categorias, diz quantas ficaram de fora', async () => {
      maiores = { ...maiores, restantes: 3 };
      const r = await service.responderA(msg('maiores gastos de novembro'));
      expect(r?.texto).toContain('E mais 3 categorias.');
    });

    it('nao rouba a pergunta do resultado', async () => {
      await service.responderA(msg('qual meu resultado nesse mes'));
      expect(relatorio.maioresDoMes).not.toHaveBeenCalled();
      expect(relatorio.doMes).toHaveBeenCalled();
    });
  });

  describe('aplicar e resgatar no objetivo pela mensagem', () => {
    /* Relogio preso: a data entra no resumo e na confirmacao, e um teste
     * que depende do dia de hoje quebra sozinho na virada da meia-noite
     * -- foi o que aconteceu com a primeira versao deste bloco. */
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('a frase vira resumo, e nada se move antes do sim', async () => {
      const r = await service.responderA(msg('apliquei 500 na viagem'));
      expect(r?.texto).toBe(
        [
          '🎯 Aplicar no objetivo',
          '💵 Valor: R$ 500,00',
          '🏁 Objetivo: Viagem',
          // A conta sugerida do objetivo, sem ninguém dizer.
          '🏦 Sai da conta: Nubank',
          '📅 Data: 10/11/2026',
          '',
          'Confirma?',
        ].join('\n'),
      );
      expect(r?.confirmar).toBe(true);
      expect(movidos).toEqual([]);
    });

    it('o sim move pelo servico de objetivos, nao por escrita propria', async () => {
      await service.responderA(msg('apliquei 500 na viagem'));
      const r = await service.responderA(msg('sim'));
      expect(movidos).toHaveLength(1);
      expect(movidos[0]).toMatchObject({
        goalId: 'g1',
        tipo: 'DEPOSIT',
        bankAccountId: 'a1',
        amount: 500,
        movementDate: '2026-11-10',
      });
      // A chave de repetição vai junto: dois "sim" não guardam duas vezes.
      expect(movidos[0].clientKey).toMatch(/^wa-/);
      expect(r?.texto).toBe('✅ Aplicado. R$ 500,00 em 10/11/2026.');
    });

    it('resgatar e a outra direcao, pelo verbo', async () => {
      await service.responderA(msg('resgatei 200 do objetivo viagem'));
      const r = await service.responderA(msg('sim'));
      expect(movidos[0]).toMatchObject({ goalId: 'g1', tipo: 'WITHDRAW', amount: 200 });
      expect(r?.texto).toBe('✅ Resgatado. R$ 200,00 em 10/11/2026.');
    });

    it('a conta dita na frase ganha da sugerida pelo objetivo', async () => {
      await service.responderA(msg('guardei 300 na viagem pelo cofre'));
      await service.responderA(msg('sim'));
      expect(movidos[0]).toMatchObject({ bankAccountId: 'a2', amount: 300 });
    });

    /* A recusa do serviço é repassada como veio: o número que ela traz é o
     * que resolve a dúvida de quem mandou a mensagem. */
    it('resgate maior que o guardado devolve a frase do servico', async () => {
      servicoDeObjetivos.resgatar.mockRejectedValueOnce(
        Object.assign(new Error('O objetivo tem R$ 300,00 guardados — não dá para resgatar mais que isso.'), {
          status: 400,
        }),
      );
      await service.responderA(msg('resgatei 5000 do objetivo viagem'));
      const r = await service.responderA(msg('sim'));
      expect(r?.texto).toBe(
        '⚠️ O objetivo tem R$ 300,00 guardados — não dá para resgatar mais que isso.',
      );
    });

    it('falha de verdade nao vira mensagem de regra', async () => {
      servicoDeObjetivos.aplicar.mockRejectedValueOnce(new Error('ECONNRESET'));
      await service.responderA(msg('apliquei 500 na viagem'));
      const r = await service.responderA(msg('sim'));
      expect(r?.texto).toContain('Não consegui mexer no objetivo agora');
      expect(r?.texto).not.toContain('ECONNRESET');
    });

    it('objetivo concluido nao recebe aplicacao, e diz por que', async () => {
      const r = await service.responderA(msg('apliquei 100 no notebook'));
      expect(r?.texto).toContain('já foi concluído e não recebe novas aplicações');
      expect(r?.confirmar).toBeFalsy();
      expect(movidos).toEqual([]);
    });

    it('mas resgatar do concluido continua valendo', async () => {
      // A conta vai DITA: o Notebook nao tem conta sugerida, e com duas
      // contas cadastradas a frase sem conta e incompleta de verdade.
      await service.responderA(msg('resgatei 100 do notebook para o nubank'));
      await service.responderA(msg('sim'));
      expect(movidos[0]).toMatchObject({ goalId: 'g2', tipo: 'WITHDRAW', amount: 100 });
    });

    it('objetivo que nao existe lista os que existem, sem criar nada', async () => {
      const r = await service.responderA(msg('apliquei 100 no objetivo casa propria'));
      expect(r?.texto).toContain('Os seus são: Viagem, Notebook.');
      expect(movidos).toEqual([]);
    });

    it('sem objetivo cadastrado, manda criar um no app', async () => {
      objetivosDoBanco = [];
      const r = await service.responderA(msg('apliquei 100 no objetivo viagem'));
      expect(r?.texto).toContain('ainda não tem objetivo cadastrado');
    });

    /* O verbo sozinho não basta, e esta é a prova de que o lançamento comum
     * não foi sequestrado: "guardei 50 de gasolina" continua sendo despesa. */
    it('verbo sem objetivo continua sendo lancamento', async () => {
      const r = await service.responderA(msg('guardei 50 de gasolina no nubank'));
      expect(movidos).toEqual([]);
      expect(r?.texto).not.toContain('Aplicar no objetivo');
    });
  });

  describe('criar objetivo pela mensagem', () => {
    /* Relógio preso: a data de início do objetivo é hoje, e o prazo dito por
     * nome de mês depende de que mês é agora. Sem prender, estes testes
     * quebrariam sozinhos na virada do mês. */
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('a frase completa vira resumo, e nada nasce antes do sim', async () => {
      const r = await service.responderA(msg('criar objetivo Carro de 6000 até dezembro de 2027'));
      expect(r?.texto).toBe(
        [
          '🎯 Objetivo novo',
          // O nome sai com as maiúsculas de quem escreveu.
          '🏷️ Nome: Carro',
          '💰 Meta: R$ 6.000,00',
          // "Até dezembro" é dezembro INTEIRO, e não o dia 1º.
          '📅 Prazo: 31/12/2027',
          '',
          'Criar o objetivo Carro?',
        ].join('\n'),
      );
      expect(r?.confirmar).toBe(true);
      expect(objetivosCriados).toEqual([]);
    });

    /* O defeito que isto conserta: a frase tem dinheiro, e frase com dinheiro
     * nunca era pergunta — então ela caía na leitura de lançamento e voltava
     * como um rascunho de DESPESA de R$ 6.000,00 chamada "Criar objetivo
     * Carro". Quem pedia um objetivo recebia um gasto. */
    it('o pedido nao e mais lido como despesa', async () => {
      const r = await service.responderA(msg('criar objetivo Carro de 6000 até dezembro de 2027'));
      expect(r?.texto).not.toMatch(/Despesa/);
      expect(criados).toEqual([]);
    });

    it('o sim cria pelo servico do app, e a resposta diz o por mes', async () => {
      await service.responderA(msg('criar objetivo Carro de 6000 até dezembro de 2027'));
      const r = await service.responderA(msg('sim'));
      expect(objetivosCriados).toHaveLength(1);
      expect(objetivosCriados[0]).toMatchObject({
        userId: 'user-1',
        name: 'Carro',
        // Começa hoje, no fuso de quem falou.
        startDate: '2026-11-10',
        targetDate: '2027-12-31',
        targetAmount: 6000,
      });
      // Saldo inicial não é perguntado por aqui: nasce zero, e a resposta diz
      // onde se informa o que a pessoa já tem guardado fora do app.
      expect(objetivosCriados[0].initialBalance).toBeUndefined();
      expect(r?.texto).toBe(
        [
          '✅ Objetivo criado',
          '🏷️ Carro: R$ 0,00 de R$ 6.000,00 (0%)',
          '   Faltam R$ 6.000,00 · R$ 428,58 por mês até 31/12/2027',
          '',
          'Para guardar nele, mande: "apliquei 500 no objetivo Carro".',
          'Já tem dinheiro guardado fora do app? O saldo inicial é no app, em Objetivos.',
        ].join('\n'),
      );
    });

    it('le o nome composto, o "mil" e o mes com ano', async () => {
      const r = await service.responderA(
        msg('quero criar um objetivo chamado Casa de Praia, 12 mil até julho de 2027'),
      );
      expect(r?.texto).toContain('🏷️ Nome: Casa de Praia');
      expect(r?.texto).toContain('💰 Meta: R$ 12.000,00');
      expect(r?.texto).toContain('📅 Prazo: 31/07/2027');
    });

    it('sem nenhuma informacao, pergunta as tres', async () => {
      const r = await service.responderA(msg('quero criar um objetivo'));
      expect(r?.texto).toBe(
        [
          '🎯 Objetivo novo',
          '🏷️ Nome: —',
          '💰 Meta: —',
          '📅 Prazo: —',
          '',
          'Falta o nome, quanto você quer juntar e até quando.',
          '',
          '👉 Responda numa frase. Exemplo:',
          '',
          // O ano do exemplo sai de hoje: escrito à mão, ele envelheceria
          // para um exemplo que o próprio app recusaria.
          'Viagem, 6000 até dezembro de 2027',
          '',
          'Ou responda “não” para desistir.',
        ].join('\n'),
      );
      // Perguntar não é confirmar: os botões Sim/Cancelar não entram aqui.
      expect(r?.confirmar).toBeUndefined();
    });

    it('a resposta completa o rascunho, e o sim cria', async () => {
      await service.responderA(msg('quero criar um objetivo'));
      const r = await service.responderA(msg('Carro, 6000 até dezembro de 2027'));
      expect(r?.texto).toContain('Criar o objetivo Carro?');
      await service.responderA(msg('sim'));
      expect(objetivosCriados[0]).toMatchObject({ name: 'Carro', targetAmount: 6000 });
    });

    /* O nome já dado MANDA sobre o que a resposta trouxer: o leitor corta o
     * nome no primeiro número, e numa resposta como "6000" ele não acharia
     * nome nenhum — o nome do rascunho seria apagado pelo vazio. */
    it('o que ja esta no rascunho nao e apagado pela resposta', async () => {
      const pedido = await service.responderA(msg('criar objetivo Carro'));
      expect(pedido?.texto).toContain('Falta quanto você quer juntar e até quando.');
      expect(pedido?.texto).toContain('6000 até dezembro de 2027');
      const r = await service.responderA(msg('6000 até dezembro de 2027'));
      expect(r?.texto).toContain('🏷️ Nome: Carro');
      expect(r?.texto).toContain('Criar o objetivo Carro?');
    });

    it('mes sem ano e o proximo mes com aquele nome, nao o que passou', async () => {
      // Em novembro de 2026, "até março" é março de 2027.
      const r = await service.responderA(msg('criar objetivo Carro de 1000 até março'));
      expect(r?.texto).toContain('📅 Prazo: 31/03/2027');
      // E "até dezembro" ainda é o deste ano.
      const outro = await service.responderA(msg('não'));
      expect(outro?.texto).toBe('Ok, não criei o objetivo.');
      const dez = await service.responderA(msg('criar objetivo Casa de 1000 até dezembro'));
      expect(dez?.texto).toContain('📅 Prazo: 31/12/2026');
    });

    it('prazo que ja passou nao vira objetivo, e o resto do rascunho fica', async () => {
      const r = await service.responderA(msg('criar objetivo Carro de 6000 até 31/10/2026'));
      expect(r?.texto).toContain('31/10/2026 já passou. Falta até quando.');
      // O nome e a meta continuam lá: cobrar a frase toda de novo por causa
      // do prazo seria castigar quem acertou duas das três.
      expect(r?.texto).toContain('🏷️ Nome: Carro');
      expect(r?.texto).toContain('💰 Meta: R$ 6.000,00');
      expect(objetivosCriados).toEqual([]);
    });

    /* Dois objetivos com o mesmo nome quebrariam o aplicar: "apliquei 500 no
     * objetivo viagem" escolhe PELO NOME, e o dinheiro entraria no que a
     * busca achasse primeiro. */
    it('nome repetido nao vira objetivo gemeo', async () => {
      const r = await service.responderA(msg('criar objetivo Viagem de 6000 até dezembro de 2027'));
      expect(r?.texto).toBe(
        [
          '🎯 Você já tem um objetivo chamado Viagem.',
          '',
          'Para guardar nele, mande: "apliquei 500 no objetivo Viagem". ' +
            'Para mudar a meta ou o prazo, é no app, em Objetivos.',
        ].join('\n'),
      );
      // E o "sim" seguinte não cria nada: não ficou rascunho nenhum.
      await service.responderA(msg('sim'));
      expect(objetivosCriados).toEqual([]);
    });

    it('a resposta que nao traz nada diz isso, em vez de repetir igual', async () => {
      await service.responderA(msg('criar objetivo Carro'));
      const r = await service.responderA(msg('não sei ainda'));
      expect(r?.texto).toContain('Não entendi. Falta quanto você quer juntar e até quando.');
    });

    /* Objetivo não precisa de conta nem de cartão para existir — a conta
     * entra na hora de aplicar. Quem instalou o app hoje e quer começar a
     * guardar dinheiro não pode ser mandado embora. */
    it('funciona para quem ainda nao tem conta nem cartao', async () => {
      prisma.bankAccount.findMany = jest.fn(async () => []);
      prisma.creditCard.findMany = jest.fn(async () => []);
      const r = await service.responderA(msg('criar objetivo Carro de 6000 até dezembro de 2027'));
      expect(r?.texto).toContain('Criar o objetivo Carro?');
      expect(r?.texto).not.toMatch(/cadastre uma conta/i);
    });

    it('a pergunta dos objetivos continua respondendo a lista', async () => {
      // A leitura do pedido de criar não pode roubar a consulta.
      const r = await service.responderA(msg('quais objetivos eu tenho'));
      expect(r?.texto).toContain('🎯 Guardado nos objetivos: R$ 3.900,00');
    });
  });

  describe('a pergunta dos objetivos', () => {
    it('responde o guardado, cada objetivo e de onde o dinheiro veio', async () => {
      const r = await service.responderA(
        msg('quanto tenho guardado nos meus objetivos hoje?'),
      );
      expect(r?.texto).toBe(
        [
          '🎯 Guardado nos objetivos: R$ 3.900,00',
          '2 objetivos em andamento',
          '',
          '🏷️ Viagem: R$ 2.900,00 de R$ 12.000,00 (24%)',
          '   Faltam R$ 9.100,00 · R$ 1.137,50 por mês até 30/06/2027',
          '🏷️ Notebook: R$ 1.000,00 de R$ 5.000,00 (20%)',
          // Prazo vencido não ganha um "por mês": seria "tudo neste mês",
          // que não é um plano.
          '   Faltam R$ 4.000,00 · o prazo venceu em 31/10/2026',
          '',
          'De onde vem o guardado',
          '💰 Aplicado das contas: R$ 3.300,00 — saiu de uma conta e continua no seu saldo.',
          '🪙 Saldo inicial: R$ 2.000,00 — dinheiro que já era seu, fora das contas.',
          '',
          '✅ 1 objetivo concluído: Cadeira.',
        ].join('\n'),
      );
      expect(relatorio.objetivos).toHaveBeenCalledWith('user-1');
    });

    it('objetivo alcancado nao pede mais nada por mes', async () => {
      objetivos = {
        ...objetivos,
        ativos: [{ ...objetivos.ativos[0], guardado: 12000, falta: 0, pct: 100 }],
      };
      const r = await service.responderA(msg('quanto tenho guardado?'));
      expect(r?.texto).toContain('Meta alcançada 🎉');
      expect(r?.texto).not.toContain('por mês');
    });

    it('sem objetivo nenhum, diz onde se cria um', async () => {
      objetivos = { guardado: 0, dasContas: 0, inicial: 0, quantos: 0, ativos: [], concluidos: [] };
      const r = await service.responderA(msg('quanto tenho guardado nos objetivos?'));
      expect(r?.texto).toContain('Você ainda não tem objetivo cadastrado');
      expect(r?.texto).not.toContain('R$ 0,00');
    });

    it('todos concluidos nao viram "R$ 0,00 guardado"', async () => {
      // Seria verdade sobre os em andamento e mentira sobre o esforço da
      // pessoa, que está logo abaixo na mesma resposta.
      objetivos = { ...objetivos, guardado: 0, ativos: [] };
      const r = await service.responderA(msg('quanto tenho guardado nos objetivos?'));
      expect(r?.texto).toContain('Nenhum objetivo em andamento agora.');
      expect(r?.texto).toContain('✅ 1 objetivo concluído: Cadeira.');
      expect(r?.texto).not.toContain('Guardado nos objetivos: R$ 0,00');
    });

    it('com mais de cinco, a lista corta e diz onde ver o resto', async () => {
      const muitos = Array.from({ length: 7 }, (_, i) => ({
        ...objetivos.ativos[0],
        id: 'g' + i,
        nome: 'Objetivo ' + i,
      }));
      objetivos = { ...objetivos, ativos: muitos };
      const r = await service.responderA(msg('quanto tenho guardado nos objetivos?'));
      expect(r?.texto).toContain('… e mais 2 no app.');
      expect(r?.texto).not.toContain('Objetivo 5');
    });

    /* As vizinhas. A de saldo é a que mais encosta: "quanto tenho guardado"
     * casa com o `quanto tenho` dela. */
    it('"quanto tenho guardado" e objetivo, nao saldo', async () => {
      const r = await service.responderA(msg('quanto tenho guardado hoje?'));
      expect(relatorio.objetivos).toHaveBeenCalled();
      expect(r?.texto).toContain('Guardado nos objetivos');
    });

    it('nao rouba a pergunta de saldo', async () => {
      const r = await service.responderA(msg('qual meu saldo?'));
      expect(relatorio.objetivos).not.toHaveBeenCalled();
      expect(r?.texto).toContain('Saldo de hoje');
    });

    it('objetivo nomeado ganha do planejamento, mesmo falando em meta', async () => {
      // "meta" quer dizer coisas diferentes nas duas telas: aqui é o alvo do
      // objetivo, lá é o teto da categoria no mês.
      const r = await service.responderA(msg('quanto falta para a meta do meu objetivo da viagem?'));
      expect(relatorio.planoDoMes).not.toHaveBeenCalled();
      expect(r?.texto).toContain('Guardado nos objetivos');
    });

    it('frase com dinheiro nao e pergunta, e segue sendo lancamento', async () => {
      await service.responderA(msg('guardei 500 na viagem'));
      expect(relatorio.objetivos).not.toHaveBeenCalled();
    });
  });

  describe('a pergunta do planejamento', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    /** A categoria com meta, como o serviço a devolve quando a frase a
     * nomeia. */
    const comAlimentacao = () => ({
      ...plano,
      categoria: {
        id: 'c1', nome: 'Alimentação', filha: false, outras: false,
        temMeta: true, meta: 800, gasto: 650, resta: 150, pct: 81, nivel: 'warn', filhas: 0,
      },
    });

    it('uma categoria: meta, usado e o que ainda cabe', async () => {
      plano = comAlimentacao();
      const r = await service.responderA(
        msg('quanto ainda posso gastar com alimentacao neste mes?'),
      );
      expect(r?.texto).toBe(
        [
          '🎯 Alimentação em Novembro 2026',
          '',
          '🏷️ Meta: R$ 800,00',
          '📉 Já usou: R$ 650,00 (81%)',
          '✅ Ainda cabem: R$ 150,00',
          '',
          '💵 No mês: R$ 1.150,00 de R$ 3.000,00 planejados · ainda cabem R$ 1.850,00',
          '',
          '🧮 Contado pelo vencimento da fatura: compra no cartão pesa no mês em que a fatura vence.',
          '💡 Contando confirmado e previsto, com os gastos no cartão — como a tela de Planejamento abre.',
        ].join('\n'),
      );
      // A categoria dita sai da frase pela mesma porta do lançamento, e vai
      // RESOLVIDA para a conta: o nome fica na conversa, o id no cálculo.
      expect(relatorio.planoDoMes).toHaveBeenCalledWith('user-1', '2026-11', 'fatura', 'c1');
    });

    it('passar da meta diz quanto passou, e nao um numero negativo', async () => {
      plano = {
        ...plano,
        categoria: {
          id: 'c9', nome: 'Compras', filha: false, outras: false,
          temMeta: true, meta: 300, gasto: 420, resta: -120, pct: 140, nivel: 'caro', filhas: 0,
        },
      };
      const r = await service.responderA(msg('quanto ainda posso gastar com compras esse mes?'));
      expect(r?.texto).toContain('🔺 Passou em: R$ 120,00');
      expect(r?.texto).not.toContain('-R$');
    });

    it('o mes inteiro, quando a frase nao nomeia categoria', async () => {
      const r = await service.responderA(msg('quanto ainda posso gastar neste mes?'));
      expect(r?.texto).toBe(
        [
          '🎯 Planejamento de Novembro 2026',
          '',
          '💵 Teto: R$ 3.000,00',
          '📉 Já usou: R$ 1.150,00 (38%)',
          '✅ Ainda cabem: R$ 1.850,00',
          '',
          '📈 Receitas: R$ 5.000,00 · você esperava R$ 6.000,00',
          '',
          '🏷️ Alimentação: R$ 650,00 de R$ 800,00 · cabem R$ 150,00',
          '🏷️ Compras: R$ 420,00 de R$ 300,00 · passou R$ 120,00',
          '🏷️ Outras categorias: R$ 80,00 de R$ 1.900,00 · cabem R$ 1.820,00',
          '',
          '🧮 Contado pelo vencimento da fatura: compra no cartão pesa no mês em que a fatura vence.',
          '💡 Contando confirmado e previsto, com os gastos no cartão — como a tela de Planejamento abre.',
        ].join('\n'),
      );
      expect(relatorio.planoDoMes).toHaveBeenCalledWith('user-1', '2026-11', 'fatura', null);
    });

    it('sem planejamento no mes, oferece copiar de um mes planejado', async () => {
      plano = { mes: '2026-12', regime: 'fatura', temPlano: false, planejados: ['2026-11'], linhas: [] };
      const r = await service.responderA(msg('quanto posso gastar em dezembro?'));
      expect(r?.texto).toBe(
        [
          '🎯 Planejamento de Dezembro 2026',
          '',
          'Você ainda não definiu um teto, então não tenho com o que comparar os seus gastos.',
          '',
          'No app, em Planejamento, dá para copiar o de Novembro 2026 ou começar do zero.',
        ].join('\n'),
      );
      expect(relatorio.planoDoMes).toHaveBeenCalledWith('user-1', '2026-12', 'fatura', null);
    });

    /* O mes herdado: a resposta tem numero (e para isso que a heranca
     * existe), mas diz de onde o teto veio ANTES dos numeros -- um "passou em
     * R$ 1.200,00" contra uma meta que a pessoa nao escolheu para este mes
     * seria acusacao sem procedencia, e o que falta nao e cortar gasto, e
     * decidir o mes. */
    it('mes herdado diz de onde veio o teto, antes dos numeros', async () => {
      plano = { ...plano, mes: '2026-12', herdadoDe: '2026-11' };
      const r = await service.responderA(msg('quanto ainda posso gastar em dezembro?'));
      expect(r?.texto).toContain(
        '📋 Teto herdado de Novembro 2026, que se repetiu até aqui.',
      );
      // Antes do teto, e nao no rodape: lido depois do veredito, chegou tarde.
      const linhas = (r?.texto ?? '').split('\n');
      expect(linhas.indexOf('📋 Teto herdado de Novembro 2026, que se repetiu até aqui.'))
        .toBeLessThan(linhas.findIndex((l) => l.startsWith('💵 Teto')));
    });

    it('mes decidido nao fala de heranca nenhuma', async () => {
      const r = await service.responderA(msg('quanto ainda posso gastar neste mes?'));
      expect(r?.texto).not.toContain('herdado');
    });

    it('a categoria tambem leva a procedencia do teto', async () => {
      plano = { ...comAlimentacao(), mes: '2026-12', herdadoDe: '2026-11' };
      const r = await service.responderA(
        msg('quanto ainda posso gastar com alimentacao em dezembro?'),
      );
      expect(r?.texto).toContain('📋 Teto herdado de Novembro 2026');
      expect(r?.texto).toContain('🏷️ Meta: R$ 800,00');
    });

    it('sem planejamento NENHUM, explica o que e o planejamento', async () => {
      plano = { mes: '2026-11', regime: 'fatura', temPlano: false, planejados: [], linhas: [] };
      const r = await service.responderA(msg('quanto ainda posso gastar esse mes?'));
      expect(r?.texto).toContain('você diz quanto quer gastar no mês e reparte');
      expect(r?.texto).not.toContain('copiar');
    });

    it('categoria sem meta propria mostra a meta da pai, que e a que limita', async () => {
      plano = {
        ...plano,
        categoria: {
          id: 'c1a', nome: 'Mercado', filha: true, outras: false,
          temMeta: false, meta: 0, gasto: 150, resta: -150, pct: 100, nivel: 'caro', filhas: 0,
        },
        paiComMeta: {
          id: 'c1', nome: 'Alimentação', filha: false, outras: false,
          meta: 800, gasto: 650, resta: 150, pct: 81, nivel: 'warn',
        },
      };
      const r = await service.responderA(msg('quanto ainda posso gastar no mercado esse mes?'));
      expect(r?.texto).toBe(
        [
          '🎯 Mercado em Novembro 2026',
          '',
          'Mercado não tem meta neste planejamento.',
          '📉 Já usou: R$ 150,00',
          '',
          'Esse gasto entra em Alimentação, que tem meta:',
          '🏷️ Alimentação: R$ 650,00 de R$ 800,00 · cabem R$ 150,00',
          '',
          '💵 No mês: R$ 1.150,00 de R$ 3.000,00 planejados · ainda cabem R$ 1.850,00',
          '',
          '🧮 Contado pelo vencimento da fatura: compra no cartão pesa no mês em que a fatura vence.',
          '💡 Contando confirmado e previsto, com os gastos no cartão — como a tela de Planejamento abre.',
        ].join('\n'),
      );
      // E nada de "passou em R$ 150,00": sem meta não há o que estourar, e
      // `nivel: caro` do recorte quer dizer outra coisa (gastou sem meta).
      expect(r?.texto).not.toContain('Passou');
    });

    it('categoria sem meta e sem pai cai no resto do teto', async () => {
      plano = {
        ...plano,
        categoria: {
          id: 'c3', nome: 'Lazer', filha: false, outras: false,
          temMeta: false, meta: 0, gasto: 80, resta: -80, pct: 100, nivel: 'caro', filhas: 0,
        },
      };
      const r = await service.responderA(msg('quanto ainda posso gastar com lazer esse mes?'));
      expect(r?.texto).toContain('Ela entra no que sobrou do teto, junto com as outras sem meta:');
      expect(r?.texto).toContain('🏷️ Outras categorias: R$ 80,00 de R$ 1.900,00 · cabem R$ 1.820,00');
    });

    it('a frase pode pedir o outro regime, so para aquela resposta', async () => {
      plano = { ...comAlimentacao(), regime: 'compra' };
      const r = await service.responderA(
        msg('quanto ainda posso gastar com alimentacao esse mes pela data da compra?'),
      );
      expect(relatorio.planoDoMes).toHaveBeenCalledWith('user-1', '2026-11', 'compra', 'c1');
      expect(r?.texto).toContain('Contado pela data da compra, só nesta resposta.');
      expect(r?.texto).toContain('continua sendo o vencimento da fatura');
    });

    it('o teto zerado nao vira "0%", que diria que esta tudo bem', async () => {
      plano = { ...plano, teto: 0, gasto: 400, resta: 0, pct: 100, nivel: 'caro', linhas: [] };
      const r = await service.responderA(msg('qual meu planejamento desse mes?'));
      expect(r?.texto).toContain('Nenhum teto definido para o mês.');
      expect(r?.texto).toContain('Já gastou: R$ 400,00');
      expect(r?.texto).not.toContain('Ainda cabem');
    });

    // ---- as vizinhas, que esta pergunta NÃO pode roubar ----

    it('nao rouba a pergunta de saldo', async () => {
      await service.responderA(msg('qual meu saldo?'));
      expect(relatorio.planoDoMes).not.toHaveBeenCalled();
    });

    it('nao rouba a pergunta do resultado', async () => {
      await service.responderA(msg('qual meu resultado nesse mes'));
      expect(relatorio.planoDoMes).not.toHaveBeenCalled();
      expect(relatorio.doMes).toHaveBeenCalled();
    });

    it('nao rouba a pergunta da fatura', async () => {
      await service.responderA(msg('quanto ainda posso gastar na fatura do nubank?'));
      expect(relatorio.planoDoMes).not.toHaveBeenCalled();
      expect(relatorio.faturasDoMes).toHaveBeenCalled();
    });

    /* O contrário das três de cima: estas DUAS frases caem nas vizinhas se a
     * pergunta do planejamento for lida depois delas — e a pessoa receberia
     * um número certo para a pergunta errada. */
    it('"quanto tenho para gastar" e planejamento, nao saldo', async () => {
      // Sem "ainda" a frase casa com o `quanto tenho` da pergunta de saldo, e
      // a pessoa receberia o dinheiro que tem no banco no lugar do que ainda
      // cabe no mês — dois números bem diferentes.
      const r = await service.responderA(msg('quanto tenho para gastar esse mes?'));
      expect(relatorio.planoDoMes).toHaveBeenCalled();
      expect(r?.texto).toContain('Planejamento de Novembro 2026');
    });

    it('"quanto gastei da meta" e planejamento, nao resultado', async () => {
      plano = comAlimentacao();
      const r = await service.responderA(msg('quanto gastei da meta de alimentacao esse mes?'));
      expect(relatorio.doMes).not.toHaveBeenCalled();
      expect(r?.texto).toContain('Alimentação em Novembro 2026');
    });

    it('frase com dinheiro nao e pergunta, e segue sendo lancamento', async () => {
      await service.responderA(msg('gastei 50 no mercado categoria alimentacao'));
      expect(relatorio.planoDoMes).not.toHaveBeenCalled();
    });
  });

  describe('quando o cartao dito nao existe', () => {
    const frase = 'gastei 95 na igreja no cartao c6 bank categoria alimentacao';

    it('o limite tambem cabe na resposta, quando vem nomeado', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('1 e 10, limite 5000'));
      expect(r?.texto).toContain('limite R$ 5.000,00');
      await service.responderA(msg('sim'));
      expect(cartoesCriados[0]).toMatchObject({ limitAmount: 5000, closingDay: 1, dueDay: 10 });
    });

    it('o numero do limite nao disputa lugar com os dias', async () => {
      // "5000" tem "50" e "00" dentro: sem tirar o trecho do limite da frase,
      // o fechamento viraria 50 (recusado) ou pior, um dia qualquer.
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('limite 5000, fecha 1 vence 10'));
      expect(r?.texto).toContain('fecha dia 1, vence dia 10');
      expect(r?.texto).toContain('limite R$ 5.000,00');
    });

    it('limite com R$ e separador de milhar', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('1 e 10, limite R$ 5.000,00'));
      expect(r?.texto).toContain('limite R$ 5.000,00');
    });

    it('sem a palavra limite, numero nenhum vira limite', async () => {
      // "1, 10 e 20" e ambiguo de proposito: pode ser dia 20 ou vinte reais.
      // O app nao adivinha -- o limite fica zero, e muda no app.
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('1, 10 e 20'));
      expect(r?.texto).toContain('limite R$ 0,00');
    });

    it('pergunta os dois dias, e NAO cria nada ainda', async () => {
      const r = await service.responderA(msg(frase));
      // O bloco inteiro, e nao pedacos: e ele que a pessoa le antes de
      // responder, e uma linha fora de lugar aqui vira uma resposta errada.
      expect(r?.texto).toBe(
        [
          '💳 Cartão C6 bank',
          '',
          'Não encontrei esse cartão cadastrado.',
          '',
          'Para criar, preciso de duas informações:',
          '',
          '📅 Dia do fechamento da fatura',
          '📆 Dia do vencimento da fatura',
          '',
          '👉 Responda com os dois dias, nessa ordem. Exemplo:',
          '',
          '1 e 10',
          '',
          '💰 Se quiser, informe também o limite:',
          '',
          '1 e 10, limite 5000',
        ].join('\n'),
      );
      // Sem botoes: a resposta esperada e um par de numeros, nao um sim.
      expect(r?.confirmar).toBeFalsy();
      expect(cartoesCriados).toHaveLength(0);
    });

    it('os dois dias chegam na resposta seguinte, e so entao vem o Confirma', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('1 e 10'));
      expect(r?.texto).toContain('Criar o cartão C6 bank (fecha dia 1, vence dia 10, limite R$ 0,00) e lançar?');
      expect(r?.confirmar).toBe(true);
      expect(cartoesCriados).toHaveLength(0);
      expect(criados).toHaveLength(0);
    });

    it('o sim cria o cartao e lanca nele', async () => {
      await service.responderA(msg(frase));
      await service.responderA(msg('1 e 10'));
      const r = await service.responderA(msg('sim'));

      expect(cartoesCriados).toEqual([
        { id: 'k-novo', name: 'C6 bank', limitAmount: 0, closingDay: 1, dueDay: 10 },
      ]);
      expect(criados[0]).toMatchObject({ creditCardId: 'k-novo', amount: 95 });
      expect(r?.texto).toMatch(/^✅ Lançado\./);
    });

    it('dizer os dias na propria frase NAO e atalho: a data e que seria lida', async () => {
      // Medido: "dia 1" vira a DATA da compra pelo leitor de sempre, e o nome
      // sai "C6 bank que fecha". Por isso a pergunta e sempre uma, separada.
      const r = await service.responderA(
        msg('gastei 95 na igreja no cartao c6 bank que fecha dia 1 e vence dia 10 categoria alimentacao'),
      );
      expect(r?.texto).not.toContain('Criar o cartão');
    });

    it('a fatura do resumo sai dos dias que a pessoa acabou de dizer', async () => {
      // Fecha dia 1: a compra de hoje vai para a fatura do mes seguinte.
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('1 e 10'));
      const hoje = new Date();
      const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
      const esperado = String(proxima.getMonth() + 1).padStart(2, '0') + '/' + proxima.getFullYear();
      expect(r?.texto).toContain('Fatura: ' + esperado);
    });

    it('resposta sem dois numeros repete o pedido, sem perder o rascunho', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('nao sei'));
      expect(r?.texto).toContain('💳 Cartão C6 bank');
      expect(r?.texto).toContain('Não entendi os dias');
      expect(r?.texto).toContain('limite 5000');
      expect(r?.texto).toContain('Ou responda “não” para desistir.');
      // O rascunho continua de pe: os dias chegam na proxima.
      const ok = await service.responderA(msg('1 e 10'));
      expect(ok?.confirmar).toBe(true);
    });

    it('dia impossivel nao passa', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('45 e 60'));
      expect(r?.texto).toContain('dois números de 1 a 31');
    });

    it('o nao desiste do cartao e do lancamento', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('nao'));
      expect(r?.texto).toBe('Ok, não lancei nada.');
      expect(cartoesCriados).toHaveLength(0);
      expect(criados).toHaveLength(0);
    });

    it('cartao que JA existe nao vira cartao novo', async () => {
      const r = await service.responderA(
        msg('gastei 95 no cartao NUBANK ROXINHO categoria alimentacao'),
      );
      expect(r?.texto).toContain('💳 Cartão: Nubank Roxinho');
      expect(r?.texto).toContain('Confirma?');
      await service.responderA(msg('sim'));
      expect(cartoesCriados).toHaveLength(0);
      expect(criados[0]).toMatchObject({ creditCardId: 'k1' });
    });

    it('o cartao falhando, o lancamento nao acontece', async () => {
      servicoDeCartoes.create = jest.fn(async () => {
        throw new Error('caiu');
      });
      await service.responderA(msg(frase));
      await service.responderA(msg('1 e 10'));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(0);
      expect(r?.texto).toContain('Não consegui criar o cartão C6 bank');
    });
  });

  describe('quando a conta dita nao existe', () => {
    const frase = 'gastei 50 na igreja no debito da conta picpay categoria alimentacao';

    it('nome que e de um CARTAO ainda cria a conta, quando a frase diz conta', async () => {
      // O caso que o usuario encontrou: PicPay e cartao E conta. Dizendo "no
      // debito da conta PicPay" ele recebia "Faltou destino" -- com o PICPAY
      // dele aparecendo na lista de cartoes da propria resposta.
      cartoes.push({ id: 'k9', name: 'PicPay', bankAccountId: null, closingDay: 10, cycles: [] } as any);
      const r = await service.responderA(msg(frase));
      expect(r?.texto).toContain('Você ainda não tem a conta Picpay. Criar');
      expect(r?.confirmar).toBe(true);
    });

    it('oferece criar, dizendo o saldo com que ela nasce', async () => {
      const r = await service.responderA(msg(frase));
      expect(r?.texto).toContain(
        'Você ainda não tem a conta Picpay. Criar (conta corrente, saldo R$ 0,00) e lançar?',
      );
      expect(r?.confirmar).toBe(true);
      expect(contasCriadas).toHaveLength(0);
      expect(criados).toHaveLength(0);
    });

    it('o sim cria a conta e lanca nela', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('sim'));
      expect(contasCriadas).toEqual([
        { id: 'acc-nova', institutionName: 'Picpay', accountType: 'CHECKING', initialBalance: 0 },
      ]);
      expect(criados[0]).toMatchObject({ bankAccountId: 'acc-nova', amount: 50 });
      expect(r?.texto).toMatch(/^✅ Lançado\./);
    });

    it('conta que JA existe nao vira conta nova, nem escrita diferente', async () => {
      const r = await service.responderA(msg('gastei 50 no debito da conta NUBANK categoria alimentacao'));
      expect(r?.texto).toContain('🏦 Conta: Nubank');
      expect(r?.texto).toContain('Confirma?');
      await service.responderA(msg('sim'));
      expect(contasCriadas).toHaveLength(0);
      expect(criados[0]).toMatchObject({ bankAccountId: 'a1' });
    });

    it('pagar A conta de luz nao oferece conta nenhuma', async () => {
      // "a conta de luz" e "da conta PicPay" tem a palavra conta no mesmo
      // lugar; o que separa as duas e a preposicao.
      const r = await service.responderA(msg('paguei a conta de luz de 120 no pix categoria alimentacao'));
      expect(r?.texto).not.toContain('Criar (conta corrente');
    });

    it('no cartao, o nome que falta nao vira conta', async () => {
      const r = await service.responderA(msg('comprei 50 no cartao picpay categoria alimentacao'));
      expect(r?.texto).not.toContain('Criar (conta corrente');
    });

    it('a conta e a categoria faltando: pergunta uma coisa de cada vez', async () => {
      const r = await service.responderA(msg('gastei 50 no debito da conta picpay categoria doacao'));
      expect(r?.texto).toContain('Faltou destino, categoria.');
      expect(r?.texto).not.toContain('Criar');
    });

    it('a conta falhando, o lancamento nao acontece', async () => {
      servicoDeContas.create = jest.fn(async () => {
        throw new Error('caiu');
      });
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(0);
      expect(r?.texto).toContain('Não consegui criar a conta Picpay');
    });
  });

  describe('quando falta a categoria', () => {
    const frase = 'comprei hoje por 10 reais na loja das casas bahia no debito da conta nubank';

    it('lista as categorias que a pessoa tem', async () => {
      const r = await service.responderA(msg(frase));
      expect(r?.texto).toContain('Faltou categoria.');
      expect(r?.texto).toContain('Suas categorias de despesa: Alimentação, Compras');
      expect(r?.texto).toContain('crie no app, em Categorias');
      expect(criados).toHaveLength(0);
    });

    it('categoria dita que nao existe: oferece criar, e nao manda para o app', async () => {
      // Antes, a resposta era "Não achei essa categoria. Suas categorias de
      // despesa: ... crie no app". Quem dizia "categoria doacao" repetia a
      // frase e recebia a mesma coisa, sem jeito de sair do lugar por aqui.
      const r = await service.responderA(msg(frase + ' categoria doacao'));
      expect(r?.texto).toContain('Você ainda não tem a categoria Doacao em despesa. Criar e lançar?');
      expect(r?.confirmar).toBe(true);
      // A PERGUNTA nao cria nada: a categoria nasce no "sim".
      expect(criadas).toHaveLength(0);
      expect(criados).toHaveLength(0);
    });

    it('quem so esqueceu a categoria nao e acusado de engano', async () => {
      const r = await service.responderA(msg(frase));
      expect(r?.texto).not.toContain('Não achei essa categoria');
    });

    it('o sim cria a categoria e lanca nela', async () => {
      await service.responderA(msg(frase + ' categoria doacao'));
      const r = await service.responderA(msg('sim'));

      expect(criadas).toEqual([
        { id: 'cat-nova', name: 'Doacao', type: 'EXPENSE', parentId: null },
      ]);
      expect(criados).toHaveLength(1);
      expect(criados[0]).toMatchObject({ categoryId: 'cat-nova', amount: 10 });
      expect(r?.texto).toMatch(/^✅ Lançado\./);
    });

    it('o nome guarda a grafia de quem escreveu', async () => {
      await service.responderA(msg(frase + ' categoria doação'));
      await service.responderA(msg('sim'));
      expect(criadas[0].name).toBe('Doação');
    });

    it('nome de mais de uma palavra vem inteiro', async () => {
      await service.responderA(msg(frase + ' categoria material de construção'));
      await service.responderA(msg('sim'));
      expect(criadas[0].name).toBe('Material de construção');
    });

    it('o tipo e o do lancamento: receita nao nasce categoria de despesa', async () => {
      await service.responderA(msg('recebi 500 reais na conta nubank categoria aluguel'));
      await service.responderA(msg('sim'));
      expect(criadas[0]).toMatchObject({ name: 'Aluguel', type: 'INCOME' });
    });

    it('nome que JA existe nao vira categoria nova, nem com outro acento', async () => {
      // "alimentacao" sem acento e "Alimentação": a mesma comparacao do
      // lancamento. Sem isto, a gemea nasceria a cada frase.
      const r = await service.responderA(msg(frase + ' categoria alimentacao'));
      expect(r?.texto).toContain('🏷️ Categoria: Alimentação');
      expect(r?.texto).toContain('Confirma?');
      await service.responderA(msg('sim'));
      expect(criadas).toHaveLength(0);
      expect(criados[0]).toMatchObject({ categoryId: 'c1' });
    });

    it('nao oferece criar quando falta mais alguma coisa', async () => {
      // Sem destino, a pergunta e outra. Duas perguntas numa resposta so e o
      // que faz ninguem responder nenhuma.
      const r = await service.responderA(msg('gastei 10 hoje categoria doacao'));
      expect(r?.texto).toContain('Faltou destino, categoria.');
      expect(r?.texto).not.toContain('Criar e lançar?');
    });

    it('sem a palavra categoria, nada e oferecido', async () => {
      // O lojista desconhecido nao vira categoria: o nome tem de ter sido dito
      // COMO categoria.
      const r = await service.responderA(msg(frase));
      expect(r?.texto).not.toContain('Criar e lançar?');
      expect(r?.texto).toContain('crie no app, em Categorias');
    });

    it('o nao descarta a categoria junto com o lancamento', async () => {
      await service.responderA(msg(frase + ' categoria doacao'));
      await service.responderA(msg('nao'));
      expect(criadas).toHaveLength(0);
      expect(criados).toHaveLength(0);
    });

    it('a categoria falhando, o lancamento nao acontece', async () => {
      servicoDeCategorias.create = jest.fn(async () => {
        throw new Error('nome repetido');
      });
      await service.responderA(msg(frase + ' categoria doacao'));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(0);
      expect(r?.texto).toContain('Não consegui criar a categoria Doacao');
    });

    it('a lista respeita o tipo do lancamento', async () => {
      const r = await service.responderA(msg('recebi 500 reais na conta nubank'));
      expect(r?.texto).toContain('Suas categorias de receita: Freelance');
      expect(r?.texto).not.toContain('Alimentação');
    });

    it('sem categoria nenhuma do tipo, manda cadastrar', async () => {
      prisma.category.findMany = jest.fn(async () => []);
      const r = await service.responderA(msg(frase));
      expect(r?.texto).toContain('Você ainda não tem categoria de despesa');
    });
  });

  describe('a pergunta de saldo', () => {
    it('responde o total e as contas que o compoem', async () => {
      const r = await service.responderA(msg('qual meu saldo'));
      expect(r?.texto).toContain('Saldo de hoje: R$ 2.730,00');
      expect(r?.texto).toContain('Nubank: R$ 2.500,00');
      expect(r?.texto).toContain('Cofre: R$ 230,00');
      // Pergunta nao grava nada, e nao pede confirmacao.
      expect(criados).toHaveLength(0);
      expect(r?.confirmar).toBeFalsy();
    });

    it('o que esta guardado em objetivo continua sendo saldo', async () => {
      // Aplicar nao e gastar: o dinheiro so mudou de lugar. Sem esta parcela
      // o total cairia toda vez que alguem guardasse dinheiro.
      movimentos = [
        { goalId: 'g1', type: 'DEPOSIT', amount: dec(1000) },
        { goalId: 'g1', type: 'WITHDRAW', amount: dec(200) },
      ];
      const r = await service.responderA(msg('quanto eu tenho'));
      expect(r?.texto).toContain('Guardado em objetivos: R$ 800,00');
      expect(r?.texto).toContain('Saldo de hoje: R$ 3.530,00');
    });

    it('objetivo resgatado alem do aplicado nao vira divida', async () => {
      movimentos = [
        { goalId: 'g1', type: 'DEPOSIT', amount: dec(100) },
        { goalId: 'g1', type: 'WITHDRAW', amount: dec(300) },
      ];
      const r = await service.responderA(msg('saldo'));
      expect(r?.texto).toContain('Saldo de hoje: R$ 2.730,00');
      expect(r?.texto).not.toContain('objetivos');
    });

    it('sem conta nenhuma, manda cadastrar', async () => {
      prisma.bankAccount.findMany = jest.fn(async () => []);
      const r = await service.responderA(msg('qual meu saldo'));
      expect(r?.texto).toMatch(/ainda n[ãa]o tem conta cadastrada/i);
    });
  });

  describe('a pergunta de resultado', () => {
    /* Relogio preso: a resposta diz o mes por extenso e o teste cobra isso.
     * Sem prender, estes testes passariam hoje e falhariam no dia 1o do mes
     * que vem -- e a falha pareceria um defeito no codigo, nao no teste.
     * Meio-dia em UTC e o mesmo dia no Brasil, sem a virada das 21h. */
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('responde receitas, despesas e o que sobrou', async () => {
      const r = await service.responderA(msg('qual meu resultado nesse mes?'));
      expect(r?.texto).toContain('Resultado de Novembro 2026');
      expect(r?.texto).toContain('Receitas: R$ 5.000,00');
      expect(r?.texto).toContain('Despesas: R$ 3.200,00');
      expect(r?.texto).toContain('Sobrou: R$ 1.800,00');
      // Pergunta nao grava nada, e nao pede confirmacao.
      expect(criados).toHaveLength(0);
      expect(r?.confirmar).toBeFalsy();
    });

    it('diz quantos lancamentos, e que previsto conta', async () => {
      // O numero do mes corrente inclui o que ainda nao aconteceu. Quem
      // comparar com o extrato do banco vai achar diferenca -- e e melhor
      // saber por que.
      const r = await service.responderA(msg('resultado do mes'));
      expect(r?.texto).toContain('12 lançamentos, previstos incluídos');
    });

    it('a fatura aparece nomeada, porque e ela que surpreende no total', async () => {
      const r = await service.responderA(msg('resultado do mes'));
      expect(r?.texto).toContain('Nubank Roxinho (fatura 11/2026, aberta): R$ 1.200,00');
    });

    it('resultado negativo nao e "sobrou"', async () => {
      resultado = { ...resultado, entradas: 1000, saidas: 1500, resultado: -500 };
      const r = await service.responderA(msg('qual o resultado desse mes'));
      expect(r?.texto).toContain('Faltou: R$ 500,00');
      expect(r?.texto).not.toContain('Sobrou');
    });

    it('mes sem movimento diz isso, em vez de zero com cara de resposta', async () => {
      resultado = { ...resultado, entradas: 0, saidas: 0, resultado: 0, vazio: true, lancamentos: 0, faturas: [] };
      const r = await service.responderA(msg('resultado de julho'));
      expect(r?.texto).toContain('Sem movimento neste mês');
    });

    it('a resposta explica o regime, que e o que explica o numero', async () => {
      const r = await service.responderA(msg('resultado do mes'));
      expect(r?.texto).toContain('Contado pelo vencimento da fatura');

      resultado = { ...resultado, regime: 'compra' };
      const outra = await service.responderA(msg('resultado do mes'));
      expect(outra?.texto).toContain('Contado pela data da compra');
    });

    it('sem regime na frase, vale o do cadastro', async () => {
      const r = await service.responderA(msg('qual meu resultado nesse mes?'));
      expect(relatorio.doMes).toHaveBeenLastCalledWith('user-1', '2026-11', 'fatura');
      expect(r?.texto).toContain('Contado pelo vencimento da fatura');
      expect(r?.texto).not.toContain('só nesta resposta');
    });

    it('a frase pode pedir o outro regime, so para aquela resposta', async () => {
      // Trocar a preferencia porque alguem fez uma pergunta mudaria TODAS as
      // telas da pessoa por causa de uma consulta.
      resultado = { ...resultado, regime: 'compra' };
      const r = await service.responderA(msg('qual meu resultado nesse mes pela data da compra?'));
      expect(relatorio.doMes).toHaveBeenLastCalledWith('user-1', '2026-11', 'compra');
      expect(r?.texto).toContain('Contado pela data da compra, só nesta resposta');
      expect(r?.texto).toContain('continua sendo o vencimento da fatura');
    });

    it('quem conta por compra pode pedir o resultado pela fatura', async () => {
      preferido = 'compra';
      const r = await service.responderA(msg('qual meu resultado nesse mes pela fatura?'));
      expect(relatorio.doMes).toHaveBeenLastCalledWith('user-1', '2026-11', 'fatura');
      // E a palavra "fatura" nao pode desviar para a lista de faturas.
      expect(relatorio.faturasDoMes).not.toHaveBeenCalled();
      expect(r?.texto).toContain('só nesta resposta');
      expect(r?.texto).toContain('continua sendo a data da compra');
    });

    it('regime pedido igual ao do cadastro nao vira aviso', async () => {
      const r = await service.responderA(msg('qual meu resultado pelo vencimento da fatura?'));
      expect(r?.texto).not.toContain('só nesta resposta');
    });

    it('o mes dito na frase e o mes consultado', async () => {
      await service.responderA(msg('qual meu resultado em outubro?'));
      expect(relatorio.doMes).toHaveBeenLastCalledWith('user-1', '2026-10', 'fatura');
      await service.responderA(msg('e o resultado do mes passado?'));
      expect(relatorio.doMes).toHaveBeenLastCalledWith('user-1', '2026-10', 'fatura');
    });
  });

  describe('a pergunta das faturas do mes', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('lista uma linha por cartao, com o total no fim', async () => {
      const r = await service.responderA(msg('qual o valor das minhas faturas em novembro?'));
      expect(r?.texto).toContain('Faturas que vencem em Novembro 2026');
      expect(r?.texto).toContain('Nubank Roxinho — fatura 11/2026, aberta: R$ 1.200,00 (vence 17/11/2026)');
      expect(r?.texto).toContain('Total: R$ 1.500,00');
      expect(criados).toHaveLength(0);
      expect(r?.confirmar).toBeFalsy();
    });

    it('diz o mes da fatura E o dia em que ela vence', async () => {
      // Num cartao que fecha 25 e vence 5, a fatura de outubro e cobrada em
      // novembro: dizer so uma das duas datas faz a pessoa conferir o numero
      // contra o mes errado.
      const r = await service.responderA(msg('qual o valor das minhas faturas?'));
      expect(r?.texto).toContain('Carrefour — fatura 10/2026, paga: R$ 300,00 (vence 05/11/2026)');
    });

    it('o mes citado e o mes consultado', async () => {
      await service.responderA(msg('qual o valor das minhas faturas em dezembro/2026?'));
      expect(relatorio.faturasDoMes).toHaveBeenLastCalledWith('user-1', '2026-12');
      await service.responderA(msg('quanto vou pagar de fatura no mes que vem?'));
      expect(relatorio.faturasDoMes).toHaveBeenLastCalledWith('user-1', '2026-12');
    });

    it('mes sem fatura nenhuma diz isso, e nao zero', async () => {
      faturasDoMes = { ...faturasDoMes, total: 0, faturas: [] };
      const r = await service.responderA(msg('qual o valor das faturas em julho'));
      expect(r?.texto).toContain('Nenhuma fatura vence em Julho 2026');
    });

    it('sem cartao cadastrado, a resposta e outra', async () => {
      faturasDoMes = { ...faturasDoMes, total: 0, faturas: [], cartoes: 0 };
      const r = await service.responderA(msg('qual o valor das minhas faturas'));
      expect(r?.texto).toMatch(/n[ãa]o tem cart[ãa]o cadastrado/i);
    });

    describe('quando a frase nomeia um cartao', () => {
      beforeEach(() => {
        // O segundo cartao entra so aqui: com dois cartoes, a fala deixa de
        // ter um destino obvio, e os testes de lancamento contam com isso.
        prisma.creditCard.findMany = jest.fn(async () => [
          { id: 'k1', name: 'Nubank Roxinho', bankAccountId: 'a1', closingDay: 1, cycles: [] },
          { id: 'k2', name: 'Carrefour', bankAccountId: 'a1', closingDay: 25, cycles: [] },
        ]);
      });

      it('responde so a fatura dele, sem o total repetindo a linha', async () => {
        const r = await service.responderA(msg('qual o valor da fatura do nubank em novembro?'));
        expect(r?.texto).toContain('Nubank Roxinho — fatura que vence em Novembro 2026');
        expect(r?.texto).toContain('Fatura 11/2026, aberta: R$ 1.200,00 (vence 17/11/2026)');
        expect(r?.texto).not.toContain('Carrefour');
        // Com uma linha so, um "Total" abaixo dela nao informa nada.
        expect(r?.texto).not.toContain('Total');
      });

      it('reconhece o apelido pela mesma regra do lancamento', async () => {
        const r = await service.responderA(msg('qual a fatura do carrefour?'));
        expect(r?.texto).toContain('Carrefour — fatura que vence em Novembro 2026');
        expect(r?.texto).toContain('Fatura 10/2026, paga: R$ 300,00');
        expect(r?.texto).not.toContain('Nubank');
      });

      it('cartao sem fatura vencendo no mes diz isso pelo nome dele', async () => {
        faturasDoMes = {
          ...faturasDoMes,
          total: 1200,
          faturas: faturasDoMes.faturas.filter((f) => f.cartaoId === 'k1'),
        };
        const r = await service.responderA(msg('qual a fatura do carrefour em novembro?'));
        expect(r?.texto).toBe('💳 Carrefour não tem fatura vencendo em Novembro 2026.');
      });

      it('nome que nao bate com cartao nenhum: responde todos', async () => {
        // A lista ja mostra os nomes que existem, entao nada fica escondido.
        const r = await service.responderA(msg('qual a fatura do itau?'));
        expect(r?.texto).toContain('Faturas que vencem em Novembro 2026');
        expect(r?.texto).toContain('Total: R$ 1.500,00');
      });
    });

    it('a pergunta da fatura nao vira pergunta de resultado', async () => {
      await service.responderA(msg('qual o resultado das minhas faturas em novembro'));
      expect(relatorio.faturasDoMes).toHaveBeenCalled();
      expect(relatorio.doMes).not.toHaveBeenCalled();
    });
  });

  describe('a fatura da compra no cartao', () => {
    // O caso que o usuario encontrou: comprando no DIA do fechamento, a fala
    // mandava para a fatura que estava fechando naquele dia -- as vezes ja
    // fechada -- enquanto a tela mandava para a seguinte. O mesmo gasto ia
    // para faturas diferentes conforme a porta.
    it('a compra no dia do fechamento vai para a fatura seguinte', async () => {
      const r = await service.responderA(
        msg('gastei 10 na padaria no cartao nubank roxinho categoria alimentacao'),
      );
      // Com fechamento no dia 1, QUALQUER compra do mes vai para a fatura do
      // mes seguinte: depois do dia 1 pelo agrupamento, e no proprio dia 1
      // pela sugestao. Por isso a conta aqui nao depende de que dia e hoje.
      const hoje = new Date();
      const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
      const esperado =
        String(proxima.getMonth() + 1).padStart(2, '0') + '/' + proxima.getFullYear();
      expect(r?.texto).toContain('Fatura: ' + esperado);
    });

    it('a fatura VIRADA empurra a compra para a seguinte', async () => {
      // Fecha dia 1: a compra de hoje iria para a fatura do mes que vem. Com
      // ELA virada, vai para a de depois -- a mesma conta que a tela faz, pelo
      // mesmo recorte.
      const hoje = new Date();
      const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
      const depois = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 1);
      const chave = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      viradasDoBanco = [
        {
          creditCardId: 'k1',
          referenceMonth: new Date(chave(proxima) + '-01T00:00:00.000Z'),
          // Virada ANTES de hoje, para a compra de hoje contar como depois.
          earlyClosedAt: new Date(new Date().getTime() - 24 * 3600 * 1000),
        },
      ];
      const r = await service.responderA(
        msg('gastei 10 na padaria no cartao nubank roxinho categoria alimentacao'),
      );
      const esperado = String(depois.getMonth() + 1).padStart(2, '0') + '/' + depois.getFullYear();
      expect(r?.texto).toContain('Fatura: ' + esperado);
    });

    it('o ciclo do cartao mudou: a fala usa o periodo da fatura, como a tela', async () => {
      // Fecha 1 ate a fatura de hoje; do mes seguinte em diante, fecha 25.
      // A compra de hoje (dia 10) cairia na fatura do mes que vem pelo par
      // antigo; com o periodo novo valendo de la, ela continua indo para o
      // mes que vem -- mas quem decide e o periodo DAQUELE mes, e nao o par
      // de agora. O teste trava a ponte: sem `ciclos` chegando na leitura, a
      // resposta muda.
      const hoje = new Date();
      const esteMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      cartoes[0].cycles = [
        { validFrom: new Date(Date.UTC(1900, 0, 1)), closingDay: 1, dueDay: 10 },
        { validFrom: new Date(Date.UTC(esteMes.getFullYear(), esteMes.getMonth(), 1)), closingDay: 28, dueDay: 5 },
      ];
      const r = await service.responderA(
        msg('gastei 10 na padaria no cartao nubank roxinho categoria alimentacao'),
      );
      // Com fechamento 28 valendo para a fatura DESTE mes, a compra de hoje
      // (qualquer dia ate 28) fica nela, e nao na do mes seguinte.
      const esperado =
        String(esteMes.getMonth() + 1).padStart(2, '0') + '/' + esteMes.getFullYear();
      if (hoje.getDate() <= 28) expect(r?.texto).toContain('Fatura: ' + esperado);
    });

    it('a fatura dita na frase continua mandando', async () => {
      const r = await service.responderA(
        msg('gastei 10 na padaria no cartao nubank roxinho categoria alimentacao fatura de marco'),
      );
      expect(r?.texto).toMatch(/Fatura: 03\/\d{4}/);
    });

    it('lancamento em conta nao fala de fatura', async () => {
      const r = await service.responderA(
        msg('gastei 10 no debito da conta Nubank categoria alimentacao'),
      );
      expect(r?.texto).not.toContain('Fatura:');
    });
  });

  describe('compra parcelada', () => {
    const frase = 'gastei 30 em 3x na padaria no cartao nubank categoria alimentacao';

    it('o resumo mostra a parcela E o total', async () => {
      const r = await service.responderA(msg(frase));
      expect(r?.texto).toContain('Valor: R$ 10,00 por parcela');
      expect(r?.texto).toContain('Parcelas: 3x — total R$ 30,00');
      // Nada gravado antes do sim, aqui tambem.
      expect(series).toHaveLength(0);
    });

    it('falado e digitado dao o MESMO lancamento', async () => {
      /* O caso real, da tela do usuario: digitando "3x" a frase virava
       * parcelamento, e o audio da MESMA compra -- que o transcritor escreve
       * como "parcelados de 3 vezes" -- virava uma despesa unica de 20. A
       * frase nao muda de significado por ter sido falada. */
      const formas = [
        'comprei 20 parcelado de 3x nas casas bahia no credito do nubank categoria compras',
        'Comprei 20 parcelados de 3 vezes nas Casas Bahia no crédito do Nubank, categoria compras.',
        'comprei 20 em 3 vezes nas casas bahia no credito do nubank categoria compras',
        'comprei 20 em tres vezes nas casas bahia no credito do nubank categoria compras',
      ];
      for (const f of formas) {
        const r = await service.responderA(msg(f));
        expect(r?.texto).toContain('💵 Valor: R$ 6,67 por parcela');
        expect(r?.texto).toContain('🔢 Parcelas: 3x — total R$ 20,01');
      }
    });

    it('o centavo da divisao torta e dito, nao escondido', async () => {
      // A serie tem um valor so: tres parcelas iguais de 6,67 somam 20,01, e
      // nao os 20,00 ditos. Mostrar 20,00 seria prometer um numero que o
      // extrato depois nao teria.
      const r = await service.responderA(
        msg('comprei 20 em 3x nas casas bahia no credito do nubank categoria compras'),
      );
      expect(r?.texto).toContain('total R$ 20,01 (R$ 20,00 não divide certo por 3)');
    });

    it('parcela DITA nao tem centavo a conferir', async () => {
      const r = await service.responderA(
        msg('comprei 3x de 20 nas casas bahia no credito do nubank categoria compras'),
      );
      expect(r?.texto).toContain('🔢 Parcelas: 3x — total R$ 60,00');
      expect(r?.texto).not.toContain('não divide certo');
    });

    it('o sim cria uma SERIE, nao tres lancamentos soltos', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(0);
      expect(series).toHaveLength(1);
      expect(series[0].repeat).toEqual({
        kind: 'INSTALLMENT',
        frequency: 'MONTHLY',
        count: 3,
      });
      // O valor que vai para o banco e o da PARCELA, como no formulario.
      expect(series[0].input.amount).toBe(10);
      expect(r?.texto).toContain('3x de R$ 10,00');
      expect(r?.texto).toContain('Total R$ 30,00');
    });

    it('"3x de 30" le o valor como parcela', async () => {
      await service.responderA(
        msg('comprei em 3x de 30 na padaria no cartao nubank categoria alimentacao'),
      );
      await service.responderA(msg('sim'));
      expect(series[0].input.amount).toBe(30);
      expect(series[0].repeat.count).toBe(3);
    });

    it('sem parcelamento continua sendo lancamento solto', async () => {
      await service.responderA(
        msg('gastei 30 na padaria no cartao nubank categoria alimentacao'),
      );
      await service.responderA(msg('sim'));
      expect(series).toHaveLength(0);
      expect(criados).toHaveLength(1);
    });
  });

  describe('transferencia entre contas', () => {
    it('o resumo diz a DIRECAO, e nao "Conta" duas vezes', async () => {
      const r = await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
      expect(r?.texto).toContain('Sai de: Nubank');
      expect(r?.texto).toContain('Entra em: Cofre');
      expect(r?.texto).toContain('R$ 100,00');
      expect(r?.texto).toMatch(/Confirma\?/);
      // Nada gravado antes do sim, aqui tambem.
      expect(transferidas).toHaveLength(0);
    });

    it('o sim transfere pelo servico de transferencia, nao pelo de lancamento', async () => {
      await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
      const r = await service.responderA(msg('sim'));
      expect(criados).toHaveLength(0);
      expect(transferidas).toHaveLength(1);
      expect(transferidas[0]).toMatchObject({
        userId: 'user-1',
        fromAccountId: 'a1',
        toAccountId: 'a2',
        amount: 100,
      });
      expect(transferidas[0].clientKey).toMatch(/^wa-/);
      expect(r?.texto).toMatch(/^✅ Transferido\./);
    });

    // A ordem e o que diz quem paga e quem recebe.
    it('a ordem das contas e a direcao', async () => {
      await service.responderA(msg('transferi 50 do Cofre para o Nubank'));
      await service.responderA(msg('sim'));
      expect(transferidas[0]).toMatchObject({ fromAccountId: 'a2', toAccountId: 'a1' });
    });

    it('a mesma conta dos dois lados e contradicao, nao falta', async () => {
      const r = await service.responderA(msg('transferencia de 100 do Nubank para o Nubank'));
      expect(r?.texto).toMatch(/mesma conta duas vezes/);
      expect(r?.texto).not.toMatch(/Faltou/);
      expect(transferidas).toHaveLength(0);
    });

    it('faltando a segunda conta, diz qual e qual', async () => {
      const r = await service.responderA(msg('transferi 100 do Nubank'));
      expect(r?.texto).toMatch(/Faltou conta de destino/);
      expect(r?.texto).toMatch(/primeira conta dita/);
      expect(transferidas).toHaveLength(0);
    });

    it('com menos de duas contas, nao ha transferencia possivel', async () => {
      prisma.bankAccount.findMany = jest.fn(async () => [contaUnica]);
      const r = await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
      expect(r?.texto).toMatch(/precisa de duas contas/);
      expect(transferidas).toHaveLength(0);
    });

    it('falhar na transferencia nao mente que deu certo', async () => {
      transfers.create = jest.fn(async () => {
        throw new Error('saldo insuficiente');
      });
      await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
      const r = await service.responderA(msg('sim'));
      expect(r?.texto).toMatch(/Não consegui transferir/);
    });
  });

  it('a reentrega da Meta nao lanca duas vezes', async () => {
    await service.responderA(
      msg('gastei 40 no debito da conta Nubank categoria alimentacao', 'mesma-id'),
    );
    // A Meta reentrega a MESMA mensagem: é ignorada.
    const repetida = await service.responderA({
      de: DE,
      texto: 'gastei 40 no debito da conta Nubank categoria alimentacao',
      id: 'mesma-id',
    });
    expect(repetida).toBeNull();

    await service.responderA(msg('sim', 'sim-1'));
    const simRepetido = await service.responderA({ de: DE, texto: 'sim', id: 'sim-1' });
    expect(simRepetido).toBeNull();
    expect(criados).toHaveLength(1);
  });

  it('sem conta nem cartao, manda cadastrar antes', async () => {
    prisma.bankAccount.findMany = jest.fn(async () => []);
    prisma.creditCard.findMany = jest.fn(async () => []);
    const r = await service.responderA(msg('gastei 40 no mercado'));
    expect(r?.texto).toMatch(/cadastre uma conta ou um cartão/i);
  });

  it('o lancamento usa o mesmo caminho do app, com clientKey', async () => {
    await service.responderA(msg('recebi 500 de freelance na conta Nubank', 'r1'));
    await service.responderA(msg('sim', 'r2'));
    expect(criados[0]).toMatchObject({ type: 'INCOME', amount: 500, categoryId: 'c4' });
    expect(criados[0].clientKey).toMatch(/^wa-/);
  });
});

describe('perguntaDeMaiores', () => {
  it('reconhece as formas comuns, e o tipo sai do verbo', () => {
    for (const f of [
      'quais foram meus maiores gastos em outubro',
      'maiores despesas de outubro',
      'onde eu gastei mais em outubro',
      'com o que eu mais gastei esse mes',
      'top gastos de novembro',
    ]) {
      expect(perguntaDeMaiores(f, false)).toBe('EXPENSE');
    }
    for (const f of [
      'quais foram minhas maiores receitas em outubro',
      'de onde veio mais receita esse mes',
      'maiores entradas de novembro',
    ]) {
      expect(perguntaDeMaiores(f, false)).toBe('INCOME');
    }
  });

  it('sem superlativo nao e esta pergunta', () => {
    // "quanto gastei em outubro" e resultado do mes, e quem responde por ela
    // e outra funcao -- esta so entra quando ha "maior", "mais", "top".
    expect(perguntaDeMaiores('quanto gastei em outubro', false)).toBeNull();
    expect(perguntaDeMaiores('qual meu resultado nesse mes', false)).toBeNull();
    expect(perguntaDeMaiores('qual meu saldo', false)).toBeNull();
  });

  it('superlativo sem gasto nem categoria nao e esta pergunta', () => {
    // "meu maior saldo" e "o maior cartao" tem superlativo e nao sao ranking
    // de categoria.
    expect(perguntaDeMaiores('qual meu maior saldo', false)).toBeNull();
    expect(perguntaDeMaiores('qual o maior cartao', false)).toBeNull();
    // Com a palavra categoria, vale -- e despesa, que e o primeiro bloco da
    // tela.
    expect(perguntaDeMaiores('minhas maiores categorias de outubro', false)).toBe('EXPENSE');
  });

  it('frase com dinheiro nao e pergunta', () => {
    expect(perguntaDeMaiores('gastei 30 no maior mercado da cidade', true)).toBeNull();
  });
});

describe('perguntaDeObjetivos', () => {
  it('reconhece as formas comuns', () => {
    for (const f of [
      'quanto tenho guardado nos meus objetivos hoje',
      'meus objetivos',
      'quanto ja guardei',
      'como esta minha reserva',
      'quanto tenho no cofrinho',
      'quanto eu poupei ate agora',
    ]) {
      expect(perguntaDeObjetivos(f, false)).toBe(true);
    }
  });

  it('poupanca e tipo de conta, e continua sendo pergunta de saldo', () => {
    // "conta poupança" existe no app; quem pergunta por ela quer o saldo
    // dela, e não o que está guardado em objetivo.
    expect(perguntaDeObjetivos('quanto tenho na poupanca', false)).toBe(false);
    expect(perguntaDeSaldo('quanto tenho na poupanca', false)).toBe(true);
  });

  it('as outras perguntas nao caem aqui', () => {
    expect(perguntaDeObjetivos('qual meu saldo', false)).toBe(false);
    expect(perguntaDeObjetivos('qual meu resultado nesse mes', false)).toBe(false);
    expect(perguntaDeObjetivos('quanto ainda posso gastar com alimentacao', false)).toBe(false);
    expect(perguntaDeObjetivos('qual o valor das minhas faturas', false)).toBe(false);
  });

  it('frase com dinheiro nao e pergunta', () => {
    expect(perguntaDeObjetivos('guardei 500 no objetivo da viagem', true)).toBe(false);
  });
});

describe('o pedido de criar objetivo', () => {
  /** 10 de novembro de 2026, como nos testes da conversa. */
  const HOJE = new Date(2026, 10, 10);

  it('reconhece as formas comuns', () => {
    for (const f of [
      'criar objetivo',
      'quero criar um objetivo',
      'criar objetivo Carro de 6000 até dezembro',
      'cadastrar objetivo viagem',
      'novo objetivo',
      'quero um objetivo novo',
    ]) {
      expect(pedidoDeCriarObjetivo(f)).toBe(true);
    }
  });

  it('as perguntas e os movimentos nao caem aqui', () => {
    for (const f of [
      'quanto tenho guardado nos meus objetivos hoje',
      'quais objetivos eu tenho',
      'apliquei 500 no objetivo viagem',
      'resgatei 200 do objetivo viagem',
      // Pergunta que tem a palavra "criar" dentro: quem abre com "quanto"
      // está consultando.
      'quanto preciso guardar para criar o objetivo da viagem',
      // E criar outra coisa não é criar objetivo.
      'criar uma conta no picpay',
    ]) {
      expect(pedidoDeCriarObjetivo(f)).toBe(false);
    }
  });

  it('o nome sai como foi escrito, sem o recheio em volta', () => {
    expect(nomeDoObjetivoDito('criar objetivo Casa de Praia de 200000')).toBe('Casa de Praia');
    expect(nomeDoObjetivoDito('quero criar um objetivo chamado Viagem da Europa')).toBe(
      'Viagem da Europa',
    );
    expect(nomeDoObjetivoDito('novo objetivo para a Reforma')).toBe('Reforma');
    // Sem nome dito, nada é inventado.
    expect(nomeDoObjetivoDito('criar objetivo de 6000')).toBe('');
    // A resposta solta (sem a palavra "objetivo") é o nome inteiro.
    expect(nomeDoObjetivoDito('Carro novo')).toBe('Carro novo');
  });

  it('o prazo entende data, mes, mes com ano e distancia', () => {
    expect(prazoDoObjetivo('até 31/12/2027', HOJE)?.iso).toBe('2027-12-31');
    expect(prazoDoObjetivo('até 12/2027', HOJE)?.iso).toBe('2027-12-31');
    // Mês dito é o FIM do mês: quem diz "até dezembro" tem dezembro inteiro.
    expect(prazoDoObjetivo('até dezembro', HOJE)?.iso).toBe('2026-12-31');
    // Mês que já passou neste ano é o do ano que vem — prazo é para a frente.
    expect(prazoDoObjetivo('até março', HOJE)?.iso).toBe('2027-03-31');
    expect(prazoDoObjetivo('em 18 meses', HOJE)?.iso).toBe('2028-05-10');
    expect(prazoDoObjetivo('daqui a 2 anos', HOJE)?.iso).toBe('2028-11-10');
    expect(prazoDoObjetivo('até o fim do ano', HOJE)?.iso).toBe('2026-12-31');
    expect(prazoDoObjetivo('Carro novo', HOJE)).toBeNull();
  });

  it('31 de fevereiro nao existe, e nao vira 3 de marco', () => {
    // O Date rolaria para março e o prazo sairia três dias depois do que a
    // pessoa leu na própria mensagem.
    expect(prazoDoObjetivo('até 31/02/2027', HOJE)).toBeNull();
  });

  it('o dia do prazo nao e lido como dinheiro', () => {
    /* O leitor de valor acha números soltos, e "31" em "até 31/12/2027" não é
     * ano nem dia do mês para ele: a meta nascia de R$ 31,00. */
    const p = partesDoObjetivo('criar objetivo Carro até 31/12/2027', HOJE);
    expect(p.valor).toBeUndefined();
    expect(p.prazo).toBe('2027-12-31');
    expect(p.nome).toBe('Carro');
  });

  it('as tres informacoes de uma frase so', () => {
    expect(partesDoObjetivo('criar objetivo Carro de 6000 até dezembro de 2027', HOJE)).toEqual({
      nome: 'Carro',
      valor: 6000,
      prazo: '2027-12-31',
    });
  });
});

describe('perguntaDeMeta', () => {
  it('reconhece o vocabulario da tela', () => {
    for (const f of [
      'qual minha meta de alimentacao',
      'como esta meu planejamento',
      'quanto falta do meu orcamento de novembro',
      'qual o teto desse mes',
      'quanto eu tinha planejado para novembro',
    ]) {
      expect(perguntaDeMeta(f, false)).toBe(true);
    }
  });

  it('reconhece o verbo no infinitivo, que e o que separa esta das outras', () => {
    for (const f of [
      'quanto ainda posso gastar com alimentacao neste mes',
      'quanto ainda tenho para gastar esse mes',
      'quanto da para gastar em dezembro',
      'quanto me resta gastar com mercado',
    ]) {
      expect(perguntaDeMeta(f, false)).toBe(true);
    }
  });

  it('o passado nao e esta pergunta: "quanto gastei" e resultado', () => {
    expect(perguntaDeMeta('quanto gastei em outubro', false)).toBe(false);
    expect(perguntaDeMeta('qual meu resultado nesse mes', false)).toBe(false);
    expect(perguntaDeMeta('qual meu saldo', false)).toBe(false);
    expect(perguntaDeMeta('quais foram meus maiores gastos em novembro', false)).toBe(false);
  });

  it('frase com dinheiro nao e pergunta', () => {
    // O mesmo guarda das outras: senão "gastei 50 no mercado, ia gastar
    // menos" responderia o planejamento e engoliria o lançamento.
    expect(perguntaDeMeta('gastei 50 na meta de alimentacao', true)).toBe(false);
    expect(perguntaDeMeta('vou gastar 200 no mercado', true)).toBe(false);
  });
});

describe('perguntaDeSaldo', () => {
  it('reconhece as formas comuns', () => {
    for (const f of ['qual meu saldo', 'saldo', 'quanto eu tenho', 'quanto tenho hoje?']) {
      expect(perguntaDeSaldo(f, false)).toBe(true);
    }
  });

  it('"qual o VALOR que tenho em conta" e a mesma pergunta', () => {
    // Veio da tela do usuario: ele perguntou assim e recebeu um resumo de
    // lancamento vazio, com "Descricao: Qual".
    for (const f of [
      'Qual o valor que tenho em conta hoje?',
      'qual o valor nas minhas contas',
      'quanto dinheiro eu tenho na conta',
      'qual valor tem no banco',
    ]) {
      expect(perguntaDeSaldo(f, false)).toBe(true);
    }
  });

  it('"valor" sem conta nao vira pergunta de saldo', () => {
    // A palavra mais comum de um lancamento nao pode, sozinha, roubar a
    // leitura: "qual o valor que gastei esse mes" e pergunta de resultado,
    // e quem responde por ela e outra funcao, testada antes desta.
    expect(perguntaDeSaldo('qual o valor que gastei esse mes', false)).toBe(false);
    expect(perguntaDeSaldo('qual o valor da parcela', false)).toBe(false);
  });

  it('frase com dinheiro nao e pergunta, mesmo falando em saldo', () => {
    // Senao uma frase com as duas coisas responderia o saldo e engoliria o
    // lancamento em silencio.
    expect(perguntaDeSaldo('gastei 30 no saldo do nubank', true)).toBe(false);
  });

  it('lancamento comum nao vira pergunta', () => {
    expect(perguntaDeSaldo('gastei 40 no mercado pelo debito', true)).toBe(false);
    expect(perguntaDeSaldo('bom dia', false)).toBe(false);
  });
});

describe('perguntaDeResultado', () => {
  it('reconhece as formas comuns', () => {
    for (const f of [
      'qual meu resultado nesse mes?',
      'resultado do mes',
      'qual o resultado de outubro',
      'como fechei o mes?',
      'me da o balanco do mes',
      'quanto gastei esse mes?',
      'quanto recebi em outubro',
    ]) {
      expect(perguntaDeResultado(f, false)).toBe(true);
    }
  });

  it('"quanto gastei" sem mes nao e pergunta do mes', () => {
    // Pode ser sobre uma loja ou uma categoria, e responder o total do mes
    // seria dar o numero certo para a pergunta errada.
    expect(perguntaDeResultado('quanto gastei no mercado', false)).toBe(false);
  });

  it('frase com dinheiro nao e pergunta', () => {
    expect(perguntaDeResultado('recebi 500 do resultado da empresa', true)).toBe(false);
  });

  it('nao rouba a pergunta de saldo', () => {
    for (const f of ['qual meu saldo', 'quanto eu tenho', 'quanto sobra na conta']) {
      expect(perguntaDeResultado(f, false)).toBe(false);
      expect(perguntaDeSaldo(f, false)).toBe(true);
    }
    // Com mes na frase, "quanto sobrou" e resultado -- e e por isso que a
    // pergunta de resultado e feita primeiro.
    expect(perguntaDeResultado('quanto sobrou esse mes', false)).toBe(true);
  });
});

describe('regimeDaPergunta', () => {
  it('reconhece o pedido de contar por compra', () => {
    for (const f of [
      'qual meu resultado nesse mes pela data da compra',
      'resultado do mes por compra',
      'resultado de outubro pela compra',
      'quanto gastei esse mes pela data de compra',
    ]) {
      expect(regimeDaPergunta(f)).toBe('compra');
    }
  });

  it('reconhece o pedido de contar pela fatura', () => {
    for (const f of [
      'qual meu resultado nesse mes pela fatura',
      'resultado do mes pelo vencimento',
      'resultado por fatura',
    ]) {
      expect(regimeDaPergunta(f)).toBe('fatura');
    }
  });

  it('frase sem pedido de regime devolve null', () => {
    expect(regimeDaPergunta('qual meu resultado nesse mes')).toBeNull();
    // "Na compra do mercado" e onde se gastou, e nao um jeito de contar.
    expect(regimeDaPergunta('quanto gastei esse mes na compra do mercado')).toBeNull();
    expect(regimeDaPergunta('qual o valor das minhas faturas')).toBeNull();
  });
});

describe('perguntaDeFatura', () => {
  it('reconhece as formas comuns', () => {
    for (const f of [
      'qual o valor das minhas faturas em novembro',
      'qual o valor da minha fatura de dezembro/2026',
      'quanto vou pagar de fatura esse mes?',
      'minhas faturas',
    ]) {
      expect(perguntaDeFatura(f, false)).toBe(true);
    }
  });

  it('tentativa de lancamento na fatura nao e pergunta', () => {
    // Com valor, o guarda comum resolve; sem valor, o verbo de gasto e o que
    // separa "gastei na fatura de dezembro" de "qual a fatura de dezembro".
    expect(perguntaDeFatura('gastei 30 no cartao na fatura de dezembro', true)).toBe(false);
    expect(perguntaDeFatura('gastei no cartao na fatura de dezembro', false)).toBe(false);
    expect(perguntaDeFatura('paguei a fatura do nubank', false)).toBe(false);
  });

  it('frase sem fatura nao e dela', () => {
    expect(perguntaDeFatura('qual meu resultado nesse mes', false)).toBe(false);
    expect(perguntaDeFatura('qual meu saldo', false)).toBe(false);
  });

  it('"resultado pela fatura" pede um regime, e nao a lista de faturas', () => {
    expect(perguntaDeFatura('qual meu resultado nesse mes pela fatura', false)).toBe(false);
    // Mas "das minhas faturas" continua sendo sobre as faturas.
    expect(perguntaDeFatura('qual o resultado das minhas faturas em novembro', false)).toBe(true);
  });
});

describe('de que mes a pergunta fala', () => {
  const hoje = new Date(2026, 10, 1); // 1o de novembro de 2026

  it('sem mes dito, e o mes corrente -- como a tela, que abre em hoje', () => {
    expect(mesDaPergunta('qual meu resultado', hoje)).toBe('2026-11');
    expect(mesDaPergunta('resultado desse mes', hoje)).toBe('2026-11');
  });

  it('anda um mes para cada lado', () => {
    expect(mesDaPergunta('resultado do mes passado', hoje)).toBe('2026-10');
    expect(mesDaPergunta('resultado do mes retrasado', hoje)).toBe('2026-09');
    expect(mesDaPergunta('resultado do mes que vem', hoje)).toBe('2026-12');
  });

  it('entende o mes pelo nome, pela tabela do app', () => {
    expect(mesDaPergunta('resultado de outubro', hoje)).toBe('2026-10');
    expect(mesDaPergunta('resultado de marco de 2025', hoje)).toBe('2025-03');
  });

  it('mes por nome sem ano: o mais recente, aceitando um a frente', () => {
    // Dezembro em novembro e o proximo (previsto, que a tela tambem mostra).
    expect(mesDaPergunta('resultado de dezembro', hoje)).toBe('2026-12');
    // Janeiro em novembro e o que passou, e nao o que vem em dois meses.
    expect(mesDaPergunta('resultado de janeiro', hoje)).toBe('2026-01');
  });

  it('entende o mes escrito em numeros', () => {
    expect(mesDaPergunta('resultado de 10/2026', hoje)).toBe('2026-10');
    expect(mesDaPergunta('resultado de 2026-09', hoje)).toBe('2026-09');
  });
});

describe('que dia e hoje para quem falou', () => {
  const dia = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  // O caso real: 21h06 de 31 de outubro no Brasil ja e 1o de novembro em UTC,
  // e o lancamento nascia com a data de amanha.
  it('as 21h de ca, ainda e ontem la', () => {
    expect(dia(diaDoUsuario(new Date('2026-11-01T00:06:00Z')))).toEqual([2026, 10, 31]);
  });

  it('de dia os dois fusos concordam, e e por isso que ninguem notava', () => {
    expect(dia(diaDoUsuario(new Date('2026-10-31T15:00:00Z')))).toEqual([2026, 10, 31]);
  });

  it('a virada do ano tambem anda com o fuso', () => {
    expect(dia(diaDoUsuario(new Date('2027-01-01T02:00:00Z')))).toEqual([2026, 12, 31]);
  });

  it('o fuso entra por parametro, para o dia nao ser sempre o do Brasil', () => {
    expect(dia(diaDoUsuario(new Date('2026-11-01T00:06:00Z'), 'UTC'))).toEqual([2026, 11, 1]);
    expect(dia(diaDoUsuario(new Date('2026-11-01T00:06:00Z'), 'Asia/Tokyo'))).toEqual([2026, 11, 1]);
  });
});

describe('meta — a fronteira', () => {
  const segredo = 'app-secret-de-teste';
  const corpo = Buffer.from(JSON.stringify({ oi: 'tudo bem' }), 'utf8');
  const assinar = (b: Buffer) => 'sha256=' + createHmac('sha256', segredo).update(b).digest('hex');

  it('assinatura certa passa', () => {
    expect(assinaturaConfere(corpo, assinar(corpo), segredo)).toBe(true);
  });

  it('corpo trocado nao passa', () => {
    const outro = Buffer.from(JSON.stringify({ oi: 'outra coisa' }), 'utf8');
    expect(assinaturaConfere(outro, assinar(corpo), segredo)).toBe(false);
  });

  it('sem assinatura, sem corpo bruto ou sem segredo, nao passa', () => {
    expect(assinaturaConfere(corpo, undefined, segredo)).toBe(false);
    expect(assinaturaConfere(undefined, assinar(corpo), segredo)).toBe(false);
    // Sem o segredo configurado nada passa — falha fechada, para um deploy
    // sem a variável não virar porta aberta.
    expect(assinaturaConfere(corpo, assinar(corpo), undefined)).toBe(false);
  });

  describe('responder diz por que nao saiu', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });

    it('sem token, diz que e o token', async () => {
      delete process.env.WHATSAPP_TOKEN;
      process.env.WHATSAPP_PHONE_ID = '123';
      await expect(responder('5531900000000', 'oi')).resolves.toMatch(/WHATSAPP_TOKEN/);
    });

    it('sem phone id, diz que e o phone id', async () => {
      process.env.WHATSAPP_TOKEN = 't';
      delete process.env.WHATSAPP_PHONE_ID;
      await expect(responder('5531900000000', 'oi')).resolves.toMatch(/WHATSAPP_PHONE_ID/);
    });

    it('saiu: devolve null', async () => {
      process.env.WHATSAPP_TOKEN = 't';
      process.env.WHATSAPP_PHONE_ID = '123';
      (global as any).fetch = jest.fn(async () => ({ ok: true }));
      await expect(responder('5531900000000', 'oi')).resolves.toBeNull();
    });

    it('nao saiu: devolve o motivo que a Meta deu, SEM o telefone', async () => {
      process.env.WHATSAPP_TOKEN = 't';
      process.env.WHATSAPP_PHONE_ID = '123';
      (global as any).fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Recipient phone number not in allowed list: 5531975696594',
            code: 131030,
          },
        }),
      }));
      const motivo = await responder('5531975696594', 'oi');
      expect(motivo).toContain('not in allowed list');
      expect(motivo).toContain('131030');
      // O motivo serve ao log, e o log nao guarda numero de ninguem.
      expect(motivo).not.toContain('5531975696594');
      expect(motivo).toContain('[número]');
    });

    it('a rede caindo tambem vira motivo, nao excecao', async () => {
      process.env.WHATSAPP_TOKEN = 't';
      process.env.WHATSAPP_PHONE_ID = '123';
      (global as any).fetch = jest.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      });
      await expect(responder('5531900000000', 'oi')).resolves.toMatch(/rede/);
    });

    it('a mascara nao come numero curto, que nao e telefone', () => {
      expect(semNumeros('erro no código 131030 ao enviar')).toBe('erro no código 131030 ao enviar');
      expect(semNumeros('numero 5531975696594 aqui')).toBe('numero [número] aqui');
    });
  });

  it('le texto, audio e botao do payload', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: '55 31 98888-7777', id: 'm1', type: 'text', text: { body: 'oi' } },
                  { from: '5531988887777', id: 'm2', type: 'audio', audio: { id: 'au1' } },
                  {
                    from: '5531988887777',
                    id: 'm3',
                    type: 'interactive',
                    interactive: { button_reply: { id: 'sim', title: 'Confirmar' } },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const ms = mensagensDoPayload(payload);
    expect(ms).toHaveLength(3);
    expect(ms[0]).toMatchObject({ de: '5531988887777', texto: 'oi' });

    // O `from` do Brasil chega sem o nono digito: a fronteira ja devolve a
    // forma canonica, e o resto do modulo nunca ve as duas.
    const semNono = mensagensDoPayload({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: '553175696594', id: 'm4', type: 'text', text: { body: 'oi' } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(semNono[0].de).toBe('5531975696594');
    expect(ms[1].audioId).toBe('au1');
    // Vale o ID do botao, nao o rotulo: o rotulo pode ser reescrito a
    // qualquer momento, e a conversa nao pode depender da redacao da tela.
    expect(ms[2].texto).toBe('sim');
  });

  it('evento que nao e mensagem nao vira nada, e nao estoura', () => {
    expect(mensagensDoPayload({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
    expect(mensagensDoPayload({})).toEqual([]);
    expect(mensagensDoPayload(null)).toEqual([]);
    expect(mensagensDoPayload({ entry: 'nao e lista' })).toEqual([]);
  });
});
