import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController — sinal de vida', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('responde que está de pé', () => {
    expect(appController.estado().ok).toBe(true);
  });

  // "O meu conserto já está no ar?" é pergunta de todo deploy, e responder
  // por adivinhação já saiu caro aqui.
  it('diz qual commit está respondendo', () => {
    const antes = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = 'e2785b5aaaaaaaaaaaaaaaaaaaaa';
    try {
      expect(appController.estado().versao).toBe('e2785b5');
    } finally {
      if (antes === undefined) delete process.env.RENDER_GIT_COMMIT;
      else process.env.RENDER_GIT_COMMIT = antes;
    }
  });

  it('fora do Render, diz "local" em vez de inventar', () => {
    const antes = process.env.RENDER_GIT_COMMIT;
    delete process.env.RENDER_GIT_COMMIT;
    try {
      expect(appController.estado().versao).toBe('local');
    } finally {
      if (antes !== undefined) process.env.RENDER_GIT_COMMIT = antes;
    }
  });

  // Não devolve dado de ninguém: é rota pública.
  it('não vaza nada além de ok, versão e hora da subida', () => {
    expect(Object.keys(appController.estado()).sort()).toEqual(['ok', 'subiuEm', 'versao']);
  });
});
