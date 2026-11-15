// ============================================================
// polp.client.spec.ts — as armadilhas do payload, uma a uma
// ============================================================
// Cada caso aqui veio de uma MEDIÇÃO contra fatura de verdade em
// 15/11/2026 (scripts/openfinance/MEDICAO.md), e não de leitura da
// documentação — que, em dois pontos, diz o que não acontece.
// ============================================================

import { PolpClient, ConflitoDeConsentimento } from './polp.client';

describe('PolpClient', () => {
  let polp: PolpClient;
  const original = { ...process.env };

  const responder = (corpo: any, ok = true, status = 200) => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: async () => JSON.stringify(corpo),
    });
  };

  beforeEach(() => {
    process.env.POLP_API_CLIENT = 'cliente-de-teste';
    process.env.POLP_API_SECRET = 'segredo-de-teste';
    polp = new PolpClient();
  });

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  /** Uma transação como o provedor manda. */
  const tx = (resto: any = {}) => ({
    id: 'tx-1',
    transaction_date_time: '2026-10-16T03:00:00.000000Z',
    brazilian_amount: { amount: '1500.00', currency: 'BRL' },
    credit_debit_type: 'DEBITO',
    transaction_name: 'GRANVILLA ACABAMENTOS',
    bill_id: 'fatura-1',
    bill_post_date: '2026-10-22',
    bill_forecast_date: '2026-11',
    charge_identificator: null,
    charge_number: null,
    category_ref: null,
    ...resto,
  });

  const uma = async (resto: any = {}) => {
    responder({ data: [tx(resto)] });
    return (await polp.transacoesDoCartao('k1'))[0];
  };

  // ----------------------------------------------------------- armadilha 1
  /* `2026-10-16T03:00:00Z` é meia-noite de Brasília escrita em UTC.
   * `new Date(...)` em fuso brasileiro devolve o dia 16 às 00h — mas em
   * qualquer servidor a oeste disso devolve o DIA 15. Num cartão que fecha
   * dia 16, um dia a menos muda a fatura da compra. Por isso se corta a
   * string, e o teste trava o comportamento mesmo onde o fuso mentiria. */
  it('a data e cortada, nao convertida: o fuso nao tira um dia', async () => {
    expect((await uma()).data).toBe('2026-10-16');
  });

  it('meia-noite de virada de mes continua no mes certo', async () => {
    const l = await uma({ transaction_date_time: '2026-11-01T03:00:00.000000Z' });
    expect(l.data).toBe('2026-11-01');
  });

  // ----------------------------------------------------------- armadilha 2
  /* O valor vem como STRING e SEM SINAL. A direção está noutro campo, e
   * somar sem olhá-lo inverte despesa e receita. */
  it('o valor vem sem sinal, e a direcao vem de outro campo', async () => {
    const despesa = await uma();
    expect(despesa.valor).toBe(1500);
    expect(despesa.tipo).toBe('EXPENSE');

    const receita = await uma({ credit_debit_type: 'CREDITO' });
    expect(receita.valor).toBe(1500);
    expect(receita.tipo).toBe('INCOME');
  });

  // ----------------------------------------------------------- armadilha 3
  /* A documentação promete `bill_post_date = "0001-01-01"` para parcela
   * ainda não faturada. Medido: vem data REAL, nos dois ambientes. Seguir a
   * documentação faria toda parcela futura entrar como já faturada. */
  it('parcela futura se reconhece por bill_id nulo, e nao pela data', async () => {
    const futura = await uma({ bill_id: null, bill_post_date: '2026-11-13' });
    expect(futura.faturada).toBe(false);

    const faturada = await uma();
    expect(faturada.faturada).toBe(true);
  });

  it('a fatura prevista entra como AAAA-MM, so para conferencia', async () => {
    expect((await uma()).faturaPrevista).toBe('2026-11');
    expect((await uma({ bill_forecast_date: null })).faturaPrevista).toBeNull();
  });

  // ------------------------------------------------------------- parcelas
  it('a parcela entra no texto e no campo', async () => {
    const l = await uma({ charge_identificator: 2, charge_number: 10 });
    expect(l.parcela).toEqual({ numero: 2, total: 10 });
    expect(l.descricao).toBe('GRANVILLA ACABAMENTOS - Parcela 2/10');
  });

  it('compra a vista nao vira "Parcela 1/1"', async () => {
    const l = await uma({ charge_identificator: 1, charge_number: 1 });
    expect(l.parcela).toBeNull();
    expect(l.descricao).toBe('GRANVILLA ACABAMENTOS');
  });

  // -------------------------------------------------- pagamento de fatura
  /* A fatura JA E a soma das compras. Lancar o pagamento dela como despesa
   * da conta contaria o mesmo dinheiro duas vezes. Seis ocorrencias num
   * extrato real; nenhuma em todo o sandbox. */
  it('pagamento de fatura e marcado, porque o app tem caminho proprio', async () => {
    const l = await uma({ category_ref: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' });
    expect(l.pagamentoDeFatura).toBe(true);
    expect((await uma()).pagamentoDeFatura).toBe(false);
  });

  it('o nome da contraparte, quando vem, ganha do descritivo cru', async () => {
    const l = await uma({ counterparty: { name: 'Padaria do Ze' } });
    expect(l.descricao).toBe('Padaria do Ze');
  });

  // ------------------------------------------------------ dias do cartao
  /* Banco deixa mudar o vencimento, e a fatura velha guarda o dia que ELA
   * teve. Por isso os dias saem da fatura mais recente, e nao da primeira
   * que a lista devolver. */
  it('os dias saem da fatura mais recente', async () => {
    responder({
      data: [
        { bill_closing_date: '2025-08-29', due_date: '2025-09-07' },
        { bill_closing_date: '2026-10-30', due_date: '2026-11-07' },
      ],
    });
    expect(await polp.diasDoCartao('k1')).toEqual({ fechamento: 30, vencimento: 7 });
  });

  it('cartao sem fatura nenhuma nao inventa dia', async () => {
    responder({ data: [] });
    expect(await polp.diasDoCartao('k1')).toEqual({ fechamento: null, vencimento: null });
  });

  // ------------------------------------------------- criar consentimento
  const criar = () =>
    polp.criarConsentimento({ institutionId: 'i1', cpf: '123.456.789-00', clienteUserId: 'u1' });

  /* Sem este cabecalho a criacao e a LEGADA, e cada tentativa nasce um
   * consentimento novo -- que, pela documentacao da Polp, queima a cota
   * mensal do CPF naquela instituicao. Seis tentativas num dia gastaram o
   * mes de um banco; por isso isto e um teste, e nao um comentario. */
  it('a criacao vai na versao 3, que e a que impede duplicata', async () => {
    responder({ data: { id: 'c1', status: 'AWAITING_AUTHORIZATION' } }, true, 201);
    await criar();
    const [, opcoes] = (global as any).fetch.mock.calls[0];
    expect(opcoes.headers['x-consent-version']).toBe('3');
    expect(JSON.parse(opcoes.body).cpf).toBe('12345678900');
  });

  it('201 e consentimento novo; 200 e reaproveitado', async () => {
    responder({ data: { id: 'c1', status: 'AWAITING_AUTHORIZATION' } }, true, 201);
    expect((await criar()).reaproveitado).toBe(false);

    responder({ data: { id: 'c1', status: 'AWAITING_AUTHORIZATION' } }, true, 200);
    expect((await criar()).reaproveitado).toBe(true);
  });

  /* 409 aqui NAO e falha: e o provedor dizendo "ja existe, e o id e este".
   * Tratar como erro generico foi o que deixou seis consentimentos para
   * tras no mesmo banco. */
  it('409 vira conflito legivel, com o id e o prazo', async () => {
    responder(
      { reason: 'CONSENT_ALREADY_AUTHORISED', consent_id: 'c-ja', available_at: null },
      false,
      409,
    );
    await expect(criar()).rejects.toMatchObject({
      name: 'ConflitoDeConsentimento',
      motivo: 'CONSENT_ALREADY_AUTHORISED',
      consentId: 'c-ja',
    });

    responder(
      { reason: 'AUTHORIZATION_LINK_ACTIVE', available_at: '2026-11-15T18:00:00Z' },
      false,
      409,
    );
    await expect(criar()).rejects.toMatchObject({
      motivo: 'AUTHORIZATION_LINK_ACTIVE',
      disponivelEm: '2026-11-15T18:00:00Z',
    });
  });

  it('outro erro na criacao continua sendo indisponibilidade, sem vazar corpo', async () => {
    responder({ message: 'Plano inativo' }, false, 402);
    await expect(criar()).rejects.toThrow(/recusou a criação/);
    await expect(criar()).rejects.not.toBeInstanceOf(ConflitoDeConsentimento);
  });

  // ------------------------------------------------------------ segredos
  it('sem chaves, nao esta configurado', () => {
    delete process.env.POLP_API_CLIENT;
    delete process.env.POLP_API_SECRET;
    expect(new PolpClient().configurado).toBe(false);
  });

  /* 402 e plano/fatura da NOSSA conta no provedor, 401 e chave errada: em
   * nenhum dos dois o usuario tem o que corrigir, e a mensagem crua do
   * provedor nao deve subir junto. */
  it('erro do provedor nao vaza corpo nem segredo', async () => {
    responder({ message: 'Plano inativo', chave: 'segredo-de-teste' }, false, 402);
    await expect(polp.instituicoes()).rejects.toThrow(/recusou a chamada \(HTTP 402\)/);
  });

  it('a chave vai no cabecalho, nunca na URL', async () => {
    responder({ data: [] });
    await polp.instituicoes();
    const [url, opcoes] = (global as any).fetch.mock.calls[0];
    expect(url).not.toContain('segredo-de-teste');
    expect(opcoes.headers['x-api-secret']).toBe('segredo-de-teste');
  });

  it('rede caindo vira indisponivel, e nao erro de usuario', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(polp.instituicoes()).rejects.toThrow(/falar com o provedor/);
  });
});
