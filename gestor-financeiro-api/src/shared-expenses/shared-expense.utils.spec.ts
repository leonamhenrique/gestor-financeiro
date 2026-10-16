// ============================================================
// shared-expense.utils.spec.ts
// ============================================================

import { BadRequestException } from '@nestjs/common';
import {
  dividir,
  saldoDaPessoa,
  normalizarDespesa,
  emCentavos,
} from './shared-expense.utils';

describe('dividir()', () => {
  it('50/50 entre mim e uma pessoa', () => {
    const r = dividir(200, 'IGUAL', [{ personId: 'rafael' }]);
    expect(r.minhaParte).toBe(100);
    expect(r.partes).toEqual([{ personId: 'rafael', amount: 100, percent: null }]);
  });

  // O caso que o float estraga: 100/3 em ponto flutuante dá 33.33333…, e
  // três dessas não somam 100.
  it('divisão que não fecha redonda: o centavo que sobra é MEU', () => {
    const r = dividir(100, 'IGUAL', [{ personId: 'a' }, { personId: 'b' }]);
    expect(r.partes.map((p) => p.amount)).toEqual([33.33, 33.33]);
    expect(r.minhaParte).toBe(33.34);
    expect(r.minhaParte + r.partes[0].amount + r.partes[1].amount).toBe(100);
  });

  it('a soma de todas as partes é sempre o total', () => {
    // Valores escolhidos para cair em resto: 0,01 a 0,99 de sobra.
    for (const total of [0.05, 10.01, 99.99, 1234.56, 7.77]) {
      for (const quantos of [1, 2, 3, 4]) {
        const gente = Array.from({ length: quantos }, (_, i) => ({ personId: 'p' + i }));
        const r = dividir(total, 'IGUAL', gente);
        const soma = r.partes.reduce((s, p) => s + emCentavos(p.amount), emCentavos(r.minhaParte));
        expect(soma).toBe(emCentavos(total));
      }
    }
  });

  it('valor pequeno demais para o tanto de gente diz exatamente isso', () => {
    expect(() =>
      dividir(0.03, 'IGUAL', [{ personId: 'a' }, { personId: 'b' }, { personId: 'c' }, { personId: 'd' }]),
    ).toThrow('0,03 não dá para dividir entre 5 pessoas.');
  });

  it('por valor: a minha parte é o que sobra', () => {
    const r = dividir(220, 'VALOR', [{ personId: 'rafael', amount: 110 }]);
    expect(r.minhaParte).toBe(110);
  });

  it('por valor com mais de uma pessoa', () => {
    const r = dividir(300, 'VALOR', [
      { personId: 'a', amount: 100 },
      { personId: 'b', amount: 50 },
    ]);
    expect(r.minhaParte).toBe(150);
  });

  it('por percentual guarda o percentual, para a tela mostrar 50% e não 49,99%', () => {
    const r = dividir(1200, 'PERCENTUAL', [{ personId: 'rafael', percent: 50 }]);
    expect(r.partes[0]).toEqual({ personId: 'rafael', amount: 600, percent: 50 });
    expect(r.minhaParte).toBe(600);
  });

  it('percentual que não dá número redondo arredonda a PARTE, não o total', () => {
    // 33% de 10,00 = 3,30; sobra 6,70 para mim.
    const r = dividir(10, 'PERCENTUAL', [{ personId: 'a', percent: 33 }]);
    expect(r.partes[0].amount).toBe(3.3);
    expect(r.minhaParte).toBe(6.7);
  });

  it('a pessoa pode ficar com 100%: paguei algo que era todo dela', () => {
    const r = dividir(80, 'PERCENTUAL', [{ personId: 'a', percent: 100 }]);
    expect(r.partes[0].amount).toBe(80);
    expect(r.minhaParte).toBe(0);
  });

  // ---- o que não passa ----
  it('recusa total zero ou negativo', () => {
    expect(() => dividir(0, 'IGUAL', [{ personId: 'a' }])).toThrow(BadRequestException);
    expect(() => dividir(-5, 'IGUAL', [{ personId: 'a' }])).toThrow(BadRequestException);
  });

  it('recusa lista vazia de pessoas', () => {
    expect(() => dividir(100, 'IGUAL', [])).toThrow(BadRequestException);
  });

  it('recusa a mesma pessoa duas vezes', () => {
    expect(() =>
      dividir(100, 'VALOR', [
        { personId: 'a', amount: 10 },
        { personId: 'a', amount: 20 },
      ]),
    ).toThrow(/mais de uma vez/);
  });

  it('recusa parte que passa do total', () => {
    expect(() => dividir(100, 'VALOR', [{ personId: 'a', amount: 150 }])).toThrow(/passou do valor/);
  });

  it('recusa percentuais que somam mais de 100', () => {
    expect(() =>
      dividir(100, 'PERCENTUAL', [
        { personId: 'a', percent: 60 },
        { personId: 'b', percent: 60 },
      ]),
    ).toThrow(/100%/);
  });

  it('recusa parte zerada: dividir com alguém por nada não é dividir', () => {
    expect(() => dividir(100, 'VALOR', [{ personId: 'a', amount: 0 }])).toThrow(/maior que zero/);
  });

  it('recusa valor faltando no modo VALOR', () => {
    expect(() => dividir(100, 'VALOR', [{ personId: 'a' }])).toThrow(/valor da parte/);
  });
});

describe('saldoDaPessoa()', () => {
  it('o que eu paguei vira crédito meu', () => {
    const s = saldoDaPessoa([{ euPaguei: true, total: 200, parteDela: 100 }], []);
    expect(s).toBe(100);
  });

  it('o que ela pagou vira dívida minha — pela MINHA parte, não pela dela', () => {
    // Bruna pagou 240, a parte dela é 120, logo a minha também é 120.
    const s = saldoDaPessoa([{ euPaguei: false, total: 240, parteDela: 120 }], []);
    expect(s).toBe(-120);
  });

  it('acerto recebido abate o que ela me devia', () => {
    const s = saldoDaPessoa(
      [{ euPaguei: true, total: 2000, parteDela: 1000 }],
      [{ direction: 'RECEIVED', amount: 300 }],
    );
    expect(s).toBe(700);
  });

  it('acerto pago abate o que eu devia', () => {
    const s = saldoDaPessoa(
      [{ euPaguei: false, total: 240, parteDela: 120 }],
      [{ direction: 'PAID', amount: 120 }],
    );
    expect(s).toBe(0);
  });

  it('a tela do Rafael, inteira', () => {
    // Jantar 200/100, Gasolina 220/110, Mercado 380/190, Aluguel 1200/600,
    // menos o Pix de 300 que ele mandou.
    const s = saldoDaPessoa(
      [
        { euPaguei: true, total: 200, parteDela: 100 },
        { euPaguei: true, total: 220, parteDela: 110 },
        { euPaguei: true, total: 380, parteDela: 190 },
        { euPaguei: true, total: 1200, parteDela: 600 },
      ],
      [{ direction: 'RECEIVED', amount: 300 }],
    );
    expect(s).toBe(700);
  });

  it('sem nada, o saldo é zero e não NaN', () => {
    expect(saldoDaPessoa([], [])).toBe(0);
  });

  it('centavos não derrapam ao longo de muitos lançamentos', () => {
    const muitas = Array.from({ length: 300 }, () => ({
      euPaguei: true,
      total: 0.03,
      parteDela: 0.01,
    }));
    expect(saldoDaPessoa(muitas, [])).toBe(3);
  });
});

describe('normalizarDespesa()', () => {
  it('quando eu paguei, os dados vêm do lançamento', () => {
    const r = normalizarDespesa({
      id: 'd1',
      transaction: {
        amount: 200,
        description: 'Jantar',
        transactionDate: new Date('2026-10-12'),
        categoryId: 'cat-1',
      },
      shares: [{ personId: 'rafael', amount: 100, percent: null }],
    });
    expect(r.euPaguei).toBe(true);
    expect(r.description).toBe('Jantar');
    expect(r.total).toBe(200);
    expect(r.minhaParte).toBe(100);
  });

  it('quando ela pagou, não há lançamento e os dados são os da própria despesa', () => {
    const r = normalizarDespesa({
      id: 'd2',
      transaction: null,
      amount: 240,
      description: 'Ingressos do show',
      expenseDate: new Date('2026-10-07'),
      categoryId: 'cat-2',
      paidByPersonId: 'bruna',
      shares: [{ personId: 'bruna', amount: 120, percent: 50 }],
    });
    expect(r.euPaguei).toBe(false);
    expect(r.paidByPersonId).toBe('bruna');
    expect(r.description).toBe('Ingressos do show');
    expect(r.minhaParte).toBe(120);
  });

  it('minha parte fecha mesmo com três pessoas e resto de centavo', () => {
    const r = normalizarDespesa({
      id: 'd3',
      transaction: { amount: 100, description: 'Táxi', transactionDate: new Date(), categoryId: 'c' },
      shares: [
        { personId: 'a', amount: 33.33, percent: null },
        { personId: 'b', amount: 33.33, percent: null },
      ],
    });
    expect(r.minhaParte).toBe(33.34);
  });

  it('Decimal do Prisma chega como objeto e não vira NaN', () => {
    // O Prisma devolve Decimal, não number: `Number()` é o que salva.
    const decimal = { toString: () => '150.50' } as unknown;
    const r = normalizarDespesa({
      id: 'd4',
      transaction: null,
      amount: decimal,
      description: 'Mercado',
      expenseDate: new Date('2026-10-05'),
      shares: [{ personId: 'a', amount: { toString: () => '50.25' } as unknown }],
    });
    expect(r.total).toBe(150.5);
    expect(r.minhaParte).toBe(100.25);
  });
});
