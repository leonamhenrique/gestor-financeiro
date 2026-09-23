import { PasswordHasher } from './password-hasher';

// Custo baixo só para o teste rodar rápido; o formato e a lógica são os mesmos.
const rapido = { N: 1024, r: 8, p: 1 };

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(rapido);

  it('nunca guarda a senha: o gravado é o formato scrypt, sem o texto original', async () => {
    const gravado = await hasher.gerar('segura123');
    expect(gravado.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(gravado).not.toContain('segura123');
  });

  it('confere a senha certa e recusa a errada', async () => {
    const gravado = await hasher.gerar('segura123');
    await expect(hasher.conferir('segura123', gravado)).resolves.toBe(true);
    await expect(hasher.conferir('segura124', gravado)).resolves.toBe(false);
    await expect(hasher.conferir('', gravado)).resolves.toBe(false);
  });

  it('sal aleatório: a mesma senha gera hashes diferentes', async () => {
    const a = await hasher.gerar('segura123');
    const b = await hasher.gerar('segura123');
    expect(a).not.toBe(b);
    await expect(hasher.conferir('segura123', b)).resolves.toBe(true);
  });

  it('normaliza unicode: "é" composto e decomposto são a mesma senha', async () => {
    const gravado = await hasher.gerar('café123');
    await expect(hasher.conferir('café123', gravado)).resolves.toBe(true);
  });

  it.each(['', 'lixo', 'bcrypt$x$y', 'scrypt$0$8$1$AAAA$BBBB', 'scrypt$1024$8$1$AAAA$curto'])(
    'hash mal formado (%p) nunca confere e nunca lança',
    async (gravado) => {
      await expect(hasher.conferir('segura123', gravado)).resolves.toBe(false);
    },
  );

  it('confere hash antigo com outro custo e avisa que precisa refazer', async () => {
    const antigo = await new PasswordHasher({ N: 512, r: 8, p: 1 }).gerar('segura123');
    await expect(hasher.conferir('segura123', antigo)).resolves.toBe(true);
    expect(hasher.precisaRefazer(antigo)).toBe(true);
    expect(hasher.precisaRefazer(await hasher.gerar('segura123'))).toBe(false);
  });
});
