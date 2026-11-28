// ============================================================
// entrada-automatica.spec.ts
// ============================================================
// A décima condição mora no app (`web/home.html`), e é a única regra de lá
// que decide sozinha gravar dinheiro aqui. Este teste recorta a função DE
// VERDADE do arquivo — o mesmo bisturi dos geradores — e a executa.
//
// Por que um teste do app dentro da API: a primeira versão desta condição
// subiu para produção com `l.data` no lugar de `l.base.data`. O campo não
// existe, `String(undefined)` é `"undefined"`, e `"undefined" >= "2026-11-15"`
// é VERDADE em comparação de texto. A trava deixava passar tudo, sem erro
// no console, sem exceção, sem nada — e entraram sozinhas compras da fatura
// de julho/2026. Nenhum teste existia para pegar isso, e um script de prova
// escrito à mão não pegou porque inventou a linha com o campo no topo.
//
// Por isso o teste faz duas coisas, nesta ordem: confere a FORMA da linha no
// próprio código de quem a monta, e só então roda a função sobre ela.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

type Linha = { base?: { data?: string } };
type Fonte = { connectionId: string };

const conexoes = [
  { id: 'cx-inter', autorizadaEm: '2026-11-15T13:20:00.000Z' },
  { id: 'cx-nova', autorizadaEm: null },
];

/**
 * A função do app, com o que ela usa de fora.
 *
 * `diaDoInstante` e `isoDate` vêm RECORTADOS também, e não imitados aqui:
 * a conversão de instante para dia é parte da condição desde que
 * `authorizedAt` deixou de ser cortado como texto. Uma imitação escondida
 * no teste provaria a imitação.
 */
function recortar(): (f: Fonte, l: Linha) => boolean {
  const of = { conexoes };
  const byId = (list: any[], id: string) => list.filter((x) => x.id === id)[0];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'of',
    'byId',
    [
      'var FUSO_DO_APP = "America/Sao_Paulo";',
      funcao(src, 'isoDate'),
      funcao(src, 'diaDoInstante'),
      'return (' + funcao(src, 'ofDepoisDeAutorizar') + ');',
    ].join(String.fromCharCode(10)),
  )(of, byId);
}

describe('a décima condição: entra sozinho só o que é posterior à autorização', () => {
  it('a linha da conferência guarda o lançamento em `base`, e não no topo', () => {
    const conferencia = funcao(src, 'linhasDaConferencia');
    const devolve = conferencia.slice(conferencia.lastIndexOf('return {'));
    // Se um dia a linha passar a carregar `data` no topo, este teste cai — e
    // quem mexer lê o cabeçalho acima antes de "arrumar" a condição.
    expect(devolve).toMatch(/return \{\s*base: l,/);
    expect(devolve).not.toMatch(/^\s*data:/m);
  });

  const inter: Fonte = { connectionId: 'cx-inter' };
  const linha = (data: string): Linha => ({ base: { data } });

  const casos: [string, Fonte, Linha, boolean][] = [
    ['compra da fatura de julho/2026 (o caso medido)', inter, linha('2026-06-28'), false],
    ['compra de doze meses atrás', inter, linha('2025-12-20'), false],
    ['compra da véspera da autorização', inter, linha('2026-11-14'), false],
    ['compra do próprio dia da autorização', inter, linha('2026-11-15'), true],
    ['compra de ontem', inter, linha('2026-11-19'), true],
    ['conexão que ainda espera o banco', { connectionId: 'cx-nova' }, linha('2026-11-19'), false],
    ['conexão que não está na lista', { connectionId: 'cx-sumiu' }, linha('2026-11-19'), false],
    ['linha sem data', inter, { base: {} }, false],
    ['linha sem base', inter, {}, false],
    ['data escrita de outro jeito', inter, linha('20/11/2026'), false],
  ];

  it.each(casos)('%s', (_nome, f, l, esperado) => {
    expect(recortar()(f, l)).toBe(esperado);
  });
});

/* A última condição não é sobre a LINHA, é sobre o PASSADO dela.
 *
 * Desfazer um lote que entrou sozinho e ver os mesmos lançamentos entrarem
 * de novo na abertura seguinte foi um defeito medido. A primeira correção
 * cortou a linha da proposta inteira -- e aí quem desfazia para CONFERIR
 * perdia o lançamento para sempre, sem aviso, que foi o segundo defeito
 * medido, em 28/11/2026.
 *
 * O acordo final: a linha CONTINUA oferecida, e só deixa de entrar sozinha.
 */
describe('o que já foi desfeito não entra sozinho de novo', () => {
  const semDuvida = new Function(
    'return (' + funcao(src, 'ofSemDuvida') + ');',
  )() as (l: any) => boolean;

  const linhaLimpa = () => ({
    base: { valor: 10, recusadoAntes: undefined },
    repetida: false,
    pagamento: false,
    candidata: null,
    origem: 'regra',
    categoriaId: 'c1',
  });

  it('a linha que passa em tudo entra', () => {
    expect(semDuvida(linhaLimpa())).toBe(true);
  });

  it('a mesma linha, já desfeita uma vez, não entra', () => {
    const l: any = linhaLimpa();
    l.base.recusadoAntes = true;
    expect(semDuvida(l)).toBe(false);
  });

  /* A marca vem do servidor. Se ela deixar de chegar, isto cai. */
  it('a condição lê a marca do servidor, e não um palpite da tela', () => {
    expect(funcao(src, 'ofSemDuvida')).toContain('!l.base.recusadoAntes');
  });
});
