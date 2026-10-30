// ============================================================
// audio.service.ts
// ============================================================
// O áudio do WhatsApp vira texto — e só isso. Daqui para frente a frase
// falada segue exatamente o mesmo caminho da frase digitada: mesma leitura,
// mesmo resumo, mesma confirmação antes de gravar.
//
// Duas coisas que valem dizer sobre privacidade, porque elas mudam o que o
// app promete:
//
//   1. o áudio SAI do servidor. Ele vai para um serviço de transcrição, que
//      é um terceiro novo na vida do app. Por isso nada acontece sem
//      `STT_PROVIDER` configurado: sem a variável, a API diz que não escuta e
//      nenhum byte sai daqui. O padrão é mudo de propósito;
//   2. o áudio não é guardado. Ele é baixado, transcrito e esquecido — não há
//      arquivo, não há coluna, não há log do que foi dito. O que sobra é o
//      lançamento que a pessoa confirmou, igual ao que ela digitaria.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';

/** Teto do arquivo. Um recado de voz de um lançamento tem segundos; vários
 * megabytes aqui é outra coisa — áudio errado, encaminhamento de podcast, ou
 * alguém testando o limite da porta. Recusar é mais barato que transcrever. */
const TETO_BYTES = 2 * 1024 * 1024;

const GRAPH = 'https://graph.facebook.com/v21.0';

@Injectable()
export class AudioService {
  private readonly log = new Logger('WhatsApp/áudio');

  /** Há transcritor configurado? A conversa usa isto para responder "ainda
   * não escuto" em vez de tentar e falhar. */
  disponivel(): boolean {
    return !!process.env.STT_PROVIDER && !!this.chave();
  }

  /**
   * Devolve o que foi dito, ou `null` quando não deu.
   *
   * `null` não é exceção: áudio chiado, serviço fora do ar e arquivo grande
   * demais são todos "não consegui ouvir", e quem chama responde isso. Uma
   * exceção aqui derrubaria a mensagem inteira por algo que a pessoa resolve
   * repetindo a frase.
   */
  async ouvir(mediaId: string): Promise<string | null> {
    if (!this.disponivel()) return null;
    try {
      const arquivo = await this.baixar(mediaId);
      if (!arquivo) return null;
      // Transcrição que volta em branco é "não entendi", e não uma frase
      // vazia: quem chama testa o `null` e pede para repetir.
      const texto = (await this.transcrever(arquivo.bytes, arquivo.mime))?.trim();
      return texto || null;
    } catch (e: any) {
      // Sem o conteúdo no log: o que a pessoa falou não vira linha de log.
      this.log.warn('não consegui transcrever o áudio: ' + (e?.message || 'erro'));
      return null;
    }
  }

  /** O download é em dois tempos na Graph API: primeiro o endereço, depois os
   * bytes — e o segundo pedido também vai assinado com o token. */
  private async baixar(mediaId: string): Promise<{ bytes: Buffer; mime: string } | null> {
    const token = process.env.WHATSAPP_TOKEN;
    if (!token) return null;

    const meta = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meta.ok) return null;
    const dados: any = await meta.json();
    if (!dados?.url) return null;

    // O tamanho vem na resposta de cima: dá para recusar ANTES de baixar.
    if (Number(dados.file_size) > TETO_BYTES) {
      this.log.warn('áudio recusado por tamanho: ' + dados.file_size + ' bytes');
      return null;
    }

    const bin = await fetch(dados.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!bin.ok) return null;
    const bytes = Buffer.from(await bin.arrayBuffer());
    if (bytes.length > TETO_BYTES) return null;

    return { bytes, mime: String(dados.mime_type || 'audio/ogg') };
  }

  private chave(): string | undefined {
    return process.env.STT_API_KEY;
  }

  /**
   * A transcrição em si.
   *
   * Trocar de serviço é trocar este método — a interface é `bytes → texto`, e
   * nada fora daqui sabe de onde o texto veio. O formato do WhatsApp (OGG com
   * Opus) é aceito pelos transcritores comuns sem conversão.
   *
   * `language: pt` não é economia de palpite: sem dizer o idioma, um "oi"
   * mal gravado vira inglês, e a frase inteira volta traduzida.
   */
  private async transcrever(bytes: Buffer, mime: string): Promise<string | null> {
    const provedor = String(process.env.STT_PROVIDER || '').toLowerCase();
    if (provedor === 'openai') return this.openai(bytes, mime);
    this.log.warn('STT_PROVIDER desconhecido: ' + provedor);
    return null;
  }

  private async openai(bytes: Buffer, mime: string): Promise<string | null> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'audio.ogg');
    form.append('model', process.env.STT_MODEL || 'whisper-1');
    form.append('language', 'pt');
    // O vocabulário do app no prompt melhora nomes que o transcritor não
    // conhece — "Nubank", "pix", "fatura" — e custa nada.
    form.append(
      'prompt',
      'Lançamento financeiro em português do Brasil: pix, débito, crédito, fatura, Nubank, Itaú, reais.',
    );

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.chave()}` },
      body: form,
    });
    if (!r.ok) {
      this.log.warn('transcrição recusada: HTTP ' + r.status);
      return null;
    }
    const dados: any = await r.json();
    return dados?.text ? String(dados.text) : null;
  }
}
