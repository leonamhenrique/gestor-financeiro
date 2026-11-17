// ============================================================
// push.port.ts
// ============================================================
// O PushService só sabe "entregue este aviso neste aparelho". QUEM entrega
// é escolhido no módulo — mesmo desenho da porta de e-mail no auth e da de
// pagamento no billing.
//
// Aqui a porta resolve um problema concreto, e não é arquitetura por
// arquitetura: `web-push@4` é ESM, este projeto compila para CommonJS, e
// `require()` de ESM só funciona a partir do Node 22.12. A bancada roda 24
// e aceitou; o Render roda 22.11 e recusou, derrubando o deploy. Com a
// porta, o `import()` dinâmico fica num arquivo só — e o teste injeta um
// dublê em vez de fingir que carregou a biblioteca.
// ============================================================

export const ENVIADOR_DE_PUSH = Symbol('ENVIADOR_DE_PUSH');

export interface AparelhoInscrito {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** O erro que o serviço de push devolve, do jeito que importa decidir. */
export class FalhaDePush extends Error {
  constructor(
    mensagem: string,
    /** 404 e 410 querem dizer "este aparelho não existe mais". */
    readonly status?: number,
  ) {
    super(mensagem);
    this.name = 'FalhaDePush';
  }
}

export interface EnviadorDePush {
  enviar(aparelho: AparelhoInscrito, corpo: string): Promise<void>;
}
