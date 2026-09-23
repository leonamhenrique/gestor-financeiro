// ============================================================
// auth.service.spec.ts
// ============================================================
// Os fluxos rodam contra um banco em memória com a mesma forma das tabelas,
// e não contra mocks soltos: rotação de sessão, reuso de token e bloqueio só
// são testados de verdade quando o estado persiste entre chamadas.
// ============================================================

import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import {
  AuthService,
  BLOQUEIO_MINUTOS,
  TENTATIVAS_ANTES_DO_BLOQUEIO,
} from './auth.service';
import { PasswordHasher } from './password-hasher';
import { Mailer, MailerDesligado } from './mailer.port';
import { hashDoToken } from './token.utils';

type Linha = Record<string, any>;

function casa(linha: Linha, where: Linha) {
  return Object.entries(where).every(([k, v]) => (v === null ? linha[k] == null : linha[k] === v));
}

function bancoEmMemoria() {
  const tabelas: Record<string, Linha[]> = { user: [], refreshToken: [], passwordResetToken: [] };

  function tabela(nome: string) {
    const linhas = tabelas[nome];
    return {
      findUnique: async ({ where, include, select }: any) => {
        const l = linhas.find((x) => casa(x, where));
        if (!l) return null;
        let r: Linha = { ...l };
        if (include?.user) r.user = { ...tabelas.user.find((u) => u.id === l.userId) };
        if (select) r = Object.fromEntries(Object.keys(select).map((k) => [k, l[k]]));
        return r;
      },
      create: async ({ data }: any) => {
        if (nome === 'user' && linhas.some((u) => u.email === data.email)) {
          throw Object.assign(new Error('Unique'), { code: 'P2002' });
        }
        const l = {
          id: randomUUID(),
          createdAt: new Date(),
          ...(nome === 'user' ? { failedLoginAttempts: 0, lockedUntil: null } : {}),
          ...(nome === 'refreshToken' ? { revokedAt: null, replacedById: null } : {}),
          ...(nome === 'passwordResetToken' ? { usedAt: null } : {}),
          ...data,
        };
        linhas.push(l);
        return { ...l };
      },
      update: async ({ where, data }: any) => {
        const l = linhas.find((x) => casa(x, where));
        if (!l) throw new Error('not found');
        Object.assign(l, data);
        return { ...l };
      },
      updateMany: async ({ where, data }: any) => {
        const alvo = linhas.filter((x) => casa(x, where));
        alvo.forEach((l) => Object.assign(l, data));
        return { count: alvo.length };
      },
    };
  }

  const prisma: any = {
    user: tabela('user'),
    refreshToken: tabela('refreshToken'),
    passwordResetToken: tabela('passwordResetToken'),
    $transaction: async (cb: any) => cb(prisma),
    _tabelas: tabelas,
  };
  return prisma;
}

describe('AuthService', () => {
  let prisma: any;
  let service: AuthService;
  let jwt: JwtService;
  let enviados: { email: string; link: string }[];

  const cadastro = { name: 'Ana Souza', email: 'Ana@Ex.com ', password: 'segura123' };

  beforeEach(() => {
    prisma = bancoEmMemoria();
    jwt = new JwtService({ secret: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres' });
    enviados = [];
    const mailer: Mailer = {
      enviarRedefinicaoDeSenha: async (destino, link) => {
        enviados.push({ email: destino.email, link });
      },
    };
    service = new AuthService(prisma, jwt, new PasswordHasher({ N: 1024, r: 8, p: 1 }), mailer);
  });

  const tokenDoLink = (link: string) => decodeURIComponent(link.split('token=')[1]);

  describe('cadastro', () => {
    it('cria o usuário com e-mail normalizado e devolve a sessão', async () => {
      const s = await service.register(cadastro);
      expect(s.user).toMatchObject({ name: 'Ana Souza', email: 'ana@ex.com' });
      expect(jwt.verify(s.accessToken)).toMatchObject({ sub: s.user.id, email: 'ana@ex.com' });
      expect(s.refreshToken.length).toBeGreaterThan(30);
    });

    it('a senha e o refresh token nunca vão para o banco como vieram', async () => {
      const s = await service.register(cadastro);
      const banco = JSON.stringify(prisma._tabelas);
      expect(banco).not.toContain('segura123');
      expect(banco).not.toContain(s.refreshToken);
      expect(prisma._tabelas.refreshToken[0].tokenHash).toBe(hashDoToken(s.refreshToken));
    });

    it('recusa e-mail repetido, sem diferenciar maiúsculas', async () => {
      await service.register(cadastro);
      await expect(service.register({ ...cadastro, email: 'ANA@EX.COM' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    beforeEach(() => service.register(cadastro));

    it('entra com a senha certa', async () => {
      const s = await service.login({ email: 'ana@ex.com', password: 'segura123' });
      expect(s.user.email).toBe('ana@ex.com');
    });

    it('senha errada e e-mail inexistente recebem a MESMA resposta', async () => {
      const erroSenha = await service.login({ email: 'ana@ex.com', password: 'errada123' }).catch((e) => e);
      const erroEmail = await service.login({ email: 'ninguem@ex.com', password: 'errada123' }).catch((e) => e);
      expect(erroSenha).toBeInstanceOf(UnauthorizedException);
      expect(erroEmail).toBeInstanceOf(UnauthorizedException);
      expect(erroSenha.message).toBe(erroEmail.message);
    });

    it(`bloqueia após ${TENTATIVAS_ANTES_DO_BLOQUEIO} erros — até com a senha certa`, async () => {
      for (let i = 0; i < TENTATIVAS_ANTES_DO_BLOQUEIO; i++) {
        await service.login({ email: 'ana@ex.com', password: 'errada123' }).catch(() => undefined);
      }
      const erro = await service.login({ email: 'ana@ex.com', password: 'segura123' }).catch((e) => e);
      expect(erro).toBeInstanceOf(HttpException);
      expect(erro.getStatus()).toBe(429);
    });

    it('o bloqueio acaba sozinho depois do prazo', async () => {
      const user = prisma._tabelas.user[0];
      user.lockedUntil = new Date(Date.now() - 1000);
      user.failedLoginAttempts = 0;
      await expect(service.login({ email: 'ana@ex.com', password: 'segura123' })).resolves.toBeDefined();
      expect(user.lockedUntil).toBeNull();
    });

    it('acertar a senha zera o contador de erros', async () => {
      await service.login({ email: 'ana@ex.com', password: 'errada123' }).catch(() => undefined);
      await service.login({ email: 'ana@ex.com', password: 'errada123' }).catch(() => undefined);
      expect(prisma._tabelas.user[0].failedLoginAttempts).toBe(2);
      await service.login({ email: 'ana@ex.com', password: 'segura123' });
      expect(prisma._tabelas.user[0].failedLoginAttempts).toBe(0);
    });

    it('bloqueio dura o tempo combinado', async () => {
      for (let i = 0; i < TENTATIVAS_ANTES_DO_BLOQUEIO; i++) {
        await service.login({ email: 'ana@ex.com', password: 'errada123' }).catch(() => undefined);
      }
      const minutos = (prisma._tabelas.user[0].lockedUntil.getTime() - Date.now()) / 60_000;
      expect(minutos).toBeGreaterThan(BLOQUEIO_MINUTOS - 1);
      expect(minutos).toBeLessThanOrEqual(BLOQUEIO_MINUTOS);
    });
  });

  describe('sessão com rotação', () => {
    it('renovar troca o refresh token e o antigo para de valer', async () => {
      const s1 = await service.register(cadastro);
      const s2 = await service.refresh(s1.refreshToken);
      expect(s2.refreshToken).not.toBe(s1.refreshToken);
      await expect(service.refresh(s2.refreshToken)).resolves.toBeDefined();
    });

    it('reusar um token já trocado derruba o login inteiro (sinal de roubo)', async () => {
      const s1 = await service.register(cadastro);
      const s2 = await service.refresh(s1.refreshToken); // dono legítimo renovou
      await expect(service.refresh(s1.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException); // cópia roubada
      // …e o token atual do dono também caiu, porque não dá para saber quem é quem.
      await expect(service.refresh(s2.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reuso derruba só aquele login, não os outros aparelhos', async () => {
      const celular = await service.register(cadastro);
      const notebook = await service.login({ email: 'ana@ex.com', password: 'segura123' });
      await service.refresh(celular.refreshToken);
      await service.refresh(celular.refreshToken).catch(() => undefined);
      await expect(service.refresh(notebook.refreshToken)).resolves.toBeDefined();
    });

    it('token vencido não renova', async () => {
      const s = await service.register(cadastro);
      prisma._tabelas.refreshToken[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.refresh(s.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('token desconhecido não renova', async () => {
      await expect(service.refresh('x'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('sair encerra a sessão, e sair de novo não é erro', async () => {
      const s = await service.register(cadastro);
      await service.logout(s.refreshToken);
      await expect(service.refresh(s.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.logout(s.refreshToken)).resolves.toBeUndefined();
      await expect(service.logout('nunca-existiu-'.repeat(3))).resolves.toBeUndefined();
    });
  });

  describe('esqueci minha senha', () => {
    beforeEach(() => service.register(cadastro));

    it('e-mail que não existe: mesma resposta, e nada é enviado', async () => {
      await expect(service.forgotPassword('ninguem@ex.com')).resolves.toBeUndefined();
      expect(enviados).toHaveLength(0);
    });

    // MAIL_PROVIDER=NONE: recusa antes de olhar o usuário, senão a diferença
    // entre "recusou" e "silêncio" diria quais e-mails existem.
    it('sem serviço de e-mail, recusa igual para quem existe e quem não existe', async () => {
      const semEmail = new AuthService(
        prisma,
        jwt,
        new PasswordHasher({ N: 1024, r: 8, p: 1 }),
        new MailerDesligado(),
      );
      await expect(semEmail.forgotPassword('ana@ex.com')).rejects.toThrow(ServiceUnavailableException);
      await expect(semEmail.forgotPassword('ninguem@ex.com')).rejects.toThrow(ServiceUnavailableException);
      expect(prisma._tabelas.passwordResetToken).toHaveLength(0);
    });

    it('envia um link, e o token do link não fica no banco', async () => {
      await service.forgotPassword(' ANA@ex.com ');
      expect(enviados).toHaveLength(1);
      const token = tokenDoLink(enviados[0].link);
      expect(JSON.stringify(prisma._tabelas.passwordResetToken)).not.toContain(token);
    });

    it('redefinir troca a senha, derruba as sessões e zera o bloqueio', async () => {
      const antes = await service.login({ email: 'ana@ex.com', password: 'segura123' });
      prisma._tabelas.user[0].lockedUntil = new Date(Date.now() + 60_000);
      await service.forgotPassword('ana@ex.com');
      await service.resetPassword(tokenDoLink(enviados[0].link), 'novaSenha456');

      await expect(service.refresh(antes.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login({ email: 'ana@ex.com', password: 'segura123' })).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login({ email: 'ana@ex.com', password: 'novaSenha456' })).resolves.toBeDefined();
    });

    it('o link vale uma vez só', async () => {
      await service.forgotPassword('ana@ex.com');
      const token = tokenDoLink(enviados[0].link);
      await service.resetPassword(token, 'novaSenha456');
      await expect(service.resetPassword(token, 'outraSenha789')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('link vencido não vale', async () => {
      await service.forgotPassword('ana@ex.com');
      prisma._tabelas.passwordResetToken[0].expiresAt = new Date(Date.now() - 1000);
      await expect(service.resetPassword(tokenDoLink(enviados[0].link), 'novaSenha456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('pedir de novo invalida o link anterior', async () => {
      await service.forgotPassword('ana@ex.com');
      await service.forgotPassword('ana@ex.com');
      const primeiro = tokenDoLink(enviados[0].link);
      const segundo = tokenDoLink(enviados[1].link);
      await expect(service.resetPassword(primeiro, 'novaSenha456')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.resetPassword(segundo, 'novaSenha456')).resolves.toBeUndefined();
    });
  });

  describe('trocar a senha logado', () => {
    it('exige a senha atual, derruba as outras sessões e mantém este aparelho', async () => {
      const outro = await service.register(cadastro);
      const id = outro.user.id;
      await expect(service.changePassword(id, 'errada123', 'novaSenha456')).rejects.toBeInstanceOf(UnauthorizedException);

      const nova = await service.changePassword(id, 'segura123', 'novaSenha456');
      await expect(service.refresh(outro.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.refresh(nova.refreshToken)).resolves.toBeDefined();
      await expect(service.login({ email: 'ana@ex.com', password: 'novaSenha456' })).resolves.toBeDefined();
    });
  });

  describe('me', () => {
    it('devolve só dados públicos — nunca o hash', async () => {
      const s = await service.register(cadastro);
      const eu = await service.me(s.user.id);
      expect(eu).toMatchObject({ id: s.user.id, name: 'Ana Souza', email: 'ana@ex.com' });
      expect(eu).not.toHaveProperty('passwordHash');
    });
  });
});
