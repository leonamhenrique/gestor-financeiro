// ============================================================
// conversa.service.spec.ts
// ============================================================
// A conversa inteira, sem rede: chega texto, sai resposta.
//
// A coisa mais importante provada aqui é o que NÃO acontece: nenhuma frase
// vira lançamento antes do "sim". Uma leitura errada gravada em silêncio só
// aparece dias depois, num saldo que não fecha.
// ============================================================

import { ConversaService } from './conversa.service';
import { assinaturaConfere, mensagensDoPayload } from './meta';
import { createHmac } from 'node:crypto';

const DE = '5531988887777';
const msg = (texto: string, id = 'm' + Math.random()) => ({ de: DE, texto, id });

describe('ConversaService', () => {
  let service: ConversaService;
  let prisma: any;
  let transactions: any;
  let whatsapp: any;
  let criados: any[];
  let dono: string | null;

  beforeEach(() => {
    criados = [];
    dono = 'user-1';

    prisma = {
      bankAccount: {
        findMany: jest.fn(async () => [
          { id: 'a1', name: 'Nubank', isActive: true },
          { id: 'a2', name: 'Cofre', isActive: true },
        ]),
      },
      creditCard: {
        findMany: jest.fn(async () => [
          { id: 'k1', name: 'Nubank Roxinho', bankAccountId: 'a1' },
        ]),
      },
      category: {
        findMany: jest.fn(async () => [
          { id: 'c1', name: 'Alimentação', type: 'EXPENSE', parentId: null },
          { id: 'c9', name: 'Compras', type: 'EXPENSE', parentId: null },
          { id: 'c4', name: 'Freelance', type: 'INCOME', parentId: null },
        ]),
      },
      categoryRule: {
        findMany: jest.fn(async () => [{ merchant: 'magazine', categoryId: 'c9' }]),
      },
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

    service = new ConversaService(prisma, transactions, whatsapp);
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

  it('audio ainda nao, e diz isso', async () => {
    const r = await service.responderA({ de: DE, texto: '', id: 'm9', audioId: 'a1' });
    expect(r).toMatch(/ouvir áudio/i);
    expect(criados).toHaveLength(0);
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
