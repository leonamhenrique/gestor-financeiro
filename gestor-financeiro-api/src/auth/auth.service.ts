// ============================================================
// auth.service.ts
// ============================================================
// Cadastro, login, sessão e recuperação de senha. Regras que não se negociam:
//
// 1. Senha nunca é gravada nem registrada em log — só o hash scrypt.
// 2. Login errado responde SEMPRE a mesma coisa ("e-mail ou senha
//    inválidos"), exista o e-mail ou não, e leva o mesmo tempo nos dois
//    casos: sem isso dá para descobrir quem tem conta.
// 3. Cinco senhas erradas seguidas bloqueiam a conta por 15 minutos.
// 4. Acesso por token curto (15 min) + sessão por refresh token com rotação:
//    cada uso gera um novo, e reapresentar um já usado revoga o login inteiro.
// 5. "Esqueci minha senha" não diz se o e-mail existe; o link vale uma vez,
//    por 30 minutos, e usá-lo derruba todas as sessões abertas.
// ============================================================

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordHasher } from './password-hasher';
import { gerarTokenOpaco, hashDoToken } from './token.utils';
import { MAILER, Mailer } from './mailer.port';

export const ACESSO_SEGUNDOS = 15 * 60;
export const SESSAO_DIAS = 30;
export const REDEFINICAO_MINUTOS = 30;
export const TENTATIVAS_ANTES_DO_BLOQUEIO = 5;
export const BLOQUEIO_MINUTOS = 15;

const MSG_CREDENCIAIS = 'E-mail ou senha inválidos.';
const MSG_SESSAO = 'Sessão expirada. Entre de novo.';

export interface SessaoEmitida {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; email: string };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Hash de uma senha qualquer, calculado uma vez. Quando o e-mail não
  // existe, a senha é conferida contra ele para gastar o mesmo tempo.
  private hashFantasma: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    this.hashFantasma = this.hasher.gerar(randomUUID());
  }

  // ----------------------------------------------------------
  // Cadastro
  // ----------------------------------------------------------
  async register(dados: { name: string; email: string; password: string }): Promise<SessaoEmitida> {
    const email = dados.email.trim().toLowerCase();
    const existente = await this.prisma.user.findUnique({ where: { email } });
    // No cadastro, dizer que o e-mail já existe é inevitável para a pessoa
    // entender o que fazer. Quem quer esconder isso precisa de confirmação por
    // e-mail antes de criar a conta — fica como evolução.
    if (existente) throw new ConflictException('Este e-mail já tem cadastro. Entre ou recupere a senha.');

    const passwordHash = await this.hasher.gerar(dados.password);
    try {
      const user = await this.prisma.user.create({
        data: { name: dados.name.trim(), email, passwordHash },
      });
      return this.abrirSessao(user);
    } catch (erro: any) {
      // Dois cadastros simultâneos com o mesmo e-mail: o índice único decide.
      if (erro?.code === 'P2002') throw new ConflictException('Este e-mail já tem cadastro. Entre ou recupere a senha.');
      throw erro;
    }
  }

  // ----------------------------------------------------------
  // Login
  // ----------------------------------------------------------
  async login(dados: { email: string; password: string }): Promise<SessaoEmitida> {
    const email = dados.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.hasher.conferir(dados.password, await this.hashFantasma);
      throw new UnauthorizedException(MSG_CREDENCIAIS);
    }

    const agora = new Date();
    if (user.lockedUntil && user.lockedUntil > agora) {
      throw new HttpException(
        'Muitas tentativas erradas. Tente de novo em alguns minutos ou redefina a senha.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const confere = await this.hasher.conferir(dados.password, user.passwordHash);
    if (!confere) {
      const tentativas = (user.failedLoginAttempts ?? 0) + 1;
      const bloqueia = tentativas >= TENTATIVAS_ANTES_DO_BLOQUEIO;
      await this.prisma.user.update({
        where: { id: user.id },
        data: bloqueia
          ? { failedLoginAttempts: 0, lockedUntil: new Date(agora.getTime() + BLOQUEIO_MINUTOS * 60_000) }
          : { failedLoginAttempts: tentativas },
      });
      throw new UnauthorizedException(MSG_CREDENCIAIS);
    }

    // Senha certa: zera o contador e, se o custo do hash mudou desde que ele
    // foi gerado, aproveita que temos a senha em mãos para refazê-lo.
    const dadosAtualizados: Record<string, unknown> = {};
    if (user.failedLoginAttempts || user.lockedUntil) {
      dadosAtualizados.failedLoginAttempts = 0;
      dadosAtualizados.lockedUntil = null;
    }
    if (this.hasher.precisaRefazer(user.passwordHash)) {
      dadosAtualizados.passwordHash = await this.hasher.gerar(dados.password);
    }
    if (Object.keys(dadosAtualizados).length) {
      await this.prisma.user.update({ where: { id: user.id }, data: dadosAtualizados });
    }

    return this.abrirSessao(user);
  }

  // ----------------------------------------------------------
  // Sessão (refresh token com rotação)
  // ----------------------------------------------------------
  async refresh(refreshToken: string): Promise<SessaoEmitida> {
    const atual = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashDoToken(refreshToken) },
      include: { user: true },
    });
    if (!atual) throw new UnauthorizedException(MSG_SESSAO);

    if (atual.revokedAt) {
      // Token que já foi trocado voltou a aparecer: alguém guardou uma cópia.
      // Não dá para saber quem é o dono legítimo, então o login inteiro cai.
      await this.revogarFamilia(atual.familyId);
      throw new UnauthorizedException(MSG_SESSAO);
    }
    if (atual.expiresAt <= new Date()) throw new UnauthorizedException(MSG_SESSAO);

    return this.prisma.$transaction(async (tx) => {
      const novo = gerarTokenOpaco();
      const registro = await tx.refreshToken.create({
        data: {
          userId: atual.userId,
          tokenHash: hashDoToken(novo),
          familyId: atual.familyId,
          expiresAt: this.expiracaoSessao(),
        },
      });
      // A troca só vale se o token ainda não tinha sido revogado — protege
      // contra duas renovações simultâneas com o mesmo token.
      const trocado = await tx.refreshToken.updateMany({
        where: { id: atual.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: registro.id },
      });
      if (trocado.count === 0) throw new UnauthorizedException(MSG_SESSAO);

      return {
        accessToken: this.assinarAcesso(atual.user),
        refreshToken: novo,
        expiresIn: ACESSO_SEGUNDOS,
        user: this.publico(atual.user),
      };
    });
  }

  /** Encerra a sessão deste aparelho. Idempotente: token desconhecido ou já
   * encerrado não é erro — o resultado desejado ("não estou logado") já vale. */
  async logout(refreshToken: string): Promise<void> {
    const atual = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashDoToken(refreshToken) },
    });
    if (atual) await this.revogarFamilia(atual.familyId);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  // ----------------------------------------------------------
  // Recuperação e troca de senha
  // ----------------------------------------------------------
  /** Sempre termina em silêncio: a resposta é a mesma exista o e-mail ou não. */
  async forgotPassword(emailInformado: string): Promise<void> {
    // Antes de olhar o usuário: recusar só para e-mails existentes revelaria
    // quais estão cadastrados.
    if (this.mailer.disponivel === false) {
      throw new ServiceUnavailableException(
        'A recuperação de senha por e-mail ainda não está disponível neste ambiente.',
      );
    }
    const email = emailInformado.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;

    const token = gerarTokenOpaco();
    await this.prisma.$transaction(async (tx) => {
      // Só o link mais recente vale: pedir de novo invalida os anteriores.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashDoToken(token),
          expiresAt: new Date(Date.now() + REDEFINICAO_MINUTOS * 60_000),
        },
      });
    });

    // O link é a RAIZ do app com o token na query: o app é uma página só, e um
    // caminho como /redefinir-senha daria 404 em hospedagem estática.
    const base = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    try {
      await this.mailer.enviarRedefinicaoDeSenha(
        { email: user.email, nome: user.name },
        `${base}/?token=${encodeURIComponent(token)}`,
      );
    } catch (erro) {
      // Falha de entrega fica no log e morre aqui. Propagar daria erro 500 para
      // e-mail cadastrado e silêncio para o resto — a diferença entre as duas
      // respostas seria um jeito de descobrir quem tem conta.
      this.logger.error(`Falha ao enviar o e-mail de redefinição: ${(erro as Error).message}`);
    }
  }

  async resetPassword(token: string, novaSenha: string): Promise<void> {
    const registro = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashDoToken(token) },
    });
    if (!registro || registro.usedAt || registro.expiresAt <= new Date()) {
      throw new UnauthorizedException('Link inválido ou expirado. Peça um novo.');
    }

    const passwordHash = await this.hasher.gerar(novaSenha);
    await this.prisma.$transaction(async (tx) => {
      // Marca como usado primeiro, condicionado a ainda não ter sido: o mesmo
      // link não troca a senha duas vezes nem em requisições simultâneas.
      const usado = await tx.passwordResetToken.updateMany({
        where: { id: registro.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (usado.count === 0) throw new UnauthorizedException('Link inválido ou expirado. Peça um novo.');

      await tx.user.update({
        where: { id: registro.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      // Quem pediu redefinição pode estar recuperando uma conta invadida:
      // todas as sessões abertas caem.
      await tx.refreshToken.updateMany({
        where: { userId: registro.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async changePassword(userId: string, senhaAtual: string, novaSenha: string): Promise<SessaoEmitida> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await this.hasher.conferir(senhaAtual, user.passwordHash))) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }
    const passwordHash = await this.hasher.gerar(novaSenha);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    // As outras sessões caíram; este aparelho recebe uma nova para continuar.
    return this.abrirSessao(user);
  }

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  private async abrirSessao(user: { id: string; name: string; email: string }): Promise<SessaoEmitida> {
    const refreshToken = gerarTokenOpaco();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashDoToken(refreshToken),
        familyId: randomUUID(),
        expiresAt: this.expiracaoSessao(),
      },
    });
    return {
      accessToken: this.assinarAcesso(user),
      refreshToken,
      expiresIn: ACESSO_SEGUNDOS,
      user: this.publico(user),
    };
  }

  private assinarAcesso(user: { id: string; email: string }) {
    return this.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: ACESSO_SEGUNDOS });
  }

  private async revogarFamilia(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private expiracaoSessao() {
    return new Date(Date.now() + SESSAO_DIAS * 24 * 60 * 60_000);
  }

  private publico(user: { id: string; name: string; email: string }) {
    return { id: user.id, name: user.name, email: user.email };
  }
}
