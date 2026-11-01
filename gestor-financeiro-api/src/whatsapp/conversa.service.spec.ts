// ============================================================
// conversa.service.spec.ts
// ============================================================
// A conversa inteira, sem rede: chega texto, sai resposta.
//
// A coisa mais importante provada aqui é o que NÃO acontece: nenhuma frase
// vira lançamento antes do "sim". Uma leitura errada gravada em silêncio só
// aparece dias depois, num saldo que não fecha.
// ============================================================

import type { BankAccount, Category, CategoryRule, CreditCard } from '@prisma/client';
import { ConversaService, diaDoUsuario } from './conversa.service';
import { assinaturaConfere, mensagensDoPayload, responder, semNumeros } from './meta';
import { createHmac } from 'node:crypto';

const DE = '5531988887777';
const msg = (texto: string, id = 'm' + Math.random()) => ({ de: DE, texto, id });

describe('ConversaService', () => {
  let service: ConversaService;
  let prisma: any;
  let transactions: any;
  let whatsapp: any;
  let audio: any;
  let criados: any[];
  let dono: string | null;
  let ouvido: string | null;

  beforeEach(() => {
    criados = [];
    dono = 'user-1';
    ouvido = null;

    /* Os tipos do Prisma nas linhas de mentira, e não um objeto solto.
     *
     * Este mock foi escrito uma vez com `name` na conta, porque era isso que
     * eu achava que a coluna se chamava. O serviço lia `c.name` pela mesma
     * crença, os dois concordaram, e o teste passou verde enquanto, em
     * produção, nenhuma conta era encontrada — a coluna é `institutionName`.
     * Um mock tipado não consegue concordar com uma crença errada. */
    const contas: Pick<BankAccount, 'id' | 'institutionName' | 'isActive'>[] = [
      { id: 'a1', institutionName: 'Nubank', isActive: true },
      { id: 'a2', institutionName: 'Cofre', isActive: true },
    ];
    const cartoes: Pick<CreditCard, 'id' | 'name' | 'bankAccountId'>[] = [
      { id: 'k1', name: 'Nubank Roxinho', bankAccountId: 'a1' },
    ];
    const categorias: Pick<Category, 'id' | 'name' | 'type' | 'parentId'>[] = [
      { id: 'c1', name: 'Alimentação', type: 'EXPENSE', parentId: null },
      { id: 'c9', name: 'Compras', type: 'EXPENSE', parentId: null },
      { id: 'c4', name: 'Freelance', type: 'INCOME', parentId: null },
    ];
    const regrasDoBanco: Pick<CategoryRule, 'merchant' | 'categoryId'>[] = [
      { merchant: 'magazine', categoryId: 'c9' },
    ];

    prisma = {
      bankAccount: { findMany: jest.fn(async () => contas) },
      creditCard: { findMany: jest.fn(async () => cartoes) },
      category: { findMany: jest.fn(async () => categorias) },
      categoryRule: { findMany: jest.fn(async () => regrasDoBanco) },
    };

    transactions = {
      create: jest.fn(async (input: any) => {
        criados.push(input);
        return { id: 't1', ...input };
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

    service = new ConversaService(prisma, transactions, whatsapp, audio);
  });

  describe('quem ainda nao conectou', () => {
    beforeEach(() => {
      dono = null;
    });

    it('recebe o mesmo recado, tenha conta ou nao', async () => {
      const r = await service.responderA(msg('oi'));
      expect(r).toMatch(/não reconheço este número/i);
      // E nada do que ele disser vira lançamento.
      expect(criados).toHaveLength(0);
    });

    it('mas o codigo de pareamento conecta', async () => {
      whatsapp.vincularPorCodigo = jest.fn(async () => ({ userId: 'user-1', ultimos4: '7777' }));
      const r = await service.responderA(msg('SALDO-K7P2M9QX'));
      expect(r).toMatch(/agora lança na sua conta/i);
    });
  });

  it('a frase vira um resumo, e NADA e gravado ainda', async () => {
    const r = await service.responderA(
      msg('gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao'),
    );
    expect(r).toContain('R$ 40,00');
    expect(r).toContain('Mercado');
    expect(r).toContain('Nubank');
    expect(r).toContain('Alimentação');
    expect(r).toMatch(/Confirma\?/);
    expect(criados).toHaveLength(0);
  });

  it('a conta e achada pelo nome que esta no banco', async () => {
    // O defeito que isto pega: a conta vinha sem nome do tradutor, o ditado
    // nao achava nenhuma, e a resposta dizia "Faltou destino" para uma frase
    // que nomeava a conta corretamente.
    const r = await service.responderA(msg('despesa de 10 reais no pix conta do nubank'));
    expect(r).toContain('Conta: Nubank');
    expect(r).not.toMatch(/Faltou destino/);
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
    expect(r).toMatch(/^Lançado\./);
  });

  it('o nao joga fora', async () => {
    await service.responderA(msg('gastei 40 no debito da conta Nubank categoria alimentacao'));
    const r = await service.responderA(msg('não'));
    expect(criados).toHaveLength(0);
    expect(r).toMatch(/não lancei nada/i);
    // E o "sim" depois do "não" não ressuscita o rascunho.
    await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
  });

  it('sim sem rascunho nenhum e so mais uma frase', async () => {
    const r = await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
    expect(r).toMatch(/Faltou/);
  });

  it('a regra de lojista do usuario classifica, e o resumo diz de onde veio', async () => {
    const r = await service.responderA(msg('compra no pix na magazine valor de 10 pago nubank'));
    expect(r).toContain('Compras');
    expect(r).toContain('(do lojista)');
  });

  it('frase incompleta pergunta, e nao guarda rascunho', async () => {
    const r = await service.responderA(msg('gastei 30 reais'));
    expect(r).toMatch(/Faltou destino, categoria/);
    await service.responderA(msg('sim'));
    expect(criados).toHaveLength(0);
  });

  describe('recado de voz', () => {
    it('sem transcritor configurado, diz que nao escuta', async () => {
      ouvido = null;
      const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      expect(r).toMatch(/não escuto áudio/i);
      expect(audio.ouvir).not.toHaveBeenCalled();
      expect(criados).toHaveLength(0);
    });

    it('o audio segue o MESMO caminho da frase digitada', async () => {
      ouvido = 'gastei 40 reais no mercado pelo debito da conta Nubank categoria alimentacao';
      const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
      // O que foi ouvido vem antes do resumo: e assim que a pessoa pega o
      // transcritor trocando uma palavra.
      expect(r).toMatch(/^Ouvi: /);
      expect(r).toContain('R$ 40,00');
      expect(r).toContain('Mercado');
      expect(r).toMatch(/Confirma\?/);
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
      expect(r).toMatch(/não consegui entender o áudio/i);
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

  it('transferencia nao vai por aqui', async () => {
    const r = await service.responderA(msg('transferencia de 100 do Nubank para o Cofre'));
    expect(r).toMatch(/Transferência/);
    expect(criados).toHaveLength(0);
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
    expect(r).toMatch(/cadastre uma conta ou um cartão/i);
  });

  it('o lancamento usa o mesmo caminho do app, com clientKey', async () => {
    await service.responderA(msg('recebi 500 de freelance na conta Nubank', 'r1'));
    await service.responderA(msg('sim', 'r2'));
    expect(criados[0]).toMatchObject({ type: 'INCOME', amount: 500, categoryId: 'c4' });
    expect(criados[0].clientKey).toMatch(/^wa-/);
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
                    interactive: { button_reply: { title: 'Sim' } },
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
    expect(ms[2].texto).toBe('Sim');
  });

  it('evento que nao e mensagem nao vira nada, e nao estoura', () => {
    expect(mensagensDoPayload({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
    expect(mensagensDoPayload({})).toEqual([]);
    expect(mensagensDoPayload(null)).toEqual([]);
    expect(mensagensDoPayload({ entry: 'nao e lista' })).toEqual([]);
  });
});
