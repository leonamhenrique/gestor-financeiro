// ============================================================
// webpush.enviador.ts — o único lugar que conhece a biblioteca
// ============================================================
// `web-push@4` é ESM e este projeto compila para CommonJS. O `require()`
// que o TypeScript geraria só carrega ESM a partir do Node 22.12 — e o
// Render roda 22.11. O deploy caiu com ERR_REQUIRE_ESM depois de passar na
// bancada, que roda Node 24.
//
// A saída é `import()` dinâmico, que funciona nos dois. Só que o
// TypeScript, compilando para CommonJS, TRANSFORMA `import()` em
// `require()` — e aí o conserto não conserta nada. Por isso o import vai
// dentro de um `new Function`: o compilador não mexe no que ele não lê.
//
// Feio, e de propósito à vista: um comentário explicando é melhor que um
// `require` inocente que derruba o deploy de novo daqui a seis meses.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import {
  AparelhoInscrito,
  EnviadorDePush,
  FalhaDePush,
} from './push.port';

/* Escapa da transformação do TypeScript: para ele isto é só uma string. */
const importarDeVerdade = new Function(
  'modulo',
  'return import(modulo);',
) as (modulo: string) => Promise<any>;

@Injectable()
export class WebPushEnviador implements EnviadorDePush {
  private readonly logger = new Logger('Push');
  private biblioteca: any;

  /** Carrega uma vez e guarda: são chaves e configuração, não estado. */
  private async lib() {
    if (!this.biblioteca) {
      const mod = await importarDeVerdade('web-push');
      this.biblioteca = mod.default || mod;
      this.biblioteca.setVapidDetails(
        'mailto:contato@saldonline.com.br',
        (process.env.VAPID_PUBLIC_KEY || '').trim(),
        (process.env.VAPID_PRIVATE_KEY || '').trim(),
      );
      this.logger.log('biblioteca de push carregada');
    }
    return this.biblioteca;
  }

  async enviar(aparelho: AparelhoInscrito, corpo: string): Promise<void> {
    const webpush = await this.lib();
    try {
      await webpush.sendNotification(aparelho, corpo);
    } catch (e: any) {
      /* O status vem no erro da biblioteca. Traduzir aqui é o que permite
       * ao serviço decidir sem conhecer a biblioteca. */
      throw new FalhaDePush(e?.message || 'falha ao entregar o aviso', e?.statusCode);
    }
  }
}
