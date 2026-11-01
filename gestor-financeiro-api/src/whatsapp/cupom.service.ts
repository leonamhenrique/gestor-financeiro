// ============================================================
// cupom.service.ts
// ============================================================
// A foto de um cupom fiscal vira quatro campos — e só isso. Daqui para frente
// o lançamento segue o mesmo caminho da frase digitada: mesmo resumo, mesma
// confirmação antes de gravar.
//
// O que o cupom dá: valor total, data, forma de pagamento (com as parcelas,
// quando houver) e o nome do estabelecimento. Onde lançar quem diz é a
// legenda da foto — "cartão de crédito nubank" —, lida pelo mesmo leitor de
// frase de sempre.
//
// Três coisas sobre privacidade, porque elas mudam o que o app promete:
//
//   1. a IMAGEM INTEIRA sai do servidor. Não dá para mandar "só o total": um
//      cupom leva os itens, o CNPJ, o nome do operador do caixa e os dígitos
//      mascarados do cartão da maquininha. Aproveitar quatro campos não muda
//      o que foi transmitido, e a política publicada diz isso com todas as
//      letras;
//   2. nada disso é guardado. A imagem é baixada, lida e esquecida — não há
//      arquivo, não há coluna, não há log do que estava nela;
//   3. número de cartão NUNCA é extraído. O pedido ao leitor proíbe, e o
//      código ainda apaga qualquer sequência longa de dígitos do que volta —
//      porque uma instrução em texto não é uma garantia.
//
// Sem `VISION_PROVIDER` e `VISION_API_KEY` o app responde que não enxerga e
// nenhum byte sai daqui. O padrão é cego de propósito: mandar imagem para um
// terceiro é decisão de quem opera, não efeito colateral de um deploy.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { baixarMidia } from './midia';

/** Teto da imagem. Foto de cupom tirada por celular vive abaixo de 2 MB; o
 * WhatsApp já recomprime o que passa disso. Cinco é folga larga e, ao mesmo
 * tempo, teto para um envio que não é cupom nenhum. */
const TETO_BYTES = 5 * 1024 * 1024;

export interface Cupom {
  /** O total pago, sempre positivo. */
  valor: number;
  /** AAAA-MM-DD, ou null quando a data não saiu legível. */
  data: string | null;
  /** Em quantas vezes, 1 quando à vista. */
  parcelas: number;
  /** O nome do estabelecimento, já sem número nenhum. */
  estabelecimento: string | null;
}

const MODELO_PADRAO = 'gpt-4o-mini';

/** O pedido ao leitor. Em português porque o cupom é brasileiro, e enxuto
 * porque cada campo a mais é um campo a mais para sair errado. */
const PEDIDO = [
  'Você lê cupons fiscais brasileiros (NFC-e, SAT, comprovantes de caixa).',
  'Responda APENAS um JSON com estas chaves:',
  '- "total": número do VALOR TOTAL pago (ponto como decimal), ou null;',
  '- "data": a data da compra em AAAA-MM-DD (use a data de autorização, ou a do cabeçalho), ou null;',
  '- "parcelas": inteiro; 1 para à vista ou débito; o número quando o cupom disser parcelado, ou null;',
  '- "estabelecimento": o nome da loja como um cliente a chamaria, sem CNPJ, sem endereço e sem número de loja, ou null.',
  'Nunca inclua número de cartão, nem mascarado; nunca inclua nome de pessoa, lista de itens, CNPJ ou chave de acesso.',
  'Campo ilegível vira null. Não invente.',
].join('\n');

@Injectable()
export class CupomService {
  private readonly log = new Logger('WhatsApp/cupom');

  /** Há leitor configurado? A conversa usa isto para responder "ainda não
   * enxergo" em vez de tentar e falhar. */
  disponivel(): boolean {
    return !!process.env.VISION_PROVIDER && !!this.chave();
  }

  /**
   * Lê a foto e devolve os campos, ou `null` quando não deu.
   *
   * `null` cobre tudo o que a pessoa resolve mandando outra foto ou digitando
   * a frase: imagem tremida, serviço fora do ar, arquivo grande demais,
   * resposta sem o total. Uma exceção aqui derrubaria a mensagem inteira.
   */
  async ler(mediaId: string): Promise<Cupom | null> {
    if (!this.disponivel()) return null;
    try {
      const imagem = await baixarMidia(mediaId, TETO_BYTES, this.log, 'imagem');
      if (!imagem) return null;
      const bruto = await this.extrair(imagem.bytes, imagem.mime || 'image/jpeg');
      return bruto && this.conferir(bruto);
    } catch (e: any) {
      // Sem o conteúdo no log: o que estava na foto não vira linha de log.
      this.log.warn('não consegui ler o cupom: ' + (e?.message || 'erro'));
      return null;
    }
  }

  /**
   * O que volta do leitor, conferido antes de virar lançamento.
   *
   * Nada aqui confia no que veio: o modelo pode devolver texto no lugar de
   * número, uma data de 1999, trinta parcelas de uma compra à vista ou o
   * cartão da maquininha dentro do nome da loja. Sem valor não há cupom —
   * é o único campo sem o qual não dá para seguir.
   */
  private conferir(b: any): Cupom | null {
    const valor = this.dinheiro(b?.total);
    if (!valor) return null;

    const data = typeof b?.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) && !isNaN(Date.parse(b.data))
      ? b.data
      : null;

    const n = Math.trunc(Number(b?.parcelas));
    const parcelas = Number.isFinite(n) && n >= 2 && n <= 60 ? n : 1;

    return { valor, data, parcelas, estabelecimento: this.nomeDaLoja(b?.estabelecimento) };
  }

  /** Dinheiro positivo, com dois decimais e teto de sanidade. */
  private dinheiro(v: unknown): number | null {
    const n = Math.round(Number(v) * 100) / 100;
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
    return n;
  }

  /**
   * O nome da loja, sem número nenhum.
   *
   * Apagar dígitos aqui é a garantia que a instrução em texto não dá: se o
   * leitor devolver "DMA Distribuidora Loja 042" ou, no pior caso, algo com
   * os dígitos do cartão, nada disso vira descrição de lançamento. O preço é
   * perder o número da loja, que não identifica gasto nenhum.
   */
  private nomeDaLoja(v: unknown): string | null {
    const limpo = String(v ?? '')
      .replace(/\d/g, ' ')
      .replace(/[^\p{L}\s&.'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      // A pontuação que sobrou nas pontas depois de os dígitos sumirem:
      // "CARTAO 429154-5610" vira "CARTAO -" sem esta linha.
      .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
      .trim()
      .slice(0, 60);
    return limpo.length >= 3 ? limpo : null;
  }

  private chave(): string | undefined {
    return process.env.VISION_API_KEY;
  }

  /**
   * A leitura em si.
   *
   * Trocar de serviço é trocar este método — a interface é `bytes → campos`,
   * e nada fora daqui sabe de onde eles vieram. É o mesmo arranjo do
   * `audio.service.ts`, pelo mesmo motivo.
   */
  private async extrair(bytes: Buffer, mime: string): Promise<any | null> {
    const provedor = String(process.env.VISION_PROVIDER || '').toLowerCase();
    if (provedor === 'openai') return this.openai(bytes, mime);
    this.log.warn('VISION_PROVIDER desconhecido: ' + provedor);
    return null;
  }

  private async openai(bytes: Buffer, mime: string): Promise<any | null> {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.chave()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.VISION_MODEL || MODELO_PADRAO,
        // JSON pedido pelo protocolo, e não só pelo texto do pedido: assim a
        // resposta não volta embrulhada em ``` nem com um "claro!" na frente.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PEDIDO },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Leia este cupom.' },
              {
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` },
              },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      // O motivo junto, pela mesma razão do áudio: "HTTP 401" sozinho não
      // distingue chave errada de crédito acabado, e "HTTP 404" não diz que o
      // nome em VISION_MODEL não existe mais.
      let detalhe = '';
      try {
        const corpo: any = await r.json();
        detalhe = corpo?.error?.message || '';
      } catch {
        /* resposta sem JSON: fica só o status */
      }
      this.log.warn('leitura recusada: HTTP ' + r.status + (detalhe ? ' — ' + detalhe : ''));
      return null;
    }

    const dados: any = await r.json();
    const texto = dados?.choices?.[0]?.message?.content;
    if (!texto) return null;
    try {
      return JSON.parse(texto);
    } catch {
      this.log.warn('o leitor respondeu algo que não é JSON');
      return null;
    }
  }
}
