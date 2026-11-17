// ============================================================
// assinatura-do-webhook.spec.ts
// ============================================================
// O risco aqui não é "não funcionar": é funcionar errado e ninguém
// perceber. Uma conferência de assinatura que aceita demais protege nada;
// uma que aceita de menos descarta entregas boas em silêncio. Estes testes
// cercam os dois lados.
// ============================================================

import { createHmac } from 'crypto';
import {
  pedacosDoHeader,
  variantes,
  varianteQueBate,
} from './assinatura-do-webhook';

describe('assinatura do webhook', () => {
  const SEGREDO = 'segredo-da-polp-1234567890';
  const CORPO = Buffer.from('{"event":"accounts","resource_id":"abc"}');

  const assinar = (dados: string | Buffer, cod: 'hex' | 'base64' = 'hex') =>
    createHmac('sha256', SEGREDO).update(dados).digest(cod);

  // ------------------------------------------------------- as três formas
  /* O header vem de três jeitos no mundo real, e adivinhar qual é seria uma
   * aposta. Comparar todos os pedaços não é frouxidão: rótulo nenhum muda
   * o que o HMAC tem de ser. */
  it('reconhece o valor puro', () => {
    expect(varianteQueBate(assinar(CORPO), SEGREDO, CORPO)).toBe('corpo-hex');
  });

  it('reconhece com prefixo de algoritmo', () => {
    expect(varianteQueBate('sha256=' + assinar(CORPO), SEGREDO, CORPO)).toBe('corpo-hex');
  });

  it('reconhece em lista com rótulos', () => {
    const header = 't=1763337600,v1=' + assinar(CORPO);
    expect(varianteQueBate(header, SEGREDO, CORPO)).toBe('corpo-hex');
  });

  it('reconhece base64, inclusive com o "=" do próprio base64', () => {
    const b64 = assinar(CORPO, 'base64');
    expect(varianteQueBate(b64, SEGREDO, CORPO)).toBe('corpo-base64');
  });

  /* Provedores que assinam "carimbo.corpo" fazem isso para que uma entrega
   * capturada não valha para sempre. */
  it('reconhece carimbo.corpo quando vem carimbo', () => {
    const carimbo = '1763337600';
    const esperada = assinar(Buffer.concat([Buffer.from(carimbo + '.'), CORPO]));
    expect(varianteQueBate(esperada, SEGREDO, CORPO, carimbo)).toBe('carimbo.corpo-hex');
  });

  it('sem carimbo, a variante de carimbo nem e calculada', () => {
    expect(variantes(SEGREDO, CORPO).map((v) => v.nome)).toEqual(['corpo-hex', 'corpo-base64']);
  });

  // ----------------------------------------------------- o que NAO bate
  it('assinatura de outro segredo nao bate', () => {
    const outra = createHmac('sha256', 'outro-segredo').update(CORPO).digest('hex');
    expect(varianteQueBate(outra, SEGREDO, CORPO)).toBeNull();
  });

  /* Um byte a mais no corpo muda o HMAC inteiro. É por isto que a rota usa
   * `rawBody` e não o JSON reserializado: um espaço a mais e a conta não
   * fecha — e a entrega boa seria recusada. */
  it('um byte a mais no corpo derruba a conferencia', () => {
    const assinada = assinar(CORPO);
    const mexido = Buffer.from(CORPO.toString() + ' ');
    expect(varianteQueBate(assinada, SEGREDO, mexido)).toBeNull();
  });

  it('header vazio, segredo vazio ou corpo vazio nao batem', () => {
    expect(varianteQueBate('', SEGREDO, CORPO)).toBeNull();
    expect(varianteQueBate(assinar(CORPO), '', CORPO)).toBeNull();
    expect(varianteQueBate(assinar(CORPO), SEGREDO, Buffer.alloc(0))).toBeNull();
  });

  /* Lixo não pode virar acerto por acaso, e também não pode estourar. */
  it('header com lixo nao estoura e nao bate', () => {
    for (const lixo of ['=', ',,,', 'v1=', 'sha256=', '====', 'a'.repeat(5000)]) {
      expect(varianteQueBate(lixo, SEGREDO, CORPO)).toBeNull();
    }
  });

  // --------------------------------------------------------- os pedaços
  it('quebra o header nos pedacos comparaveis', () => {
    expect(pedacosDoHeader('t=1,v1=abc')).toEqual(
      expect.arrayContaining(['t=1,v1=abc', 't=1', 'v1=abc', 'abc', '1']),
    );
  });

  it('nao corta o "=" quando ele nao separa rotulo', () => {
    // `=` no começo não tem rótulo antes: cortar produziria string vazia.
    expect(pedacosDoHeader('=abc')).not.toContain('');
  });
});
