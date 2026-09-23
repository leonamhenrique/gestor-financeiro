// ============================================================
// resend-mailer.ts
// ============================================================
// Entrega de e-mail pelo Resend (https://resend.com), via API HTTP — sem SDK,
// porque é uma requisição só e uma dependência a menos é uma dependência a
// menos para manter e auditar.
//
// Duas variáveis obrigatórias, conferidas na subida e não no primeiro envio:
//   RESEND_API_KEY  a chave da conta (começa com "re_")
//   MAIL_FROM       o remetente, ex.: 'Gestor Financeiro <nao-responda@seu.com>'
//
// Falhar aqui derruba a API no deploy, que é o momento certo de descobrir o
// problema — melhor que descobrir quando alguém esquece a senha.
// ============================================================

import { Mailer } from './mailer.port';
import { REDEFINICAO_MINUTOS } from './auth.service';

const ENDPOINT = 'https://api.resend.com/emails';

export class ResendMailer implements Mailer {
  readonly disponivel = true;
  private readonly chave: string;
  private readonly remetente: string;

  constructor() {
    this.chave = (process.env.RESEND_API_KEY ?? '').trim();
    this.remetente = (process.env.MAIL_FROM ?? '').trim();
    if (!this.chave) {
      throw new Error('MAIL_PROVIDER=RESEND exige RESEND_API_KEY (a chave da conta no Resend).');
    }
    if (!this.remetente) {
      throw new Error(
        'MAIL_PROVIDER=RESEND exige MAIL_FROM, o remetente — ex.: "Gestor Financeiro <nao-responda@seudominio.com>". ' +
          'O domínio precisa estar verificado no Resend.',
      );
    }
  }

  async enviarRedefinicaoDeSenha(destino: { email: string; nome: string }, link: string): Promise<void> {
    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.remetente,
        to: [destino.email],
        subject: 'Criar uma senha nova — Gestor Financeiro',
        text: texto(destino.nome, link),
        html: html(destino.nome, link),
      }),
    });

    if (!resposta.ok) {
      // O corpo do Resend diz o motivo (domínio não verificado, chave inválida,
      // destinatário recusado). Vai para o log; quem pediu vê a mesma resposta
      // de sempre, senão a diferença revelaria quais e-mails existem.
      const corpo = await resposta.text().catch(() => '');
      throw new Error(`Resend recusou o envio (HTTP ${resposta.status}): ${corpo.slice(0, 300)}`);
    }
  }
}

function texto(nome: string, link: string): string {
  return [
    `Olá, ${nome}.`,
    '',
    'Alguém pediu uma senha nova para a sua conta no Gestor Financeiro.',
    'Para criar a senha, abra este endereço:',
    '',
    link,
    '',
    `O link vale por ${REDEFINICAO_MINUTOS} minutos e só pode ser usado uma vez.`,
    '',
    'Se não foi você, pode ignorar este e-mail: sua senha continua a mesma.',
  ].join('\n');
}

/** HTML simples de propósito: e-mail não é página. Sem imagem, sem fonte
 * externa, sem rastreador — coisas que caem em spam e que ninguém pediu. */
function html(nome: string, link: string): string {
  const seguro = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#14202B">
  <p>Olá, ${seguro(nome)}.</p>
  <p>Alguém pediu uma senha nova para a sua conta no <strong>Gestor Financeiro</strong>.</p>
  <p><a href="${seguro(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#0C6E77;color:#F3FBFC;text-decoration:none">Criar uma senha nova</a></p>
  <p style="color:#4A5B6B;font-size:13px">Ou copie este endereço: <br>${seguro(link)}</p>
  <p style="color:#4A5B6B;font-size:13px">O link vale por ${REDEFINICAO_MINUTOS} minutos e só pode ser usado uma vez.</p>
  <p style="color:#4A5B6B;font-size:13px">Se não foi você, pode ignorar este e-mail: sua senha continua a mesma.</p>
</div>`;
}
