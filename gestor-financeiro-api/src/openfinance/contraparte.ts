// ============================================================
// contraparte.ts — de quem é o outro lado da transferência
// ============================================================
// "Pix recebido - Leonam Henrique Silva Muniz" e "Pix enviado - Larissa
// Pereira Silva Muniz" chegavam do banco com a mesma etiqueta: o provedor
// categoriza as duas como TRANSFER, porque as duas SÃO transferências
// bancárias. O que ele não diz é entre quem — e é isso que separa "dinheiro
// mudando de bolso" de "dinheiro que saiu da sua vida".
//
// O NOME SÓ EXISTIA DENTRO DO TEXTO. O adaptador juntava o nome da
// contraparte na descrição e jogava fora o campo; sem ele separado, o app
// não tinha como perguntar "este sou eu?".
//
// POR QUE NÃO BASTA COMPARAR COM O NOME DO PERFIL: lá está "Leo", e no Pix
// vem "Leonam Henrique Silva Muniz". Casar por prefixo acharia "Leonardo"
// e "Leonice" também. Um palpite desses num app de dinheiro troca um ruído
// por outro — por isso o app APRENDE em vez de adivinhar: o nome que você
// já marcou como transferência uma vez é seu, e nenhum outro é.
// ============================================================

/** Para comparar nomes: minúsculas, sem acento, sem espaço sobrando. */
export function normalizarContraparte(nome: string | null | undefined): string {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Os prefixos que os bancos põem antes do nome.
 *
 * Existem porque nem todo provedor preenche `counterparty`: quando ele não
 * preenche, o que sobra é o texto do extrato, e lá o nome vem depois de
 * "Pix recebido - ", "TED enviada - " e parentes. A lista é curta e
 * explícita de propósito — um `split` no primeiro hífen cortaria
 * "Supermercado Dia - Loja 4" no lugar errado.
 */
const PREFIXOS = [
  'pix recebido',
  'pix enviado',
  'pix',
  'ted recebida',
  'ted enviada',
  'ted',
  'tev',
  'doc',
  'transferencia recebida',
  'transferencia enviada',
  'transferencia',
];

/**
 * O nome da contraparte, a partir do que o banco mandou.
 *
 * `doProvedor` é o campo próprio (`counterparty`), quando existe — ele é a
 * fonte boa. `daDescricao` é o texto do extrato, usado só como queda: dele
 * se tira o prefixo conhecido e o que sobra é o nome.
 *
 * Devolve `null` quando não dá para dizer. Nulo é resposta: melhor não
 * saber de quem é do que inventar um nome e ensinar o app errado.
 */
export function nomeDaContraparte(
  doProvedor: string | null | undefined,
  daDescricao: string | null | undefined,
): string | null {
  const direto = String(doProvedor || '').trim();
  if (direto) return direto;

  const texto = String(daDescricao || '').trim();
  if (!texto) return null;

  const semAcento = normalizarContraparte(texto);
  for (const prefixo of PREFIXOS) {
    /* O separador é exigido: sem ele, "Pixaim Lanches" viraria "aim
     * Lanches". E o prefixo tem de estar no COMEÇO. */
    const marca = prefixo + ' - ';
    if (semAcento.startsWith(marca)) {
      const resto = texto.slice(marca.length).trim();
      return resto || null;
    }
  }
  /* Sem prefixo conhecido, não é transferência de pessoa: é compra, conta
   * de luz, tarifa. Não tem contraparte para aprender. */
  return null;
}
