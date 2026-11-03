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
  perguntaDeFatura,
  perguntaDeResultado,
  perguntaDeSaldo,
  regimeDaPergunta,
} from './conversa.service';
import type { FaturasDoMes, RelatorioService, ResultadoDoMes } from '../relatorio/relatorio.service';
import type { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import type { CreditCardsService } from '../credit-cards/credit-cards.service';
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
  let relatorio: Pick<RelatorioService, 'doMes' | 'faturasDoMes' | 'regime'>;
  /** O regime guardado no cadastro de quem perguntou. */
  let preferido: 'compra' | 'fatura';

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
    relatorio = {
      doMes: jest.fn(async () => resultado),
      faturasDoMes: jest.fn(async () => faturasDoMes),
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
      expect(r?.texto).toContain('Não tenho o cartão C6 bank');
      expect(r?.texto).toContain('o do fechamento e o do vencimento');
      expect(r?.texto).toContain('Responda "1 e 10"');
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
      expect(r?.texto).toContain('Preciso dos dois dias do cartão C6 bank');
      // O rascunho continua de pe: os dias chegam na proxima.
      const ok = await service.responderA(msg('1 e 10'));
      expect(ok?.confirmar).toBe(true);
    });

    it('dia impossivel nao passa', async () => {
      await service.responderA(msg(frase));
      const r = await service.responderA(msg('45 e 60'));
      expect(r?.texto).toContain('de 1 a 31');
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

describe('perguntaDeSaldo', () => {
  it('reconhece as formas comuns', () => {
    for (const f of ['qual meu saldo', 'saldo', 'quanto eu tenho', 'quanto tenho hoje?']) {
      expect(perguntaDeSaldo(f, false)).toBe(true);
    }
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
