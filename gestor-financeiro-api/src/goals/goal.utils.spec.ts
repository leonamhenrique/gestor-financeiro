import { Prisma } from '@prisma/client';
import {
  ZERO,
  aplicadoDasContas,
  emReais,
  mesesAte,
  progressoDoObjetivo,
  saldoDoObjetivo,
  type MovimentoDoObjetivo,
} from './goal.utils';

const d = (n: number | string) => new Prisma.Decimal(n);
const utc = (s: string) => new Date(s + 'T00:00:00.000Z');
const dep = (n: number): MovimentoDoObjetivo => ({ type: 'DEPOSIT', amount: d(n) });
const res = (n: number): MovimentoDoObjetivo => ({ type: 'WITHDRAW', amount: d(n) });

describe('saldo do objetivo', () => {
  it('soma o que entrou e tira o que saiu, a partir do saldo inicial', () => {
    expect(emReais(saldoDoObjetivo(d(1000), [dep(500), res(200), dep(300)]))).toBe('1600.00');
  });

  it('sem movimento nenhum, o saldo é o inicial', () => {
    expect(emReais(saldoDoObjetivo(d(250), []))).toBe('250.00');
  });

  it('fecha no centavo onde Float erraria', () => {
    const doze = Array.from({ length: 12 }, () => dep(0.1));
    expect(emReais(saldoDoObjetivo(ZERO, doze))).toBe('1.20');
  });
});

describe('o que veio das contas', () => {
  it('ignora o saldo inicial: ele nunca passou por conta nenhuma', () => {
    // Mesmo objetivo do teste acima, com 1.000 de saldo inicial: das contas
    // vieram 600, e é esse valor que o saldo geral continua contando.
    expect(emReais(aplicadoDasContas([dep(500), res(200), dep(300)]))).toBe('600.00');
  });

  it('resgatar tudo zera o que as contas emprestaram', () => {
    expect(emReais(aplicadoDasContas([dep(400), res(400)]))).toBe('0.00');
  });

  it('resgatar mais do que aplicou não vira dívida: o piso é zero', () => {
    // Objetivo com 5.000 de saldo inicial e 600 aplicados; resgatou 1.000.
    // Os 400 a mais vieram do saldo inicial — dinheiro que estava fora das
    // contas. Na conta, ele passa a contar, e por isso o total SOBE 400.
    const movimentos = [dep(600), res(1000)];
    expect(emReais(aplicadoDasContas(movimentos))).toBe('0.00');

    const emObjetivosAntes = Number(emReais(aplicadoDasContas([dep(600)])));
    const emObjetivosDepois = Number(emReais(aplicadoDasContas(movimentos)));
    const totalAntes = 10000 + emObjetivosAntes;          // contas + objetivos
    const totalDepois = 10000 + 1000 + emObjetivosDepois; // a conta recebeu 1.000
    expect(totalDepois - totalAntes).toBe(400);
  });

  it('o total nunca muda quando o resgate cabe no que veio das contas', () => {
    const totalAntes = 10000 + Number(emReais(aplicadoDasContas([dep(600)])));
    const totalDepois = 10000 + 200 + Number(emReais(aplicadoDasContas([dep(600), res(200)])));
    expect(totalDepois).toBe(totalAntes);
  });
});

describe('mesesAte', () => {
  it('conta o mês corrente como mês que ainda dá para usar', () => {
    expect(mesesAte(utc('2026-10-07'), utc('2026-12-31'))).toBe(3); // out, nov, dez
  });

  it('prazo no mesmo mês é um mês', () => {
    expect(mesesAte(utc('2026-10-07'), utc('2026-10-31'))).toBe(1);
  });

  it('prazo vencido nunca vira zero nem negativo', () => {
    expect(mesesAte(utc('2026-10-07'), utc('2026-08-01'))).toBe(1);
  });

  it('vira o ano', () => {
    expect(mesesAte(utc('2026-11-10'), utc('2027-02-05'))).toBe(4);
  });
});

describe('progresso e estimativa mensal', () => {
  it('divide o que falta pelos meses que restam', () => {
    // 60.000, nada guardado, 3 meses: 20.000 por mês.
    const p = progressoDoObjetivo(d(60000), ZERO, utc('2026-10-07'), utc('2026-12-31'));
    expect(p.monthlyTarget).toBe('20000.00');
    expect(p.monthsLeft).toBe(3);
    expect(p.remaining).toBe('60000.00');
    expect(p.percent).toBe(0);
  });

  /** O pedido em uma frase: depositar MENOS sobe a mensalidade seguinte, no
   * mesmo prazo. É o teste que define o recurso. */
  it('depositar menos do que o sugerido sobe a estimativa do mês seguinte', () => {
    const meta = d(60000), prazo = utc('2026-12-31');
    const emOutubro = progressoDoObjetivo(meta, ZERO, utc('2026-10-07'), prazo);
    expect(emOutubro.monthlyTarget).toBe('20000.00');

    // Guardou só 5.000 em outubro, em vez dos 20.000 sugeridos.
    const emNovembro = progressoDoObjetivo(meta, d(5000), utc('2026-11-07'), prazo);
    expect(emNovembro.monthsLeft).toBe(2);
    expect(emNovembro.monthlyTarget).toBe('27500.00'); // 55.000 ÷ 2
  });

  it('depositar mais do que o sugerido desce a estimativa', () => {
    const p = progressoDoObjetivo(d(60000), d(40000), utc('2026-11-07'), utc('2026-12-31'));
    expect(p.monthlyTarget).toBe('10000.00'); // 20.000 ÷ 2
  });

  it('meta alcançada não pede mais nada', () => {
    const p = progressoDoObjetivo(d(1000), d(1000), utc('2026-10-07'), utc('2026-12-31'));
    expect([p.remaining, p.monthlyTarget, p.percent]).toEqual(['0.00', '0.00', 1]);
  });

  it('passar da meta não vira porcentagem acima de 100 nem falta negativa', () => {
    const p = progressoDoObjetivo(d(1000), d(1500), utc('2026-10-07'), utc('2026-12-31'));
    expect([p.remaining, p.percent]).toEqual(['0.00', 1]);
  });

  it('prazo vencido com dinheiro faltando sai do trilho', () => {
    const p = progressoDoObjetivo(d(1000), d(300), utc('2026-10-07'), utc('2026-09-30'));
    expect(p.onTrack).toBe(false);
    expect(p.monthlyTarget).toBe('700.00'); // ainda diz o que falta, em um mês
  });

  it('prazo vencido com a meta cumprida continua no trilho', () => {
    expect(progressoDoObjetivo(d(1000), d(1000), utc('2026-10-07'), utc('2026-09-30')).onTrack).toBe(true);
  });

  it('o centavo da mensalidade arredonda para cima, para a meta fechar', () => {
    // 4.000 em 3 meses dá 1.333,33… — e 1.333,33 três vezes fecha em
    // 3.999,99. O número sugerido precisa chegar na meta.
    const p = progressoDoObjetivo(d(4000), ZERO, utc('2026-10-07'), utc('2026-12-31'));
    expect(p.monthlyTarget).toBe('1333.34');
  });

  it('a porcentagem acompanha o guardado', () => {
    expect(progressoDoObjetivo(d(60000), d(0.01), utc('2026-10-07'), utc('2027-12-31')).percent).toBe(0);
    expect(progressoDoObjetivo(d(200), d(50), utc('2026-10-07'), utc('2026-12-31')).percent).toBe(0.25);
  });
});
