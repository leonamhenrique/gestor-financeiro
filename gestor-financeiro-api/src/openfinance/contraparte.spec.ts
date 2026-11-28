// ============================================================
// contraparte.spec.ts
// ============================================================
// "Pix recebido - Leonam Henrique Silva Muniz" e "Pix enviado - Larissa
// Pereira Silva Muniz" chegavam com a MESMA etiqueta de transferência,
// porque o provedor categoriza as duas como TRANSFER — e as duas são
// transferências bancárias. O que ele não diz é entre quem.
//
// Para o app poder perguntar "este sou eu?", o nome precisa existir como
// campo, e não dentro do texto: a mesma pessoa aparece como "Pix recebido -
// Fulano" numa direção e "Pix enviado - Fulano" na outra, então comparar a
// frase inteira nunca casa.
//
// O que estes testes defendem é o cuidado do recorte. Cortar demais inventa
// nome, e nome inventado vira aprendizado errado — e aprendizado errado
// etiqueta como transferência um gasto de verdade.
// ============================================================

import { nomeDaContraparte, normalizarContraparte } from './contraparte';

describe('o nome da contraparte', () => {
  it('o campo do provedor vence o texto, sempre', () => {
    expect(nomeDaContraparte('Leonam Henrique Silva Muniz', 'Pix recebido - OUTRO NOME')).toBe(
      'Leonam Henrique Silva Muniz',
    );
  });

  it('sem o campo, tira o prefixo do texto do extrato', () => {
    expect(nomeDaContraparte(null, 'Pix recebido - Leonam Henrique Silva Muniz')).toBe(
      'Leonam Henrique Silva Muniz',
    );
    expect(nomeDaContraparte(null, 'Pix enviado - Larissa Pereira Silva Muniz')).toBe(
      'Larissa Pereira Silva Muniz',
    );
  });

  /* O MESMO nome nas duas direções. É disto que depende aprender uma vez e
   * reconhecer sempre. */
  it('receber e enviar dão o mesmo nome', () => {
    const a = nomeDaContraparte(null, 'Pix recebido - Leonam Henrique Silva Muniz');
    const b = nomeDaContraparte(null, 'Pix enviado - Leonam Henrique Silva Muniz');
    expect(normalizarContraparte(a)).toBe(normalizarContraparte(b));
  });

  it('TED, DOC e transferência também', () => {
    expect(nomeDaContraparte(null, 'TED recebida - Fulano de Tal')).toBe('Fulano de Tal');
    expect(nomeDaContraparte(null, 'Transferência enviada - Fulano de Tal')).toBe('Fulano de Tal');
    expect(nomeDaContraparte(null, 'DOC - Fulano de Tal')).toBe('Fulano de Tal');
  });

  /* O PERIGO DO CORTE. Um `split` no primeiro hífen devolveria
   * "Supermercado Dia", e o app aprenderia que "Supermercado Dia" é um nome
   * de transferência — passando a etiquetar compra como se fosse dinheiro
   * mudando de bolso. */
  it('o que não tem prefixo conhecido não tem contraparte', () => {
    expect(nomeDaContraparte(null, 'Supermercado Dia - Loja 4')).toBe(null);
    expect(nomeDaContraparte(null, 'Tarifa mensal')).toBe(null);
    expect(nomeDaContraparte(null, 'Netflix.com')).toBe(null);
  });

  /* O separador é exigido: sem ele, "Pixaim" perderia as três primeiras
   * letras e viraria "aim Lanches". */
  it('o prefixo precisa do separador, e precisa estar no começo', () => {
    expect(nomeDaContraparte(null, 'Pixaim Lanches')).toBe(null);
    expect(nomeDaContraparte(null, 'Reembolso de Pix - Fulano')).toBe(null);
  });

  it('vazio não vira nome', () => {
    expect(nomeDaContraparte(null, null)).toBe(null);
    expect(nomeDaContraparte('', '')).toBe(null);
    expect(nomeDaContraparte(null, 'Pix recebido - ')).toBe(null);
    expect(nomeDaContraparte('   ', 'Pix recebido - Fulano')).toBe('Fulano');
  });
});

describe('a comparação de nomes', () => {
  it('ignora acento, caixa e espaço sobrando', () => {
    expect(normalizarContraparte('  LEONAM   Henrique  ')).toBe('leonam henrique');
    expect(normalizarContraparte('José Antônio')).toBe(normalizarContraparte('JOSE ANTONIO'));
  });

  /* Nomes diferentes continuam diferentes — é o ponto inteiro. */
  it('não aproxima nomes parecidos', () => {
    expect(normalizarContraparte('Leonam Henrique Silva Muniz')).not.toBe(
      normalizarContraparte('Larissa Pereira Silva Muniz'),
    );
    expect(normalizarContraparte('Leo')).not.toBe(normalizarContraparte('Leonam'));
  });

  it('nulo vira vazio, e vazio não casa com nada que valha', () => {
    expect(normalizarContraparte(null)).toBe('');
    expect(normalizarContraparte(undefined)).toBe('');
  });
});
