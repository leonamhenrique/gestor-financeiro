// ============================================================
// whatsapp.service.ts
// ============================================================
// Quem é o dono de um número de WhatsApp — e nada além disso.
//
// Este serviço existe antes do webhook de propósito. A pergunta "de quem é
// esta mensagem?" é a única que precisa estar respondida ANTES de a primeira
// mensagem chegar: o número da API atende o mundo inteiro, e sem vínculo a
// primeira pessoa que escrever estaria lançando no extrato de outra.
//
// O pareamento é um código que nasce na tela do app, já logada. É isso que o
// faz valer como prova: quem manda o código pelo WhatsApp é quem acabou de
// estar dentro da conta.
// ============================================================

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  codigoNaMensagem,
  gerarCodigo,
  hashDoCodigo,
  hashDoTelefone,
  normalizarCodigo,
  normalizarTelefone,
  ultimos4,
} from './telefone';

/** Quanto tempo o código vale. Curto porque ele viaja por fora do app — vai
 * para a mão da pessoa e de lá para uma conversa. */
const VALIDADE_MINUTOS = 15;

/** Freio de força bruta, por número, na memória do processo.
 *
 * A defesa de verdade é o tamanho do código (~6,5 × 10^11 combinações); isto
 * é só o freio que impede alguém de TENTAR em rajada. Fica na memória, e não
 * no banco, porque guardá-lo exigiria gravar o número de quem ainda não é de
 * ninguém — justamente o que este app não faz. Reiniciar a API zera a
 * contagem, e tudo bem: quem reinicia a API é o deploy, não o atacante.
 */
const TENTATIVAS_MAX = 5;
const JANELA_MS = 60 * 60 * 1000;

@Injectable()
export class WhatsappService {
  private readonly tentativas = new Map<string, { n: number; ate: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** O código em claro aparece aqui e nunca mais. */
  async criarPareamento(userId: string) {
    // Um código pendente por vez. Deixar os antigos vivos daria várias chaves
    // da mesma porta, cada uma válida por quinze minutos, e bastaria uma
    // delas vazar.
    await this.prisma.whatsappPairing.deleteMany({ where: { userId, usedAt: null } });

    const codigo = gerarCodigo();
    const pareamento = await this.prisma.whatsappPairing.create({
      data: {
        userId,
        codeHash: hashDoCodigo(codigo),
        expiresAt: new Date(Date.now() + VALIDADE_MINUTOS * 60_000),
      },
    });

    return {
      codigo,
      // O texto pronto para a pessoa mandar. Ela não precisa digitar nada: o
      // app abre o WhatsApp com isto escrito.
      mensagem: 'SALDO-' + codigo,
      expiresAt: pareamento.expiresAt,
    };
  }

  /** O que a tela mostra: se há número ligado, qual, e se há código esperando. */
  async status(userId: string) {
    const [link, pendente] = await Promise.all([
      this.prisma.whatsappLink.findUnique({ where: { userId } }),
      this.prisma.whatsappPairing.findFirst({
        where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      vinculado: !!link,
      // Nunca o número inteiro: a tela só precisa dizer QUAL é, e os quatro
      // últimos bastam para a pessoa se reconhecer.
      ultimos4: link ? link.phoneLast4 : null,
      desde: link ? link.linkedAt : null,
      ultimoUso: link ? link.lastSeenAt : null,
      pareamentoPendenteAte: pendente ? pendente.expiresAt : null,
    };
  }

  /** Desliga o número. Os códigos pendentes vão junto: deixar um vivo seria
   * deixar aberta a porta que a pessoa acabou de fechar. */
  async desvincular(userId: string) {
    const apagados = await this.prisma.whatsappLink.deleteMany({ where: { userId } });
    await this.prisma.whatsappPairing.deleteMany({ where: { userId } });
    if (!apagados.count) throw new NotFoundException('Não há número ligado a esta conta.');
    return { desvinculado: true };
  }

  /**
   * De quem é esta mensagem? `null` quando o número não está pareado.
   *
   * É a primeira pergunta do webhook, e a resposta `null` não é erro: é a
   * resposta certa para quem escreveu sem nunca ter conectado a conta.
   */
  async donoDoTelefone(telefone: string): Promise<string | null> {
    const link = await this.prisma.whatsappLink.findUnique({
      where: { phoneHash: hashDoTelefone(telefone) },
      select: { userId: true },
    });
    return link ? link.userId : null;
  }

  /** Marca que este número falou agora. Só isso — a conversa não é guardada. */
  async registrarUso(userId: string) {
    await this.prisma.whatsappLink.updateMany({
      where: { userId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Liga o número à conta, a partir do código que veio na mensagem.
   *
   * Devolve `null` para TODA recusa, sem distinguir código errado de código
   * vencido ou já usado. Quem está do outro lado pode ser qualquer um, e
   * dizer "este código existe, mas venceu" ensinaria ao atacante que ele
   * acertou metade.
   */
  async vincularPorCodigo(telefone: string, textoDaMensagem: string) {
    const numero = normalizarTelefone(telefone);
    if (!numero) return null;

    const codigo = codigoNaMensagem(textoDaMensagem) || normalizarCodigo(textoDaMensagem);
    if (!codigo) return null;

    const hashTelefone = hashDoTelefone(numero);
    if (this.excedeuTentativas(hashTelefone)) return null;

    const pareamento = await this.prisma.whatsappPairing.findUnique({
      where: { codeHash: hashDoCodigo(codigo) },
    });
    if (!pareamento || pareamento.usedAt || pareamento.expiresAt <= new Date()) {
      this.contarTentativa(hashTelefone);
      return null;
    }

    // O número já é de outra conta. Não se rouba vínculo com um código: a
    // outra pessoa precisa desligar o número dela primeiro.
    const jaDeOutro = await this.prisma.whatsappLink.findUnique({
      where: { phoneHash: hashTelefone },
      select: { userId: true },
    });
    if (jaDeOutro && jaDeOutro.userId !== pareamento.userId) {
      this.contarTentativa(hashTelefone);
      return null;
    }

    // Tudo numa transação: um código gasto sem vínculo criado deixaria a
    // pessoa sem número e sem código, tendo feito tudo certo.
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsappPairing.update({
        where: { id: pareamento.id },
        data: { usedAt: new Date() },
      });
      await tx.whatsappPairing.deleteMany({
        where: { userId: pareamento.userId, usedAt: null },
      });
      // `upsert` porque trocar de número é o mesmo gesto de conectar o
      // primeiro: a pessoa mudou de telefone e pareia de novo.
      await tx.whatsappLink.upsert({
        where: { userId: pareamento.userId },
        create: {
          userId: pareamento.userId,
          phoneHash: hashTelefone,
          phoneLast4: ultimos4(numero),
          lastSeenAt: new Date(),
        },
        update: {
          phoneHash: hashTelefone,
          phoneLast4: ultimos4(numero),
          linkedAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
    });

    this.tentativas.delete(hashTelefone);
    return { userId: pareamento.userId, ultimos4: ultimos4(numero) };
  }

  private excedeuTentativas(hashTelefone: string): boolean {
    const atual = this.tentativas.get(hashTelefone);
    if (!atual || atual.ate <= Date.now()) return false;
    return atual.n >= TENTATIVAS_MAX;
  }

  private contarTentativa(hashTelefone: string) {
    const agora = Date.now();
    const atual = this.tentativas.get(hashTelefone);
    if (!atual || atual.ate <= agora) {
      this.tentativas.set(hashTelefone, { n: 1, ate: agora + JANELA_MS });
      return;
    }
    atual.n += 1;
  }
}
