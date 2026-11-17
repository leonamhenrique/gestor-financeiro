// ============================================================
// assinatura-do-webhook.ts — descobrir o esquema, e depois exigi-lo
// ============================================================
// O painel da Polp oferece assinatura HMAC-SHA256 no header
// `X-Webhook-Signature`, e gera um segredo. O que a documentação pública
// NÃO diz é o que exatamente é assinado nem em que codificação o resultado
// vem — e essas duas respostas são a diferença entre uma conferência que
// protege e uma que só parece proteger.
//
// Conferir no escuro tem dois jeitos de dar errado, e os dois são ruins:
// escolher um esquema errado e rejeitar TODAS as entregas reais em
// silêncio, ou escrever uma conferência frouxa que aceita qualquer coisa.
//
// Então aqui se faz o contrário: calculam-se as variantes conhecidas e se
// descobre QUAL bate. Enquanto o esquema não for conhecido, o nome da
// variante que bateu é registrado e a porta segue protegida pelo segredo
// do header customizado. Descoberto, ele vai para `OPENFINANCE_SIGNATURE`
// e passa a ser EXIGIDO — aí a assinatura é a segunda tranca.
//
// O que nunca acontece: registrar o valor de uma assinatura ou de um
// segredo. Só o NOME da variante.
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto';

/** O nome do esquema que já se sabe exigir, quando já se sabe. */
export function esquemaExigido(): string {
  return (process.env.OPENFINANCE_SIGNATURE || '').trim();
}

export function segredoDeAssinatura(): string {
  return (process.env.POLP_WEBHOOK_SIGNING_SECRET || '').trim();
}

const hmac = (segredo: string, dados: string | Buffer) =>
  createHmac('sha256', segredo).update(dados);

/**
 * Cada jeito conhecido de assinar um webhook, com nome.
 *
 * A lista é curta de propósito: são os formatos que os provedores de
 * verdade usam. Variante que ninguém usa só aumentaria a chance de um
 * acerto por acaso — e um acerto por acaso aqui seria pior que nenhum.
 */
export function variantes(
  segredo: string,
  corpoCru: Buffer,
  carimbo?: string,
): { nome: string; valor: string }[] {
  const fora: { nome: string; valor: string }[] = [];

  fora.push({ nome: 'corpo-hex', valor: hmac(segredo, corpoCru).digest('hex') });
  fora.push({ nome: 'corpo-base64', valor: hmac(segredo, corpoCru).digest('base64') });

  /* Alguns provedores assinam "carimbo.corpo" para que uma entrega
   * capturada não possa ser reenviada depois. Só existe se vier carimbo. */
  if (carimbo) {
    const comPonto = Buffer.concat([Buffer.from(carimbo + '.'), corpoCru]);
    const semPonto = Buffer.concat([Buffer.from(carimbo), corpoCru]);
    fora.push({ nome: 'carimbo.corpo-hex', valor: hmac(segredo, comPonto).digest('hex') });
    fora.push({ nome: 'carimbo.corpo-base64', valor: hmac(segredo, comPonto).digest('base64') });
    fora.push({ nome: 'carimbocorpo-hex', valor: hmac(segredo, semPonto).digest('hex') });
  }

  return fora;
}

/** Comparação que não entrega o segredo pelo tempo que leva. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Os pedaços comparáveis de um header de assinatura.
 *
 * Vem de três formas no mundo real: o valor puro (`abc123…`), com prefixo
 * de algoritmo (`sha256=abc123…`) e em lista com rótulos
 * (`t=1700000000,v1=abc123…`). Em vez de adivinhar qual é, comparam-se
 * todos os pedaços — rótulo nenhum muda o que o HMAC tem de ser.
 */
export function pedacosDoHeader(header: string): string[] {
  const bruto = String(header || '').trim();
  if (!bruto) return [];
  const fora = new Set<string>([bruto]);
  for (const parte of bruto.split(/[,\s]+/)) {
    if (!parte) continue;
    fora.add(parte);
    const igual = parte.indexOf('=');
    /* `base64` legítimo termina em `=`, então só se corta no PRIMEIRO `=`
     * quando há rótulo antes dele. */
    if (igual > 0) fora.add(parte.slice(igual + 1));
  }
  return [...fora].filter(Boolean);
}

/**
 * Qual variante bate com o que chegou? `null` quando nenhuma.
 *
 * Devolve o NOME, nunca o valor: é o nome que vai para o log e, depois,
 * para a variável de ambiente.
 */
export function varianteQueBate(
  header: string,
  segredo: string,
  corpoCru: Buffer,
  carimbo?: string,
): string | null {
  if (!header || !segredo || !corpoCru?.length) return null;
  const pedacos = pedacosDoHeader(header);
  for (const v of variantes(segredo, corpoCru, carimbo)) {
    for (const p of pedacos) {
      if (iguais(p, v.valor)) return v.nome;
    }
  }
  return null;
}
