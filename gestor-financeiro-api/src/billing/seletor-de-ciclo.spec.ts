// ============================================================
// seletor-de-ciclo.spec.ts
// ============================================================
// A tela de assinatura mostrava QUATRO opções: dois planos vezes dois
// ciclos. Comparar Pro com Premium obrigava a pular por cima de uma linha
// que não interessava, e o anual aparecia como um número grande solto, sem
// nada que o ligasse ao mensal ao lado.
//
// Agora um seletor escolhe o ciclo e a lista mostra só os planos dele. O
// que estes testes defendem:
//
//   1. A LISTA NUNCA FICA VAZIA. Um catálogo sem o ciclo escolhido cairia
//      numa tela em branco sem explicação — e o catálogo vem do servidor,
//      que pode desativar um plano a qualquer momento.
//   2. O ANUAL DIZ O MÊS EQUIVALENTE. É o número por onde a pessoa compara;
//      sem ele o seletor troca 29,90 por 286,80 e parece seis vezes mais
//      caro.
//   3. E DIZ TAMBÉM O TOTAL DO ANO, na etiqueta, porque é o que o cartão
//      recebe de uma vez. Esconder isso seria a surpresa mais cara da tela.
//
// As funções são recortadas do próprio `web/home.html` — o mesmo bisturi
// dos geradores —, então elas não podem divergir do que está no ar.
// ============================================================

import { scriptDoApp, funcao } from '../../scripts/recorte';

const src = scriptDoApp();

interface Plano {
  code: string;
  name: string;
  amount: number;
  interval: 'MONTHLY' | 'YEARLY';
}

const CATALOGO: Plano[] = [
  { code: 'pro-mensal', name: 'Pro', amount: 29.9, interval: 'MONTHLY' },
  { code: 'pro-anual', name: 'Pro Anual', amount: 286.8, interval: 'YEARLY' },
  { code: 'premium-mensal', name: 'Premium', amount: 69.9, interval: 'MONTHLY' },
  { code: 'premium-anual', name: 'Premium Anual', amount: 670.8, interval: 'YEARLY' },
];

/** As funções do app, com `esc` e `brl` como elas são lá. */
function recortar() {
  const fora = [
    'function esc(t){return String(t);}',
    'function money(v){return v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}',
    'function brl(v){return (v<0?"−R$ ":"R$ ")+money(Math.abs(v));}',
  ].join('\n');
  const nomes = ['temOsDoisCiclos', 'cicloQueExiste', 'doCiclo', 'opcaoDePlano'];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    fora + '\n' + nomes.map((n) => funcao(src, n)).join('\n') +
      '\nreturn {' + nomes.join(',') + '};',
  )() as {
    temOsDoisCiclos: (p: Plano[]) => boolean;
    cicloQueExiste: (p: Plano[], c: string) => string;
    doCiclo: (p: Plano[], c: string) => Plano[];
    opcaoDePlano: (p: Plano) => string;
  };
}

const app = recortar();

describe('o seletor de ciclo', () => {
  it('aparece quando há os dois ciclos para escolher', () => {
    expect(app.temOsDoisCiclos(CATALOGO)).toBe(true);
  });

  it('some quando o catálogo só tem um: seria um botão que não faz nada', () => {
    const soMensal = CATALOGO.filter((p) => p.interval === 'MONTHLY');
    expect(app.temOsDoisCiclos(soMensal)).toBe(false);
    expect(app.temOsDoisCiclos([])).toBe(false);
  });

  it('o ciclo escolhido cai para o mensal quando o anual não existe mais', () => {
    const soMensal = CATALOGO.filter((p) => p.interval === 'MONTHLY');
    expect(app.cicloQueExiste(soMensal, 'YEARLY')).toBe('MONTHLY');
    expect(app.cicloQueExiste(CATALOGO, 'YEARLY')).toBe('YEARLY');
  });
});

describe('a lista mostra só o ciclo escolhido', () => {
  it('no mensal, dois planos — e nenhum anual', () => {
    const lista = app.doCiclo(CATALOGO, 'MONTHLY');
    expect(lista.map((p) => p.code)).toEqual(['pro-mensal', 'premium-mensal']);
  });

  it('no anual, os outros dois', () => {
    const lista = app.doCiclo(CATALOGO, 'YEARLY');
    expect(lista.map((p) => p.code)).toEqual(['pro-anual', 'premium-anual']);
  });

  /* Quatro linhas eram o problema que o seletor veio resolver. */
  it('nunca mostra os quatro de uma vez', () => {
    expect(app.doCiclo(CATALOGO, 'MONTHLY').length).toBe(2);
    expect(app.doCiclo(CATALOGO, 'YEARLY').length).toBe(2);
  });
});

describe('o que cada opção diz', () => {
  const pro = CATALOGO[0];
  const proAnual = CATALOGO[1];
  const premiumAnual = CATALOGO[3];

  it('no mensal, o valor é o do mês e a frase diz isso', () => {
    const html = app.opcaoDePlano(pro);
    expect(html).toContain('R$ 29,90');
    expect(html).toContain('cobrado todo mês');
    expect(html).not.toContain('por ano');
  });

  /* 286,80 / 12 = 23,90. Sem este número, trocar o seletor substitui 29,90
   * por 286,80 e o anual parece seis vezes mais caro. */
  it('no anual, a frase traz o mês equivalente', () => {
    expect(app.opcaoDePlano(proAnual)).toContain('R$ 23,90 por mês');
    expect(app.opcaoDePlano(premiumAnual)).toContain('R$ 55,90 por mês');
  });

  it('e a etiqueta continua sendo o total do ano, que é o que o cartão recebe', () => {
    expect(app.opcaoDePlano(proAnual)).toContain('R$ 286,80');
    expect(app.opcaoDePlano(premiumAnual)).toContain('R$ 670,80');
  });

  it('a opção carrega o code do catálogo, que é o que vai para o checkout', () => {
    expect(app.opcaoDePlano(proAnual)).toContain('data-assinar="pro-anual"');
  });

  /* O nome vem do servidor, "Anual" repetido e tudo: é o nome que aparece
   * na cobrança e no recibo. */
  it('o nome é o do catálogo, não um inventado pela tela', () => {
    expect(app.opcaoDePlano(proAnual)).toContain('Pro Anual');
  });
});
