// ============================================================
// share-links.service.ts
// ============================================================
// O link que mostra a conta a quem deve (ou a quem me deve), sem login.
//
// Duas decisões que valem a pena ler antes de mexer aqui:
//
// 1. O TOKEN EM CLARO EXISTE UMA VEZ SÓ, na resposta da criação. O banco
//    guarda só o SHA-256 dele, igual aos tokens de sessão: quem ler o banco
//    não consegue usar o que encontrar. Perdeu o link? Gera outro e revoga o
//    antigo — não tem como "ver de novo", e isso é a funcionalidade.
//
// 2. A TABELA `share_links` É A ÚNICA DO MÓDULO FORA DO RLS, de propósito.
//    A rota pública não tem dono para o banco ler, e com RLS a busca pelo
//    hash voltaria vazia sempre. Depois de achar o dono, tudo volta a passar
//    pelo RLS normal: `comUsuario()` põe o id DELE no contexto e as demais
//    consultas rodam exatamente como numa requisição autenticada.
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from './people.service';
import { gerarTokenOpaco, hashDoToken } from '../auth/token.utils';

@Injectable()
export class ShareLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly people: PeopleService,
  ) {}

  /** Cria o link. O `token` devolvido aqui é a única vez que ele aparece. */
  async create(userId: string, personId: string, expiresAt?: string) {
    await this.people.minha(userId, personId);

    const token = gerarTokenOpaco();
    const link = await this.prisma.shareLink.create({
      data: {
        userId,
        personId,
        tokenHash: hashDoToken(token),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    return { id: link.id, personId, token, expiresAt: link.expiresAt, createdAt: link.createdAt };
  }

  /** Os links de uma pessoa — sem o token, que não existe mais em claro. */
  async findByPerson(userId: string, personId: string) {
    await this.people.minha(userId, personId);
    return this.prisma.shareLink.findMany({
      where: { userId, personId },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        lastViewedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string) {
    const link = await this.prisma.shareLink.findFirst({ where: { id, userId } });
    if (!link) throw new NotFoundException('Link não encontrado');
    return this.prisma.shareLink.update({
      where: { id },
      data: { revokedAt: link.revokedAt ?? new Date() },
      select: { id: true, revokedAt: true },
    });
  }

  /**
   * Resolve o token e devolve o dono e a pessoa — ou nada.
   *
   * Devolve `null` nos TRÊS casos (não existe, revogado, vencido) de
   * propósito: quem chama transforma isso num 404 único. Distinguir
   * "revogado" de "não existe" conta a quem está tentando que aquele token
   * um dia valeu, e isso já é informação demais para quem está chutando.
   *
   * Roda sem dono no contexto — é a única consulta do módulo que pode, e só
   * funciona porque esta tabela está fora do RLS.
   */
  async resolver(token: string): Promise<{ userId: string; personId: string; id: string } | null> {
    if (!token) return null;

    const link = await this.prisma.shareLink.findUnique({
      where: { tokenHash: hashDoToken(token) },
      select: { id: true, userId: true, personId: true, revokedAt: true, expiresAt: true },
    });

    if (!link) return null;
    if (link.revokedAt) return null;
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;

    return { id: link.id, userId: link.userId, personId: link.personId };
  }

  /** Marca a última visita. Falhar aqui não pode derrubar a página: é
   * estatística, não parte da resposta. */
  async registrarVisita(id: string) {
    try {
      await this.prisma.shareLink.update({ where: { id }, data: { lastViewedAt: new Date() } });
    } catch {
      /* a página vale mais que o carimbo */
    }
  }
}
