import { Injectable, Logger } from '@nestjs/common';
import { Mailer } from './mailer.port';

/** Só para desenvolvimento: em vez de enviar, escreve o link no log.
 *
 * Em produção isso seria um vazamento — quem lê log conseguiria trocar a senha
 * de qualquer pessoa —, e por isso o AuthModule se recusa a usar este
 * adaptador com NODE_ENV=production. */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('Mailer');

  async enviarRedefinicaoDeSenha(destino: { email: string; nome: string }, link: string) {
    this.logger.log(`[DEV] Redefinição de senha para ${destino.email}: ${link}`);
  }
}
