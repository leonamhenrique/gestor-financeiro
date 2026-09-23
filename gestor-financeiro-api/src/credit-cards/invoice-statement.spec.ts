import { FaturaGravada, hojeNoFuso, limiteEmUso, faturaAtual, montarFaturas } from './invoice-statement';

// Cartão que fecha dia 10 e vence dia 17. Datas como o Prisma entrega colunas
// @db.Date: meia-noite UTC do dia.
const CARTAO = { closingDay: 10, dueDay: 17 };
const d = (s: string) => new Date(s + 'T00:00:00.000Z');

function fatura(mes: string, compras: number, pagamentos: [number, string][] = []): FaturaGravada {
  return {
    id: 'inv-' + mes,
    referenceMonth: d(mes + '-01'),
    closingDate: d(mes + '-10'),
    dueDate: d(mes + '-17'),
    totalAmount: compras,
    payments: pagamentos.map(([valor, data], i) => ({ id: `pg-${mes}-${i}`, amount: valor, paidAt: d(data), bankAccountId: 'acc-1' })),
  };
}
const status = (lista: ReturnType<typeof montarFaturas>, mes: string) => lista.find((f) => f.referenceMonth === mes)!;

describe('montarFaturas — status pelas datas', () => {
  const setembro = [fatura('2026-09', 500)];

  it('OPEN até o dia do fechamento, inclusive', () => {
    expect(status(montarFaturas(CARTAO, setembro, '2026-09-05'), '2026-09').status).toBe('OPEN');
    expect(status(montarFaturas(CARTAO, setembro, '2026-09-10'), '2026-09').status).toBe('OPEN');
  });

  it('CLOSED entre o fechamento e o vencimento', () => {
    expect(status(montarFaturas(CARTAO, setembro, '2026-09-12'), '2026-09').status).toBe('CLOSED');
  });

  it('o dia do vencimento ainda é dia de pagar: CLOSED, não OVERDUE', () => {
    expect(status(montarFaturas(CARTAO, setembro, '2026-09-17'), '2026-09').status).toBe('CLOSED');
  });

  it('OVERDUE a partir do dia seguinte ao vencimento, sem pagamento', () => {
    expect(status(montarFaturas(CARTAO, setembro, '2026-09-18'), '2026-09').status).toBe('OVERDUE');
  });

  it('fatura sem nada a pagar nunca fica atrasada', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 0)], '2026-09-25');
    expect(status(r, '2026-09').status).toBe('CLOSED');
  });
});

describe('montarFaturas — pagamentos', () => {
  it('um pagamento que cobre tudo fecha a fatura como PAID, mesmo pago atrasado', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 500, [[500, '2026-09-22']])], '2026-09-25');
    expect(status(r, '2026-09')).toMatchObject({ status: 'PAID', paid: 500, payable: 0, openAmount: 0 });
  });

  it('vários pagamentos na mesma fatura somam', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 845.3, [[300, '2026-09-11'], [200, '2026-09-12']])], '2026-09-13');
    expect(status(r, '2026-09')).toMatchObject({ status: 'CLOSED', paid: 500, payable: 345.3, openAmount: 345.3 });
  });

  it('três pagamentos até quitar: PAID e nada transportado', () => {
    const r = montarFaturas(
      CARTAO,
      [fatura('2026-09', 700, [[300, '2026-09-11'], [250, '2026-09-12'], [150, '2026-09-13']])],
      '2026-09-30',
    );
    expect(status(r, '2026-09')).toMatchObject({ status: 'PAID', carriedOut: 0 });
    expect(r).toHaveLength(1);
  });

  it('centavos não se perdem em pagamentos quebrados', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 0.3, [[0.1, '2026-09-11'], [0.2, '2026-09-12']])], '2026-09-13');
    expect(status(r, '2026-09')).toMatchObject({ status: 'PAID', payable: 0 });
  });
});

describe('montarFaturas — rotativo', () => {
  it('pagamento parcial ANTES do vencimento não transporta: a fatura segue pagável', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000, [[400, '2026-09-12']])], '2026-09-17');
    expect(status(r, '2026-09')).toMatchObject({ status: 'CLOSED', carriedOut: 0, payable: 600 });
    expect(r).toHaveLength(1);
  });

  it('depois do vencimento o que sobrou vai para a fatura seguinte, que nasce só com o transporte', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000, [[400, '2026-09-12']])], '2026-09-18');
    expect(status(r, '2026-09')).toMatchObject({ status: 'CARRIED', carriedOut: 600, payable: 0, openAmount: 0 });
    expect(status(r, '2026-10')).toMatchObject({ id: null, carriedIn: 600, due: 600, payable: 600, status: 'OPEN' });
  });

  it('o transporte soma às compras do mês seguinte', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000, [[400, '2026-09-12']]), fatura('2026-10', 250)], '2026-09-20');
    expect(status(r, '2026-10')).toMatchObject({ id: 'inv-2026-10', purchases: 250, carriedIn: 600, due: 850 });
  });

  it('sem pagamento nenhum NÃO transporta: continua atrasada no mês dela', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000)], '2026-09-30');
    expect(status(r, '2026-09')).toMatchObject({ status: 'OVERDUE', carriedOut: 0, payable: 1000 });
    expect(r).toHaveLength(1);
  });

  it('encadeia: parcial em setembro e em outubro leva o resto até novembro', () => {
    const r = montarFaturas(
      CARTAO,
      [fatura('2026-09', 1000, [[400, '2026-09-12']]), fatura('2026-10', 200, [[300, '2026-10-15']])],
      '2026-10-20',
    );
    expect(status(r, '2026-10')).toMatchObject({ due: 800, paid: 300, carriedOut: 500, status: 'CARRIED' });
    expect(status(r, '2026-11')).toMatchObject({ carriedIn: 500, payable: 500 });
  });

  it('o limite conta o valor transportado uma vez só', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000, [[400, '2026-09-12']])], '2026-09-18');
    expect(limiteEmUso(r)).toBe(600);
  });

  it('a fatura atual é a mais antiga com algo a pagar', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', 1000, [[400, '2026-09-12']]), fatura('2026-10', 250)], '2026-09-20');
    expect(faturaAtual(r)!.referenceMonth).toBe('2026-10');
  });
});

describe('montarFaturas — datas pelo ciclo do cartão', () => {
  // Cartão que fecha 28 e vence 5: a fatura de setembro vence em 05/10.
  const CARTAO_28_5 = { closingDay: 28, dueDay: 5 };
  // Linha gravada pelo código antigo, com o vencimento no mês errado (05/09).
  const antiga: FaturaGravada = {
    id: 'inv-set',
    referenceMonth: d('2026-09-01'),
    closingDate: d('2026-09-28'),
    dueDate: d('2026-09-05'),
    totalAmount: 1000,
    payments: [{ id: 'p1', amount: 400, paidAt: d('2026-09-30'), bankAccountId: 'acc-1' }],
  };

  it('usa o vencimento do ciclo (05/10), não o gravado errado', () => {
    const r = montarFaturas(CARTAO_28_5, [antiga], '2026-10-01');
    expect(status(r, '2026-09')).toMatchObject({ dueDate: '2026-10-05', status: 'CLOSED', carriedOut: 0, payable: 600 });
  });

  it('o dia 05/10 ainda é dia de pagar; o rotativo só vem no dia 06', () => {
    expect(status(montarFaturas(CARTAO_28_5, [antiga], '2026-10-05'), '2026-09').status).toBe('CLOSED');
    const r = montarFaturas(CARTAO_28_5, [antiga], '2026-10-06');
    expect(status(r, '2026-09')).toMatchObject({ status: 'CARRIED', carriedOut: 600 });
    expect(status(r, '2026-10')).toMatchObject({ carriedIn: 600, dueDate: '2026-11-05' });
  });

  it('vencimento dia 31 em fevereiro: atrasa em 01/03, não em 04/03', () => {
    const fev: FaturaGravada = {
      id: 'inv-fev',
      referenceMonth: d('2026-02-01'),
      closingDate: d('2026-02-10'),
      dueDate: d('2026-03-03'), // o que o código antigo gravava
      totalAmount: 300,
      payments: [],
    };
    const cartao = { closingDay: 10, dueDay: 31 };
    expect(status(montarFaturas(cartao, [fev], '2026-02-28'), '2026-02').status).toBe('CLOSED');
    expect(status(montarFaturas(cartao, [fev], '2026-03-01'), '2026-02')).toMatchObject({ status: 'OVERDUE', dueDate: '2026-02-28' });
  });
});

describe('montarFaturas — saldo credor', () => {
  it('estorno maior que as compras deixa o em-aberto negativo (aumenta o disponível) e nada a pagar', () => {
    const r = montarFaturas(CARTAO, [fatura('2026-09', -50)], '2026-09-20');
    expect(status(r, '2026-09')).toMatchObject({ openAmount: -50, payable: 0 });
    expect(limiteEmUso(r)).toBe(-50);
  });
});

describe('hojeNoFuso', () => {
  it('usa o dia do calendário de São Paulo, não o de UTC', () => {
    // 02:00 UTC do dia 18 ainda é 23:00 do dia 17 em São Paulo.
    expect(hojeNoFuso(new Date('2026-09-18T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-09-17');
  });
});
