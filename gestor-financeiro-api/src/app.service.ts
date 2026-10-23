import { Injectable } from '@nestjs/common';

/** Quando este processo subiu. Avaliado uma vez, na carga do módulo. */
const SUBIU_EM = new Date().toISOString();

@Injectable()
export class AppService {
  /**
   * Sinal de vida — e qual versão está respondendo.
   *
   * O commit existe porque "o meu conserto já está no ar?" é pergunta que
   * aparece a cada deploy, e responder por adivinhação já saiu caro: uma
   * correção de fuso horário foi dada como publicada antes de estar, e o
   * pagamento de teste seguinte caiu no mesmo defeito.
   *
   * `RENDER_GIT_COMMIT` é posto pelo próprio Render. Fora de lá fica
   * 'local', que é a resposta honesta.
   */
  estado() {
    return {
      ok: true,
      versao: (process.env.RENDER_GIT_COMMIT ?? 'local').slice(0, 7),
      subiuEm: SUBIU_EM,
    };
  }
}
