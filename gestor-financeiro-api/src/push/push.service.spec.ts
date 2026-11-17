// ============================================================
// push.service.spec.ts
// ============================================================
// Duas coisas podem estragar calado aqui: avisar DEMAIS, que é como uma
// notificação útil vira uma que a pessoa desliga; e guardar inscrição morta
// para sempre, tentando entregar todo dia a um aparelho que não existe mais.
// ============================================================

import { PushService, problemaNaChavePublica, pushLigado } from './push.service';
import { FalhaDePush } from './push.port';

describe('PushService', () => {
  let service: PushService;
  let prisma: any;
  /* Um dublê da PORTA, e não da biblioteca. A diferença importou de
   * verdade: com `jest.mock('web-push')` o teste passava sem nunca
   * carregar o módulo — e foi em produção, no Node mais velho do Render,
   * que o `require()` dele estourou. O que esta suíte cobre é a REGRA;
   * quem carrega a biblioteca é o `WebPushEnviador`, sozinho. */
  let enviador: { enviar: jest.Mock };
  const antes = { ...process.env };

  const aparelho = (over: any = {}) => ({
    id: 'ap-1',
    userId: 'u1',
    endpoint: 'https://push.exemplo/abc',
    p256dh: 'chave-publica-do-navegador',
    auth: 'segredo-do-navegador',
    ultimoAvisoEm: null,
    ...over,
  });

  /* Com a FORMA de uma chave de verdade: 65 bytes começando com 4. Uma
   * string qualquer já não serve, e é de propósito — a validação que
   * recusa chave torta é justamente o que faltava. */
  const PUBLICA = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = PUBLICA;
    process.env.VAPID_PRIVATE_KEY = 'privada-de-teste';
    prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    enviador = { enviar: jest.fn().mockResolvedValue(undefined) };
    service = new PushService(prisma, enviador);
  });

  afterEach(() => {
    process.env = { ...antes };
  });

  // ---------------------------------------------------------------- chaves
  /* Isto nasceu de um defeito real: as duas chaves foram trocadas no
   * painel, e o navegador respondeu "The provided applicationServerKey is
   * not valid" -- frase que não diz a quem configurou o que fazer. */
  describe('a chave pública', () => {
    /* 65 bytes começando com 4: uma chave P-256 não comprimida de verdade. */
    const publicaValida = PUBLICA;
    const privada = Buffer.alloc(32, 9).toString('base64url');

    it('válida não tem problema, e liga o recurso', () => {
      process.env.VAPID_PUBLIC_KEY = publicaValida;
      expect(problemaNaChavePublica()).toBe('');
      expect(pushLigado()).toBe(true);
    });

    it('vazia diz que está vazia', () => {
      delete process.env.VAPID_PUBLIC_KEY;
      expect(problemaNaChavePublica()).toContain('vazia');
      expect(pushLigado()).toBe(false);
    });

    /* O caso que aconteceu: 32 bytes é a PRIVADA no campo da pública. */
    it('com 32 bytes, diz que as duas estão trocadas', () => {
      process.env.VAPID_PUBLIC_KEY = privada;
      expect(problemaNaChavePublica()).toContain('trocadas');
      expect(pushLigado()).toBe(false);
    });

    it('com tamanho errado, diz o tamanho', () => {
      process.env.VAPID_PUBLIC_KEY = Buffer.alloc(40, 1).toString('base64url');
      expect(problemaNaChavePublica()).toContain('40 bytes');
    });

    it('com 65 bytes mas começo errado, recusa também', () => {
      process.env.VAPID_PUBLIC_KEY = Buffer.alloc(65, 1).toString('base64url');
      expect(problemaNaChavePublica()).toContain('byte 4');
      expect(pushLigado()).toBe(false);
    });

    /* Chave quebrada não é "avisa errado": é "não avisa". */
    it('chave quebrada não manda aviso nenhum', async () => {
      process.env.VAPID_PUBLIC_KEY = privada;
      prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);

      expect(await service.avisar('u1', 5)).toBe(0);
      expect(enviador.enviar).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------- inscrever
  /* O mesmo aparelho duas vezes é o MESMO aparelho: o navegador devolve o
   * mesmo endpoint, e duas linhas iguais virariam dois avisos. */
  it('inscrever é por endpoint, e não cria duplicata', async () => {
    await service.inscrever('u1', {
      endpoint: 'https://push.exemplo/abc',
      keys: { p256dh: 'p', auth: 'a' },
    });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: 'https://push.exemplo/abc' } }),
    );
  });

  /* Alguém sai da conta e outra pessoa entra no mesmo navegador: sem trocar
   * o dono, o aviso da primeira continuaria chegando no aparelho da
   * segunda. */
  it('aparelho que troca de dono troca de dono mesmo, e zera o histórico', async () => {
    await service.inscrever('u2', {
      endpoint: 'https://push.exemplo/abc',
      keys: { p256dh: 'p', auth: 'a' },
    });
    const chamada = prisma.pushSubscription.upsert.mock.calls[0][0];
    expect(chamada.update).toMatchObject({ userId: 'u2', ultimoAvisoEm: null });
  });

  // ---------------------------------------------------------------- avisar
  it('sem chaves no ambiente, não avisa ninguém', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);

    expect(await service.avisar('u1', 5)).toBe(0);
    expect(enviador.enviar).not.toHaveBeenCalled();
  });

  it('com zero esperando, não avisa', async () => {
    expect(await service.avisar('u1', 0)).toBe(0);
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it('avisa cada aparelho da pessoa', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      aparelho(),
      aparelho({ id: 'ap-2', endpoint: 'https://push.exemplo/def' }),
    ]);

    expect(await service.avisar('u1', 3)).toBe(2);
    expect(enviador.enviar).toHaveBeenCalledTimes(2);
  });

  /* O carimbo é o que impede o segundo aviso do dia. Ele vai para o BANCO,
   * e não para a memória: duas instâncias da API acordando às 6h mandariam
   * dois avisos. */
  it('quem já foi avisado hoje fica de fora da busca', async () => {
    await service.avisar('u1', 3);
    const where = prisma.pushSubscription.findMany.mock.calls[0][0].where;
    expect(where.userId).toBe('u1');
    expect(where.OR[0]).toEqual({ ultimoAvisoEm: null });
    expect(where.OR[1].ultimoAvisoEm.lt).toBeInstanceOf(Date);
  });

  it('avisou, carimba', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);
    await service.avisar('u1', 3);
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ap-1' } }),
    );
  });

  // ------------------------------------------------------- o que vai junto
  /* A notificação aparece na tela bloqueada, onde quem está ao lado também
   * lê. Um número não conta a ninguém o que você gastou; um lojista conta. */
  it('o aviso leva um número, e nada do gasto', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);
    await service.avisar('u1', 7);

    const corpo = JSON.parse(enviador.enviar.mock.calls[0][1]);
    expect(corpo.total).toBe(7);
    expect(corpo.titulo).toContain('7');
    expect(JSON.stringify(corpo)).not.toMatch(/R\$|\d+,\d{2}/);
  });

  it('um só fala no singular', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);
    await service.avisar('u1', 1);
    const corpo = JSON.parse(enviador.enviar.mock.calls[0][1]);
    expect(corpo.titulo).toBe('1 lançamento esperando você');
  });

  // --------------------------------------------------------- o que morreu
  /* 404 e 410 são o serviço de push dizendo que o aparelho não existe mais.
   * Guardar a inscrição seria tentar de novo todo dia, para sempre. */
  it('aparelho que o serviço diz não existir mais é apagado', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);
    enviador.enviar.mockRejectedValue(new FalhaDePush('sumiu', 410));

    expect(await service.avisar('u1', 3)).toBe(0);
    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'ap-1' } });
  });

  /* Erro passageiro — provedor fora, rede — não apaga nada: o aparelho
   * continua existindo e amanhã recebe. */
  it('erro passageiro não apaga a inscrição', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([aparelho()]);
    enviador.enviar.mockRejectedValue(new FalhaDePush('provedor fora', 500));

    expect(await service.avisar('u1', 3)).toBe(0);
    expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
  });

  it('um aparelho que falha não impede os outros', async () => {
    prisma.pushSubscription.findMany.mockResolvedValue([
      aparelho(),
      aparelho({ id: 'ap-2', endpoint: 'https://push.exemplo/def' }),
    ]);
    enviador.enviar
      .mockRejectedValueOnce(new FalhaDePush('provedor fora', 500))
      .mockResolvedValue(undefined);

    expect(await service.avisar('u1', 3)).toBe(1);
  });
});
