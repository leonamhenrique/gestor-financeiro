// ============================================================
// mailer.port.ts
// ============================================================
// O AuthService só sabe "mande este e-mail". Qual serviço entrega (SES,
// Resend, SMTP...) é escolhido por variável de ambiente no AuthModule —
// mesmo desenho da porta de pagamento do billing.
// ============================================================

export const MAILER = Symbol('MAILER');

/** Uma mensagem que o usuário escreveu no app, a caminho de quem cuida. */
export interface MensagemDoUsuario {
  /** Suporte ("não funciona") ou ideia ("podia ter"). Muda só o assunto. */
  tipo: 'SUPORTE' | 'IDEIA';
  /** O que a pessoa escreveu, cru. */
  texto: string;
  /** Quem escreveu. O e-mail vira `Reply-To`: sem ele, responder exigiria
   * procurar a pessoa no banco, e ninguém faz isso duas vezes. */
  de: { nome: string; email: string; id: string };
  /** Contexto que poupa uma ida e volta — plano, versão. Nunca dado
   * financeiro: um problema de tela não se resolve com o saldo de ninguém. */
  contexto?: Record<string, string>;
}

export interface Mailer {
  /** false = este ambiente não envia e-mail; quem chama recusa a operação
   * ANTES de olhar o usuário, para não revelar quais e-mails existem. */
  readonly disponivel?: boolean;
  enviarRedefinicaoDeSenha(destino: { email: string; nome: string }, link: string): Promise<void>;
  /** Leva ao endereço de contato o que a pessoa escreveu no app. */
  enviarMensagemDoUsuario?(msg: MensagemDoUsuario, para: string): Promise<void>;
}

/** MAIL_PROVIDER=NONE: a API sobe em produção sem serviço de e-mail, com a
 * recuperação de senha desligada e dizendo isso. É melhor que o console
 * mailer (que escreveria o link no log) e melhor que não subir. */
export class MailerDesligado implements Mailer {
  readonly disponivel = false;
  async enviarRedefinicaoDeSenha(): Promise<void> {
    throw new Error('Nenhum serviço de e-mail configurado (MAIL_PROVIDER=NONE).');
  }
  async enviarMensagemDoUsuario(): Promise<void> {
    throw new Error('Nenhum serviço de e-mail configurado (MAIL_PROVIDER=NONE).');
  }
}
