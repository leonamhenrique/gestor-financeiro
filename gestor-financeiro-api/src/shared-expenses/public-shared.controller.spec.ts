// ============================================================
// public-shared.controller.spec.ts
// ============================================================
// A única rota que serve dado financeiro sem login. Os testes aqui são
// sobre o que NÃO sai dela.
// ============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PublicSharedController } from './public-shared.controller';
import { ShareLinksService } from './share-links.service';
import { SharedSummaryService } from './shared-summary.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';
import { IS_PUBLIC } from '../auth/public.decorator';
import { gerarTokenOpaco, hashDoToken } from '../auth/token.utils';

/** O extrato privado, com tudo que ele tem de verdade. A peneira é medida
 * contra ISTO: se um campo sensível entrar aqui e vazar lá, o teste cai. */
const EXTRATO_PRIVADO = {
  person: { id: 'pessoa-interna-123', name: 'Rafael', pixKey: 'rafael@pix' },
  mes: '2026-10',
  saldoAnterior: 0,
  movimentoDoMes: 700,
  saldoFinal: 700,
  totalDoMes: 2000,
  minhaParteNoMes: 1000,
  lancamentos: [
    {
      id: 'despesa-interna-1',
      date: new Date('2026-10-12T00:00:00Z'),
      description: 'Jantar',
      total: 200,
      minhaParte: 100,
      parteDela: 100,
      percent: 50,
      euPaguei: true,
      formaEhCartao: true,
      forma: 'Cartão Nubank Roxinho',
      parcela: '2/5',
      categoryId: 'cat-interna-9',
      paidByPersonId: null,
      partes: [{ personId: 'outra-pessoa-666', amount: 100, percent: null }],
    },
    {
      id: 'despesa-interna-2',
      date: new Date('2026-10-05T00:00:00Z'),
      description: 'Mercado',
      total: 380,
      minhaParte: 190,
      parteDela: 190,
      percent: null,
      euPaguei: true,
      formaEhCartao: false,
      forma: 'Itaú',
      parcela: null,
      categoryId: 'cat-interna-3',
      partes: [],
    },
  ],
  acertos: [
    {
      id: 'acerto-interno-1',
      direction: 'RECEIVED',
      amount: 300,
      settledAt: new Date('2026-10-14T00:00:00Z'),
      description: null,
      bankAccountId: 'conta-interna-7',
      userId: 'dono-interno',
    },
  ],
};

describe('PublicSharedController', () => {
  let controller: PublicSharedController;
  let links: any;
  let resumos: any;

  beforeEach(async () => {
    links = {
      resolver: jest.fn(async () => ({ id: 'link-1', userId: 'u1', personId: 'rafael' })),
      registrarVisita: jest.fn().mockResolvedValue(undefined),
    };
    resumos = { extratoDaPessoa: jest.fn(async () => EXTRATO_PRIVADO) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicSharedController],
      providers: [
        { provide: ShareLinksService, useValue: links },
        { provide: SharedSummaryService, useValue: resumos },
      ],
    })
      // O guard de limite não entra no teste: aqui se mede a peneira.
      .overrideGuard(require('@nestjs/throttler').ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PublicSharedController);
  });

  // ----------------------------------------------------------
  // o que sai
  // ----------------------------------------------------------

  it('devolve o nome, a chave Pix e o saldo entre nós dois', async () => {
    const r: any = await controller.ver('tok');
    expect(r.person.name).toBe('Rafael');
    expect(r.person.pixKey).toBe('rafael@pix');
    expect(r.saldo).toBe(700);
  });

  it('devolve os lançamentos com a parte dela', async () => {
    const r: any = await controller.ver('tok');
    expect(r.lancamentos).toHaveLength(2);
    expect(r.lancamentos[0].parteDela).toBe(100);
    expect(r.lancamentos[0].description).toBe('Jantar');
  });

  // A outra pessoa vê cinco linhas de mesmo nome numa viagem em 5x, uma por
  // mês. Sem o número ela não sabe qual já pagou — e o número não conta nada
  // sobre mim: nem banco, nem cartão, nem as outras pessoas.
  it('a parcela sai: é um fato do gasto que ela própria deve', async () => {
    const r: any = await controller.ver('tok');
    expect(r.lancamentos[0].parcela).toBe('2/5');
    expect(r.lancamentos[1].parcela).toBeNull();
  });

  // ----------------------------------------------------------
  // o que NÃO sai
  // ----------------------------------------------------------

  it('o nome do banco e do cartão NÃO saem: só "Cartão" e "Conta"', async () => {
    const r: any = await controller.ver('tok');
    expect(r.lancamentos[0].forma).toBe('Cartão');
    expect(r.lancamentos[1].forma).toBe('Conta');

    const tudo = JSON.stringify(r);
    expect(tudo).not.toContain('Nubank');
    expect(tudo).not.toContain('Roxinho');
    expect(tudo).not.toContain('Itaú');
  });

  it('nenhum id interno sai', async () => {
    const tudo = JSON.stringify(await controller.ver('tok'));
    for (const id of [
      'pessoa-interna-123',
      'despesa-interna-1',
      'despesa-interna-2',
      'cat-interna-9',
      'cat-interna-3',
      'acerto-interno-1',
      'conta-interna-7',
      'dono-interno',
    ]) {
      expect(tudo).not.toContain(id);
    }
  });

  // Quem me deve não tem nada a ver com quem mais divide gasto comigo.
  it('nenhuma OUTRA pessoa aparece', async () => {
    const tudo = JSON.stringify(await controller.ver('tok'));
    expect(tudo).not.toContain('outra-pessoa-666');
    expect(tudo).not.toContain('partes');
  });

  it('a minha parte não sai: o que ela deve é assunto dela', async () => {
    const r: any = await controller.ver('tok');
    expect(r.lancamentos[0]).not.toHaveProperty('minhaParte');
    expect(r).not.toHaveProperty('minhaParteNoMes');
  });

  // A peneira é uma lista do que SAI. Um campo novo no extrato privado tem
  // de nascer invisível aqui — este teste é o que garante isso.
  it('um campo novo no extrato privado não vaza sozinho', async () => {
    resumos.extratoDaPessoa.mockResolvedValue({
      ...EXTRATO_PRIVADO,
      segredoNovo: 'não deveria sair',
      lancamentos: [{ ...EXTRATO_PRIVADO.lancamentos[0], segredoDaLinha: 'nem este' }],
    });

    const tudo = JSON.stringify(await controller.ver('tok'));
    expect(tudo).not.toContain('não deveria sair');
    expect(tudo).not.toContain('nem este');
  });

  // ----------------------------------------------------------
  // o token
  // ----------------------------------------------------------

  it('token que não resolve dá 404', async () => {
    links.resolver.mockResolvedValue(null);
    await expect(controller.ver('qualquer')).rejects.toThrow(NotFoundException);
  });

  it('a mensagem é a MESMA para token inexistente, revogado e vencido', async () => {
    const mensagens: string[] = [];
    for (let i = 0; i < 3; i++) {
      links.resolver.mockResolvedValue(null);
      await controller.ver('t' + i).catch((e) => mensagens.push(e.message));
    }
    // Distinguir os casos conta a quem está chutando que aquele token um dia
    // valeu. Os três são o mesmo 404.
    expect(new Set(mensagens).size).toBe(1);
  });

  it('a rota está marcada como pública e o mês é repassado', async () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC, PublicSharedController.prototype.ver)).toBe(true);

    await controller.ver('tok', '2026-09');
    expect(resumos.extratoDaPessoa).toHaveBeenCalledWith('u1', 'rafael', '2026-09');
  });

  it('a visita é registrada, mas não atrapalha a resposta', async () => {
    links.registrarVisita.mockRejectedValue(new Error('banco fora'));
    await expect(controller.ver('tok')).resolves.toBeDefined();
  });
});

describe('ShareLinksService — o token', () => {
  let service: ShareLinksService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      shareLink: {
        create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data, createdAt: new Date() })),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareLinksService,
        { provide: PrismaService, useValue: prisma },
        { provide: PeopleService, useValue: { minha: jest.fn(async () => ({ id: 'rafael' })) } },
      ],
    }).compile();
    service = module.get(ShareLinksService);
  });

  it('o banco guarda o hash, nunca o token', async () => {
    const r = await service.create('u1', 'rafael');
    const gravado = prisma.shareLink.create.mock.calls[0][0].data;

    expect(gravado.tokenHash).toBe(hashDoToken(r.token));
    expect(gravado).not.toHaveProperty('token');
    expect(gravado.tokenHash).not.toBe(r.token);
  });

  it('a listagem não devolve nem o hash', async () => {
    await service.findByPerson('u1', 'rafael');
    const select = prisma.shareLink.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('tokenHash');
  });

  it('cada link tem um token diferente', async () => {
    const a = await service.create('u1', 'rafael');
    const b = await service.create('u1', 'rafael');
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThan(40);
  });

  it('resolver() devolve nada para token revogado', async () => {
    prisma.shareLink.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'u1',
      personId: 'rafael',
      revokedAt: new Date(),
      expiresAt: null,
    });
    expect(await service.resolver('tok')).toBeNull();
  });

  it('resolver() devolve nada para token vencido', async () => {
    prisma.shareLink.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'u1',
      personId: 'rafael',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await service.resolver('tok')).toBeNull();
  });

  it('resolver() aceita token válido e com validade no futuro', async () => {
    prisma.shareLink.findUnique.mockResolvedValue({
      id: 'l1',
      userId: 'u1',
      personId: 'rafael',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await service.resolver('tok')).toEqual({
      id: 'l1',
      userId: 'u1',
      personId: 'rafael',
    });
  });

  it('resolver() procura pelo HASH, nunca pelo token em claro', async () => {
    const token = gerarTokenOpaco();
    prisma.shareLink.findUnique.mockResolvedValue(null);

    await service.resolver(token);

    expect(prisma.shareLink.findUnique.mock.calls[0][0].where).toEqual({
      tokenHash: hashDoToken(token),
    });
  });

  it('token vazio não vira consulta nenhuma', async () => {
    expect(await service.resolver('')).toBeNull();
    expect(prisma.shareLink.findUnique).not.toHaveBeenCalled();
  });

  it('revogar duas vezes mantém a primeira data', async () => {
    const primeira = new Date('2026-10-01T10:00:00Z');
    prisma.shareLink.findFirst.mockResolvedValue({ id: 'l1', revokedAt: primeira });

    await service.revoke('u1', 'l1');

    expect(prisma.shareLink.update.mock.calls[0][0].data.revokedAt).toBe(primeira);
  });

  it('link de outro dono não existe para mim', async () => {
    prisma.shareLink.findFirst.mockResolvedValue(null);
    await expect(service.revoke('u1', 'de-outro')).rejects.toThrow(NotFoundException);
  });
});
