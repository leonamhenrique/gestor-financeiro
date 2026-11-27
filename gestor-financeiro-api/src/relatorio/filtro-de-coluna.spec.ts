// ============================================================
// filtro-de-coluna.spec.ts
// ============================================================
// O extrato ganhou filtro por coluna: "me mostre só o que saiu desta conta".
//
// A parte que erra fácil não é filtrar — é decidir O QUE OFERECER. Três
// regras, e as três têm um jeito errado que parece certo:
//
//   1. As opções saem do MÊS que está na tela, e não do cadastro. Oferecer
//      uma conta sem movimento no mês devolveria lista vazia, e isso parece
//      defeito, não recorte.
//   2. A lista de uma coluna IGNORA o filtro dela mesma. Senão, depois de
//      escolher "Nubank" a única opção oferecida seria "Nubank" — e não
//      haveria como trocar.
//   3. ...mas RESPEITA os das outras. Escolhida uma conta, só as categorias
//      que existem nela são oferecidas; nenhuma escolha leva a nada.
//
// E um caso que a bancada pegou: a linha da fatura guarda o METADADO no
// campo `categoria` ("2 compras · vence dia 17"). Sem cuidado, isso vira
// opção de categoria.
// ============================================================

import { scriptDoApp, funcao, bloco } from '../../scripts/recorte';

const src = scriptDoApp();

interface Linha {
  data: string;
  valor: number;
  desc: string;
  categoria: string;
  origem: string;
  semCategoria?: boolean;
}

interface Opcao {
  valor: string;
  quantos: number;
}

/** As funções do app, com o estado do filtro na mão para o teste mexer. */
function recortar(filtro: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    'filtroColuna',
    [
      'var COLUNAS = ' + bloco(src, '[', 'var COLUNAS = ') + ';',
      funcao(src, 'passaNosFiltrosDeColuna'),
      funcao(src, 'opcoesDasColunas'),
      'return { opcoes: opcoesDasColunas, passa: passaNosFiltrosDeColuna, COLUNAS: COLUNAS };',
    ].join(String.fromCharCode(10)),
  )(filtro) as {
    opcoes: (l: Linha[]) => Record<string, Opcao[]>;
    passa: (l: Linha, menos: string | null) => boolean;
    COLUNAS: Array<{ campo: string; filtravel?: boolean }>;
  };
}

const MES: Linha[] = [
  { data: '2026-09-11', valor: -610, desc: 'Condomínio', categoria: 'Moradia', origem: 'Itaú' },
  { data: '2026-09-12', valor: 3200, desc: 'Pagamento', categoria: 'Freelance', origem: 'Nubank' },
  { data: '2026-09-13', valor: -284, desc: 'Supermercado', categoria: 'Alimentação', origem: 'Nubank' },
  { data: '2026-09-20', valor: -34, desc: 'Streaming', categoria: 'Assinaturas', origem: 'Nubank' },
  // A fatura: o campo `categoria` carrega o metadado, não uma categoria.
  {
    data: '2026-09-17',
    valor: -985,
    desc: 'Fatura Nubank Roxinho',
    categoria: '2 compras · vence dia 17',
    semCategoria: true,
    origem: 'Nubank Roxinho',
  },
];

const nomes = (ops: Opcao[]) => ops.map((o) => o.valor);

describe('o que cada coluna oferece', () => {
  it('só as colunas marcadas como filtráveis têm opções', () => {
    const app = recortar({ categoria: '', origem: '' });
    const filtraveis = app.COLUNAS.filter((c) => c.filtravel).map((c) => c.campo);
    expect(filtraveis.sort()).toEqual(['categoria', 'origem']);
    expect(Object.keys(app.opcoes(MES)).sort()).toEqual(['categoria', 'origem']);
  });

  it('as opções saem do mês, com a contagem de cada uma', () => {
    const app = recortar({ categoria: '', origem: '' });
    const ops = app.opcoes(MES).origem;
    expect(nomes(ops)).toEqual(['Itaú', 'Nubank', 'Nubank Roxinho']);
    expect(ops.find((o) => o.valor === 'Nubank')!.quantos).toBe(3);
  });

  it('em ordem alfabética do português, não da tabela ASCII', () => {
    const app = recortar({ categoria: '', origem: '' });
    expect(nomes(app.opcoes(MES).categoria)).toEqual([
      'Alimentação',
      'Assinaturas',
      'Freelance',
      'Moradia',
    ]);
  });

  /* O metadado da fatura NÃO é categoria. */
  it('a linha da fatura não polui a lista de categorias', () => {
    const app = recortar({ categoria: '', origem: '' });
    expect(nomes(app.opcoes(MES).categoria)).not.toContain('2 compras · vence dia 17');
    // Mas ela continua oferecida pela conta/cartão, que é onde faz sentido.
    expect(nomes(app.opcoes(MES).origem)).toContain('Nubank Roxinho');
  });

  /* Sem isto, escolhida uma conta a única opção seria ela mesma — e não
   * haveria como trocar sem antes limpar. */
  it('a lista de uma coluna ignora o filtro DELA', () => {
    const app = recortar({ categoria: '', origem: 'Nubank' });
    expect(nomes(app.opcoes(MES).origem)).toEqual(['Itaú', 'Nubank', 'Nubank Roxinho']);
  });

  /* ...mas respeita os das outras: nenhuma escolha leva a lista vazia. */
  it('a lista de uma coluna respeita os filtros das OUTRAS', () => {
    const app = recortar({ categoria: '', origem: 'Itaú' });
    expect(nomes(app.opcoes(MES).categoria)).toEqual(['Moradia']);
  });

  it('e o cruzamento funciona nos dois sentidos', () => {
    const app = recortar({ categoria: 'Moradia', origem: '' });
    expect(nomes(app.opcoes(MES).origem)).toEqual(['Itaú']);
  });
});

describe('o que passa pelo filtro', () => {
  it('sem filtro, tudo passa', () => {
    const app = recortar({ categoria: '', origem: '' });
    expect(MES.filter((l) => app.passa(l, null))).toHaveLength(5);
  });

  it('com a conta escolhida, só as linhas dela', () => {
    const app = recortar({ categoria: '', origem: 'Nubank' });
    const ficaram = MES.filter((l) => app.passa(l, null));
    expect(ficaram).toHaveLength(3);
    expect(ficaram.every((l) => l.origem === 'Nubank')).toBe(true);
  });

  /* "Nubank" não pode arrastar "Nubank Roxinho" junto: a comparação é
   * exata, e não por pedaço do nome. */
  it('o nome bate inteiro, e não por pedaço', () => {
    const app = recortar({ categoria: '', origem: 'Nubank' });
    const ficaram = MES.filter((l) => app.passa(l, null));
    expect(ficaram.map((l) => l.desc)).not.toContain('Fatura Nubank Roxinho');
  });

  it('dois filtros se somam, nunca se substituem', () => {
    const app = recortar({ categoria: 'Alimentação', origem: 'Nubank' });
    const ficaram = MES.filter((l) => app.passa(l, null));
    expect(ficaram.map((l) => l.desc)).toEqual(['Supermercado']);
  });

  /* Filtrar por uma categoria de verdade esconde a fatura, e isso é o
   * certo: fatura não tem categoria. */
  it('filtrar por categoria some com a fatura', () => {
    const app = recortar({ categoria: 'Moradia', origem: '' });
    expect(MES.filter((l) => app.passa(l, null)).map((l) => l.desc)).toEqual(['Condomínio']);
  });
});
