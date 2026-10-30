// ============================================================
// audio.service.spec.ts
// ============================================================
// O áudio sai do servidor para um terceiro. O que se prova aqui é quando ele
// NÃO sai: sem provedor configurado, sem chave, e quando o arquivo é grande
// demais — nesse caso ele é recusado antes de ser baixado.
// ============================================================

import { AudioService } from './audio.service';

describe('AudioService', () => {
  let service: AudioService;
  let chamadas: string[];
  const original = { ...process.env };

  function responder(respostas: any[]) {
    let i = 0;
    (global as any).fetch = jest.fn(async (url: string) => {
      chamadas.push(String(url));
      const r = respostas[i++];
      if (!r) throw new Error('fetch a mais: ' + url);
      return r;
    });
  }

  const ok = (json: any) => ({ ok: true, json: async () => json });
  const bytes = (n: number) => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(n) });

  beforeEach(() => {
    chamadas = [];
    service = new AudioService();
    process.env.WHATSAPP_TOKEN = 'token-de-teste';
    process.env.STT_PROVIDER = 'openai';
    process.env.STT_API_KEY = 'chave-de-teste';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('sem provedor configurado, nao escuta e nao sai nada daqui', async () => {
    delete process.env.STT_PROVIDER;
    responder([]);
    expect(service.disponivel()).toBe(false);
    expect(await service.ouvir('media-1')).toBeNull();
    expect(chamadas).toHaveLength(0);
  });

  it('sem chave do transcritor, tambem nao', async () => {
    delete process.env.STT_API_KEY;
    responder([]);
    expect(service.disponivel()).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('baixa, transcreve e devolve o que foi dito', async () => {
    responder([
      ok({ url: 'https://lookaside.fb/audio', mime_type: 'audio/ogg', file_size: 12345 }),
      bytes(12345),
      ok({ text: '  gastei 40 no mercado  ' }),
    ]);
    expect(await service.ouvir('media-1')).toBe('gastei 40 no mercado');
    expect(chamadas[0]).toContain('/media-1');
    expect(chamadas[1]).toBe('https://lookaside.fb/audio');
    expect(chamadas[2]).toContain('api.openai.com');
  });

  it('arquivo grande demais e recusado ANTES de baixar', async () => {
    responder([ok({ url: 'https://lookaside.fb/audio', file_size: 9 * 1024 * 1024 })]);
    expect(await service.ouvir('media-1')).toBeNull();
    // Uma chamada só: a dos metadados. Os bytes não chegaram a sair da Meta.
    expect(chamadas).toHaveLength(1);
  });

  it('erro da Meta vira "nao consegui", e nao exceção', async () => {
    responder([{ ok: false, json: async () => ({}) }]);
    await expect(service.ouvir('media-1')).resolves.toBeNull();
  });

  it('erro do transcritor tambem', async () => {
    responder([
      ok({ url: 'https://lookaside.fb/audio', file_size: 100 }),
      bytes(100),
      { ok: false, status: 429, json: async () => ({}) },
    ]);
    await expect(service.ouvir('media-1')).resolves.toBeNull();
  });

  it('provedor desconhecido nao manda audio para lugar nenhum', async () => {
    process.env.STT_PROVIDER = 'inventado';
    responder([ok({ url: 'https://lookaside.fb/audio', file_size: 100 }), bytes(100)]);
    expect(await service.ouvir('media-1')).toBeNull();
    // Baixou da Meta, mas não saiu para terceiro nenhum.
    expect(chamadas.every((u) => !u.includes('openai'))).toBe(true);
  });

  it('a transcricao vazia e "nao entendi", nao frase vazia', async () => {
    responder([
      ok({ url: 'https://lookaside.fb/audio', file_size: 100 }),
      bytes(100),
      ok({ text: '   ' }),
    ]);
    expect(await service.ouvir('media-1')).toBeNull();
  });
});
