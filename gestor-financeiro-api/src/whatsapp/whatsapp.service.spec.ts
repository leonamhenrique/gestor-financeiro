// ============================================================
// whatsapp.service.spec.ts
// ============================================================
// O vínculo é a porta: depois dele, uma mensagem vira lançamento na conta de
// alguém. O que se prova aqui é quem consegue atravessá-la — e, sobretudo,
// quem não consegue: código vencido, código já gasto, código inventado,
// número que é de outra conta, rajada de tentativas.
//
// E uma coisa que não aparece em nenhum `expect` de valor: o número nunca é
// gravado legível. Os testes guardam o que o serviço mandou para o banco e
// conferem que o telefone não está lá.
// ============================================================

import { NotFoundException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { hashDoTelefone, normalizarCodigo } from './telefone';

const TELEFONE = '+55 31 98888-7777';
const OUTRO = '5531977776666';

describe('WhatsappService — pareamento', () => {
  let service: WhatsappService;
  let prisma: any;
  let links: any[];
  let pareamentos: any[];
  let seq: number;

  beforeEach(() => {
    // O segredo do HMAC é de teste; em produção ele vem do painel do Render e
    // não existe no repositório.
    process.env.WHATSAPP_PHONE_PEPPER = 'pimenta-de-teste-com-tamanho-suficiente';
    links = [];
    pareamentos = [];
    seq = 0;

    const acharLink = (where: any) =>
      links.find(
        (l) =>
          (where.userId === undefined || l.userId === where.userId) &&
          (where.phoneHash === undefined || l.phoneHash === where.phoneHash),
      );

    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      whatsappPairing: {
        create: jest.fn(async ({ data }: any) => {
          const p = { id: 'p' + ++seq, usedAt: null, createdAt: new Date(), ...data };
          pareamentos.push(p);
          return { ...p };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const p = pareamentos.find((x) => x.codeHash === where.codeHash);
          return p ? { ...p } : null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const p = pareamentos.find(
            (x) =>
              x.userId === where.userId &&
              x.usedAt === null &&
              x.expiresAt > where.expiresAt.gt,
          );
          return p ? { ...p } : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const p = pareamentos.find((x) => x.id === where.id);
          Object.assign(p, data);
          return { ...p };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const antes = pareamentos.length;
          pareamentos = pareamentos.filter(
            (x) =>
              !(
                x.userId === where.userId &&
                (where.usedAt === undefined || x.usedAt === where.usedAt)
              ),
          );
          return { count: antes - pareamentos.length };
        }),
      },
      whatsappLink: {
        findUnique: jest.fn(async ({ where }: any) => {
          const l = acharLink(where);
          return l ? { ...l } : null;
        }),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const l = acharLink(where);
          if (l) {
            Object.assign(l, update);
            return { ...l };
          }
          const novo = { id: 'l' + ++seq, linkedAt: new Date(), ...create };
          links.push(novo);
          return { ...novo };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const l = acharLink(where);
          if (l) Object.assign(l, data);
          return { count: l ? 1 : 0 };
        }),
        deleteMany: jest.fn(async ({ where }: any) => {
          const antes = links.length;
          links = links.filter((l) => l.userId !== where.userId);
          return { count: antes - links.length };
        }),
      },
    };

    service = new WhatsappService(prisma);
  });

  async function codigoDe(userId = 'user-1') {
    const r = await service.criarPareamento(userId);
    return r.codigo;
  }

  it('o codigo aparece em claro uma vez, e no banco so o hash', async () => {
    const r = await service.criarPareamento('user-1');
    expect(r.codigo).toHaveLength(8);
    expect(r.mensagem).toBe('SALDO-' + r.codigo);
    // O que foi parar no banco não contém o código.
    const gravado = JSON.stringify(pareamentos);
    expect(gravado).not.toContain(r.codigo);
  });

  it('um codigo pendente por vez', async () => {
    await service.criarPareamento('user-1');
    await service.criarPareamento('user-1');
    expect(pareamentos.filter((p) => !p.usedAt)).toHaveLength(1);
  });

  it('o codigo certo liga o numero a conta', async () => {
    const codigo = await codigoDe();
    const r = await service.vincularPorCodigo(TELEFONE, 'SALDO-' + codigo);
    expect(r).toEqual({ userId: 'user-1', ultimos4: '7777' });
    expect(links).toHaveLength(1);
  });

  it('o telefone NAO fica legivel no banco', async () => {
    const codigo = await codigoDe();
    await service.vincularPorCodigo(TELEFONE, codigo);
    const gravado = JSON.stringify(links);
    // Nem com pontuação, nem só dígitos.
    expect(gravado).not.toContain('5531988887777');
    expect(gravado).not.toContain('98888');
    expect(links[0].phoneHash).toBe(hashDoTelefone(TELEFONE));
    // Os últimos quatro ficam, de propósito: é o que a tela mostra.
    expect(links[0].phoneLast4).toBe('7777');
  });

  it('o mesmo numero escrito de outro jeito acha o mesmo dono', async () => {
    const codigo = await codigoDe();
    await service.vincularPorCodigo('+55 (31) 98888-7777', codigo);
    expect(await service.donoDoTelefone('5531988887777')).toBe('user-1');
  });

  it('numero nao pareado nao tem dono', async () => {
    expect(await service.donoDoTelefone(OUTRO)).toBeNull();
  });

  it('o codigo so serve uma vez', async () => {
    const codigo = await codigoDe();
    await service.vincularPorCodigo(TELEFONE, codigo);
    // O mesmo código, de outro aparelho, não vale mais.
    expect(await service.vincularPorCodigo(OUTRO, codigo)).toBeNull();
  });

  it('codigo vencido nao vale', async () => {
    const codigo = await codigoDe();
    pareamentos[0].expiresAt = new Date(Date.now() - 1000);
    expect(await service.vincularPorCodigo(TELEFONE, codigo)).toBeNull();
    expect(links).toHaveLength(0);
  });

  it('codigo inventado nao vale', async () => {
    await codigoDe();
    expect(await service.vincularPorCodigo(TELEFONE, 'SALDO-ABCD2345')).toBeNull();
    expect(links).toHaveLength(0);
  });

  it('mensagem sem codigo nenhum nao vale', async () => {
    await codigoDe();
    expect(await service.vincularPorCodigo(TELEFONE, 'oi, tudo bem?')).toBeNull();
  });

  it('o codigo e achado no meio da frase', async () => {
    const codigo = await codigoDe();
    const r = await service.vincularPorCodigo(TELEFONE, `Quero conectar: SALDO-${codigo} no app`);
    expect(r?.userId).toBe('user-1');
  });

  it('espaco, hifen e minuscula nao atrapalham', async () => {
    const codigo = await codigoDe();
    const meio = codigo.slice(0, 4) + ' ' + codigo.slice(4);
    const r = await service.vincularPorCodigo(TELEFONE, ('saldo-' + meio).toLowerCase());
    expect(r?.userId).toBe('user-1');
  });

  it('numero que ja e de outra conta nao muda de dono por codigo', async () => {
    // A primeira pessoa conecta.
    await service.vincularPorCodigo(TELEFONE, await codigoDe('user-1'));
    // A segunda tenta parear O MESMO número com a conta dela.
    expect(await service.vincularPorCodigo(TELEFONE, await codigoDe('user-2'))).toBeNull();
    expect(links).toHaveLength(1);
    expect(links[0].userId).toBe('user-1');
  });

  it('trocar de aparelho e so parear de novo', async () => {
    await service.vincularPorCodigo(TELEFONE, await codigoDe('user-1'));
    const r = await service.vincularPorCodigo(OUTRO, await codigoDe('user-1'));
    expect(r?.ultimos4).toBe('6666');
    expect(links).toHaveLength(1);
    expect(links[0].phoneHash).toBe(hashDoTelefone(OUTRO));
    // O número antigo deixa de abrir a porta.
    expect(await service.donoDoTelefone(TELEFONE)).toBeNull();
  });

  it('a rajada de tentativas trava, e o codigo certo depois dela nao passa', async () => {
    const codigo = await codigoDe();
    for (let i = 0; i < 5; i++) {
      await service.vincularPorCodigo(TELEFONE, 'SALDO-ABCD234' + i);
    }
    expect(await service.vincularPorCodigo(TELEFONE, codigo)).toBeNull();
    // E o freio é por número: de outro aparelho o código certo ainda vale.
    expect((await service.vincularPorCodigo(OUTRO, codigo))?.userId).toBe('user-1');
  });

  it('desvincular apaga o vinculo e os codigos pendentes', async () => {
    await service.vincularPorCodigo(TELEFONE, await codigoDe());
    await service.criarPareamento('user-1');
    await service.desvincular('user-1');
    expect(links).toHaveLength(0);
    expect(pareamentos).toHaveLength(0);
    expect(await service.donoDoTelefone(TELEFONE)).toBeNull();
  });

  it('desvincular sem nada ligado da 404', async () => {
    await expect(service.desvincular('user-1')).rejects.toThrow(NotFoundException);
  });

  it('o status conta o que a tela precisa, e so isso', async () => {
    expect(await service.status('user-1')).toMatchObject({ vinculado: false, ultimos4: null });
    await service.vincularPorCodigo(TELEFONE, await codigoDe());
    const s = await service.status('user-1');
    expect(s.vinculado).toBe(true);
    expect(s.ultimos4).toBe('7777');
    expect(JSON.stringify(s)).not.toContain('98888');
  });

  it('sem o segredo do servidor, nada e gravado', async () => {
    // Falha fechada: um padrão aqui guardaria telefone recuperável sem
    // ninguém perceber.
    delete process.env.WHATSAPP_PHONE_PEPPER;
    const codigo = await codigoDe();
    await expect(service.vincularPorCodigo(TELEFONE, codigo)).rejects.toThrow(
      /WHATSAPP_PHONE_PEPPER/,
    );
    expect(links).toHaveLength(0);
  });

  it('o prefixo SALDO nao faz parte do codigo', () => {
    expect(normalizarCodigo('SALDO-K7P2M9QX')).toBe('K7P2M9QX');
    expect(normalizarCodigo('k7p2 m9qx')).toBe('K7P2M9QX');
  });
});
