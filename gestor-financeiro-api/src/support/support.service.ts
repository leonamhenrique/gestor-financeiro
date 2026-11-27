// ============================================================
// support.service.ts — o que a pessoa escreve no app chega em alguém
// ============================================================
// As telas de Suporte e Ideias eram maquete: o formulário dizia "enviado" e
// limpava o campo. Nada saía do app, e quem escreveu ficou esperando uma
// resposta que nunca ia existir — o pior tipo de tela, porque mente sem
// errar nada visível.
//
// O ENDEREÇO VEM DO AMBIENTE, com padrão. `SUPPORT_EMAIL` troca sem deploy;
// sem ele, vale `contato@saldonline.com.br`. Um endereço só no código daria
// um deploy para cada mudança de caixa de entrada.
//
// O REMETENTE CONTINUA SENDO O NOSSO. Mandar em nome do usuário faria o
// e-mail cair em spam: o domínio dele não autoriza o nosso servidor. Quem
// resolve é o `Reply-To` com o endereço da pessoa — responder na caixa de
// entrada vai direto para ela.
//
// E O QUE VAI JUNTO É O MÍNIMO: nome, e-mail, id e plano. Nada financeiro.
// Nenhum problema de tela se resolve com o saldo de alguém, e um e-mail é o
// último lugar onde esse dado deveria estar.
// ============================================================

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MAILER, Mailer, MensagemDoUsuario } from '../auth/mailer.port';
import { BillingService } from '../billing/billing.service';

/** Para onde vão as mensagens. */
export function enderecoDeContato(): string {
  return (process.env.SUPPORT_EMAIL || 'contato@saldonline.com.br').trim();
}

/** Teto do que cabe numa mensagem. Acima disso não é mensagem, é despejo —
 * e o corpo do e-mail tem limite no provedor. */
export const LIMITE_DO_TEXTO = 4000;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** Este ambiente consegue entregar mensagem? A tela pergunta antes de
   * oferecer o formulário: um "enviar" que sempre falha é a maquete de
   * novo, só que com erro. */
  disponivel(): boolean {
    return this.mailer.disponivel !== false && typeof this.mailer.enviarMensagemDoUsuario === 'function';
  }

  async enviar(userId: string, tipo: 'SUPORTE' | 'IDEIA', texto: string) {
    const limpo = (texto || '').trim();
    if (!limpo) throw new BadRequestException('Escreva a mensagem antes de enviar.');
    if (limpo.length > LIMITE_DO_TEXTO) {
      throw new BadRequestException(`A mensagem passa de ${LIMITE_DO_TEXTO} caracteres.`);
    }
    if (!this.disponivel()) {
      throw new ServiceUnavailableException(
        'O envio de mensagens está indisponível agora. Tente de novo mais tarde.',
      );
    }

    const usuario = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado.');

    /* O plano poupa a primeira pergunta de toda conversa de suporte. Se a
     * leitura falhar, a mensagem vai do mesmo jeito: contexto é cortesia,
     * não requisito. */
    let plano = '—';
    try {
      const limites = await this.billing.limites(userId);
      plano = limites.coluna + (limites.emTeste ? ` (teste, faltam ${limites.diasDeTeste} dias)` : '');
    } catch {
      /* segue sem */
    }

    const msg: MensagemDoUsuario = {
      tipo,
      texto: limpo,
      de: { nome: usuario.name, email: usuario.email, id: usuario.id },
      contexto: { plano, versao: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || '—' },
    };

    await this.mailer.enviarMensagemDoUsuario!(msg, enderecoDeContato());
    /* Sem o texto e sem o e-mail no log: o que a pessoa escreveu é dela, e
     * um log não é caixa de entrada. Só o suficiente para saber que saiu. */
    this.logger.log('mensagem de ' + tipo.toLowerCase() + ' enviada');
    return { enviada: true };
  }
}
