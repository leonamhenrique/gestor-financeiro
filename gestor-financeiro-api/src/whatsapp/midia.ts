// ============================================================
// midia.ts
// ============================================================
// Baixar o que a pessoa mandou: o áudio do recado, a foto do cupom.
//
// Estava dentro do `audio.service.ts` e saiu de lá quando a foto apareceu.
// Não é arrumação: o download tem três regras que precisam valer igual para
// os dois — ir em dois tempos, recusar ANTES de baixar quando o tamanho já
// vem grande, e assinar também o segundo pedido. Duas cópias disso divergem
// na primeira correção, e a que ficar para trás é a que passa a aceitar
// arquivo sem teto.
// ============================================================

import { Logger } from '@nestjs/common';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface Midia {
  bytes: Buffer;
  mime: string;
}

/**
 * Os bytes de uma mídia do WhatsApp, ou `null` quando não deu.
 *
 * `null` e não exceção: token ausente, mídia expirada e arquivo grande demais
 * são todos "não consegui pegar", e quem chama responde isso em uma frase.
 *
 * O download é em dois tempos na Graph API: primeiro o endereço, depois os
 * bytes — e o segundo pedido também vai assinado com o token.
 */
export async function baixarMidia(
  mediaId: string,
  tetoBytes: number,
  log: Logger,
  oQue: string,
): Promise<Midia | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) return null;

  const meta = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) return null;
  const dados: any = await meta.json();
  if (!dados?.url) return null;

  // O tamanho vem na resposta de cima: dá para recusar ANTES de baixar.
  if (Number(dados.file_size) > tetoBytes) {
    log.warn(oQue + ' recusado por tamanho: ' + dados.file_size + ' bytes');
    return null;
  }

  const bin = await fetch(dados.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!bin.ok) return null;
  const bytes = Buffer.from(await bin.arrayBuffer());
  // De novo depois de baixar: `file_size` é o que a Meta disse, não o que
  // chegou.
  if (bytes.length > tetoBytes) return null;

  return { bytes, mime: String(dados.mime_type || '') };
}
