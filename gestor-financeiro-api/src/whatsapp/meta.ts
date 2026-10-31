// ============================================================
// meta.ts
// ============================================================
// A fronteira com a Meta: conferir que a mensagem veio de lá, ler o que
// interessa dela e responder.
//
// Nada daqui conhece lançamento, conta ou categoria — e nada do resto do
// módulo conhece o formato da Meta. Quando o formato mudar (ele muda), muda
// só este arquivo.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

/** O que o app faz com uma mensagem, depois de tirada a casca da Meta. */
export interface MensagemRecebida {
  /** O número de quem mandou, só dígitos com DDI. */
  de: string;
  /** O texto. Áudio ainda não: ver `audioId`. */
  texto: string;
  /** Id da mídia, quando a mensagem foi um áudio. Guardado para o passo
   * seguinte — hoje o app responde que ainda não ouve. */
  audioId?: string;
  /** Id da mensagem na Meta. Serve para não processar a mesma duas vezes:
   * a Meta reentrega quando o webhook demora a responder. */
  id: string;
}

/**
 * Confere a assinatura do corpo BRUTO.
 *
 * A Meta assina com HMAC-SHA256 do corpo usando o App Secret, no cabeçalho
 * `x-hub-signature-256`, no formato `sha256=<hex>`. Sem esta conferência, a
 * rota é um formulário aberto: qualquer um manda um JSON dizendo ser o número
 * de alguém e lança no extrato dessa pessoa.
 *
 * O corpo precisa ser o BRUTO, byte a byte. Um JSON já parseado e
 * re-serializado muda espaços e ordem de chaves, e a assinatura nunca bate.
 */
export function assinaturaConfere(
  corpoBruto: Buffer | undefined,
  cabecalho: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!corpoBruto || !cabecalho || !appSecret) return false;
  const esperado = 'sha256=' + createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(String(cabecalho), 'utf8');
  // Tamanho diferente já é diferente; `timingSafeEqual` exigiria iguais e
  // estourar aqui vazaria por exceção o que a comparação esconde.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Tira a casca do payload da Meta e devolve as mensagens de texto e áudio.
 *
 * O formato é uma matrioska de `entry[].changes[].value.messages[]`, e cada
 * nível pode faltar. Nada aqui estoura com payload estranho: a Meta manda
 * eventos que não são mensagem nenhuma (status de entrega, "lido"), e tratar
 * isso como erro encheria o log de falha que não é falha.
 */
export function mensagensDoPayload(corpo: any): MensagemRecebida[] {
  const saida: MensagemRecebida[] = [];
  const entradas = Array.isArray(corpo?.entry) ? corpo.entry : [];
  for (const entrada of entradas) {
    const mudancas = Array.isArray(entrada?.changes) ? entrada.changes : [];
    for (const mudanca of mudancas) {
      const mensagens = Array.isArray(mudanca?.value?.messages) ? mudanca.value.messages : [];
      for (const m of mensagens) {
        const de = String(m?.from || '').replace(/\D/g, '');
        const id = String(m?.id || '');
        if (!de || !id) continue;
        if (m.type === 'text' && m.text?.body) {
          saida.push({ de, id, texto: String(m.text.body) });
        } else if (m.type === 'audio' && m.audio?.id) {
          saida.push({ de, id, texto: '', audioId: String(m.audio.id) });
        } else if (m.type === 'interactive') {
          // Botão tocado: o título do botão é o que a pessoa "disse".
          const titulo =
            m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
          if (titulo) saida.push({ de, id, texto: String(titulo) });
        }
      }
    }
  }
  return saida;
}

/** Tira do texto qualquer sequencia longa de digitos antes de ela virar log.
 *
 * A Meta devolve o motivo da recusa em prosa, e em alguns casos o telefone do
 * destinatario vem dentro da frase ("Recipient phone number not in allowed
 * list: 5531..."). O motivo e o que interessa; o numero nao entra no log. */
export function semNumeros(texto: string): string {
  return String(texto || '').replace(/\d{8,}/g, '[número]');
}

/**
 * Manda uma mensagem de texto. Devolve `null` quando saiu, ou o MOTIVO quando
 * não saiu.
 *
 * O motivo vem junto de propósito. Antes isto devolvia só `true`/`false`, e o
 * log só sabia dizer "não saiu, confira estas três coisas" — enquanto a Meta
 * respondia, na mesma chamada, exatamente qual das três era. Jogar essa
 * resposta fora transformou meia hora de conserto numa noite de adivinhação.
 *
 * Sem número e token configurados não tenta: é o que mantém o ambiente de
 * desenvolvimento mudo, e o fluxo testável sem rede.
 */
export async function responder(telefone: string, texto: string): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token) return 'WHATSAPP_TOKEN não está configurado';
  if (!phoneId) return 'WHATSAPP_PHONE_ID não está configurado';

  let r: Response;
  try {
    r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: texto, preview_url: false },
      }),
    });
  } catch (e: any) {
    return 'a rede falhou: ' + semNumeros(e?.message || 'erro');
  }
  if (r.ok) return null;

  // O corpo do erro da Meta diz o que fazer; o status sozinho, não.
  let detalhe = '';
  try {
    const corpo: any = await r.json();
    detalhe = corpo?.error?.message || '';
    if (corpo?.error?.code) detalhe += ' (código ' + corpo.error.code + ')';
  } catch {
    /* resposta sem JSON: fica só o status */
  }
  return 'HTTP ' + r.status + (detalhe ? ' — ' + semNumeros(detalhe) : '');
}
