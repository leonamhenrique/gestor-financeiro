// ============================================================
// push.service.ts — o aviso que chega com o app fechado
// ============================================================
// O número no menu e no ícone só alcança quem já abriu o app. Isto alcança
// quem não abriu.
//
// POR QUE NÃO O WHATSAPP
// O número de telefone não existe no nosso banco: `telefone.ts` guarda um
// HMAC dele, de propósito, e por isso o bot só RESPONDE. Avisar por lá
// exigiria passar a guardar o número de verdade — e, fora da janela de 24h,
// a Meta ainda cobra por mensagem. Push custa zero por aviso: quem entrega é
// o serviço de push do próprio navegador.
//
// O QUE VAI NO AVISO
// Um número, e nada mais. Nem valor, nem lojista, nem banco. A notificação
// aparece na tela bloqueada, onde quem está ao lado também lê — e "5
// lançamentos esperando" não conta a ninguém o que você gastou.
//
// QUANTAS VEZES
// No máximo uma por dia, por aparelho. O provedor sincroniza a cada 3 horas;
// avisar a cada sincronização seriam oito avisos por dia, e é assim que uma
// notificação útil vira uma que a pessoa desliga. O carimbo fica no BANCO,
// não em memória: duas instâncias da API acordando às 6h mandariam duas.
// ============================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ENVIADOR_DE_PUSH, EnviadorDePush, FalhaDePush } from './push.port';

/**
 * O que há de errado com a chave pública, em uma frase. Vazio = nada.
 *
 * Isto existe por um defeito real: as duas chaves foram trocadas no painel,
 * e o navegador respondeu "The provided applicationServerKey is not valid"
 * — uma frase que não diz a quem configurou o que fazer. Uma chave pública
 * P-256 não comprimida tem 65 bytes e começa com o byte 4; a privada tem
 * 32. Conferir aqui transforma um erro obscuro no celular num aviso claro
 * no log de quem ligou o recurso.
 */
export function problemaNaChavePublica(): string {
  const chave = (process.env.VAPID_PUBLIC_KEY || '').trim();
  if (!chave) return 'VAPID_PUBLIC_KEY está vazia.';
  let bytes: Buffer;
  try {
    bytes = Buffer.from(chave, 'base64url');
  } catch {
    return 'VAPID_PUBLIC_KEY não é base64url.';
  }
  if (bytes.length === 32) {
    return 'VAPID_PUBLIC_KEY tem 32 bytes: isso é uma chave PRIVADA. As duas devem estar trocadas.';
  }
  if (bytes.length !== 65) {
    return 'VAPID_PUBLIC_KEY tem ' + bytes.length + ' bytes; uma chave pública tem 65.';
  }
  if (bytes[0] !== 4) {
    return 'VAPID_PUBLIC_KEY não começa com o byte 4, que toda chave pública não comprimida tem.';
  }
  return '';
}

/**
 * Ligado só com as duas chaves, e só com a pública VÁLIDA.
 *
 * Chave quebrada responde `ligado: false`, e a tela não mostra o
 * interruptor — melhor não oferecer que oferecer um botão que termina em
 * erro de navegador.
 */
export function pushLigado(): boolean {
  return !!(process.env.VAPID_PRIVATE_KEY || '').trim() && !problemaNaChavePublica();
}

export function chavePublicaDePush(): string {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

export interface InscricaoDoNavegador {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly prisma: PrismaService,
    /* Quem entrega fica atrás de uma porta: o serviço não conhece a
     * biblioteca, e o teste injeta um dublê em vez de fingir que a
     * carregou. Ver `push.port.ts` — ali está o motivo concreto. */
    @Inject(ENVIADOR_DE_PUSH) private readonly enviador: EnviadorDePush,
  ) {}

  /**
   * Guarda o aparelho. O mesmo endpoint duas vezes é o MESMO aparelho: o
   * navegador devolve a mesma URL, e duas linhas iguais virariam dois avisos.
   *
   * O `upsert` também corrige o caso de o aparelho mudar de dono — alguém
   * sai da conta e outra pessoa entra no mesmo navegador. Sem isso o aviso
   * da primeira continuaria chegando no aparelho da segunda.
   */
  async inscrever(userId: string, inscricao: InscricaoDoNavegador) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: inscricao.endpoint },
      create: {
        userId,
        endpoint: inscricao.endpoint,
        p256dh: inscricao.keys.p256dh,
        auth: inscricao.keys.auth,
      },
      update: {
        userId,
        p256dh: inscricao.keys.p256dh,
        auth: inscricao.keys.auth,
        // Dono novo começa sem histórico de aviso.
        ultimoAvisoEm: null,
      },
    });
  }

  /** Desligou os avisos, ou saiu da conta neste aparelho. */
  async desinscrever(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async temInscricao(userId: string): Promise<boolean> {
    return (await this.prisma.pushSubscription.count({ where: { userId } })) > 0;
  }

  /**
   * Avisa os aparelhos de uma pessoa, no máximo uma vez por dia cada.
   *
   * Devolve quantos foram avisados. Zero é resposta normal: ou não há
   * aparelho inscrito, ou todos já foram avisados hoje.
   */
  async avisar(userId: string, total: number): Promise<number> {
    if (total <= 0) return 0;
    return this.entregar(
      userId,
      JSON.stringify({
        titulo: total === 1 ? '1 lançamento esperando você' : total + ' lançamentos esperando você',
        texto: 'O banco mandou novidade. Confira antes de importar.',
        total,
      }),
    );
  }

  /**
   * Um aviso de texto livre, pelo mesmo caminho e com o mesmo teto diário.
   *
   * Existe para o fim do teste: "faltam 7 dias", "o banco se desconecta em
   * 3". Passa pelo MESMO `entregar` de propósito — duas filas de push para
   * a mesma pessoa é como se chega a cinco notificações num dia.
   *
   * Quem chama escolhe a ordem: o primeiro do dia leva a vaga. Por isso o
   * agendador manda o aviso do fim do teste ANTES da contagem de pendentes,
   * que volta amanhã sem prejuízo.
   */
  async avisarTexto(userId: string, titulo: string, texto: string): Promise<number> {
    return this.entregar(userId, JSON.stringify({ titulo, texto }));
  }

  /** O caminho único até os aparelhos: um aviso por aparelho por dia, e a
   * inscrição morta sai da tabela. */
  private async entregar(userId: string, corpo: string): Promise<number> {
    if (!pushLigado()) return 0;

    const limite = new Date(Date.now() - 20 * 60 * 60 * 1000);
    const aparelhos = await this.prisma.pushSubscription.findMany({
      where: {
        userId,
        OR: [{ ultimoAvisoEm: null }, { ultimoAvisoEm: { lt: limite } }],
      },
    });
    if (!aparelhos.length) return 0;

    let avisados = 0;
    for (const a of aparelhos) {
      try {
        await this.enviador.enviar(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          corpo,
        );
        await this.prisma.pushSubscription.update({
          where: { id: a.id },
          data: { ultimoAvisoEm: new Date() },
        });
        avisados++;
      } catch (e: any) {
        /* 404 e 410 são o serviço de push dizendo que aquele aparelho não
         * existe mais — app desinstalado, permissão revogada, navegador
         * limpo. Guardar uma inscrição morta é tentar de novo todo dia para
         * sempre. Qualquer outro erro é passageiro e a linha fica. */
        const status = e instanceof FalhaDePush ? e.status : e?.statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: a.id } }).catch(() => {});
        } else {
          this.logger.warn('não consegui avisar um aparelho: ' + (e?.message || 'erro'));
        }
      }
    }
    return avisados;
  }
}
