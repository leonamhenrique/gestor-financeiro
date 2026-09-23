// ============================================================
// mailer.port.ts
// ============================================================
// O AuthService só sabe "mande este e-mail". Qual serviço entrega (SES,
// Resend, SMTP...) é escolhido por variável de ambiente no AuthModule —
// mesmo desenho da porta de pagamento do billing.
// ============================================================

export const MAILER = Symbol('MAILER');

export interface Mailer {
  /** false = este ambiente não envia e-mail; quem chama recusa a operação
   * ANTES de olhar o usuário, para não revelar quais e-mails existem. */
  readonly disponivel?: boolean;
  enviarRedefinicaoDeSenha(destino: { email: string; nome: string }, link: string): Promise<void>;
}

/** MAIL_PROVIDER=NONE: a API sobe em produção sem serviço de e-mail, com a
 * recuperação de senha desligada e dizendo isso. É melhor que o console
 * mailer (que escreveria o link no log) e melhor que não subir. */
export class MailerDesligado implements Mailer {
  readonly disponivel = false;
  async enviarRedefinicaoDeSenha(): Promise<void> {
    throw new Error('Nenhum serviço de e-mail configurado (MAIL_PROVIDER=NONE).');
  }
}
