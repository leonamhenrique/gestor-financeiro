// ============================================================
// acesso.spec.ts
// ============================================================
// Cancelar quer dizer "não me cobre de novo", não "me tire agora". Quem
// pagou o ciclo fica até o fim dele — e isso vale igual para o mensal e
// para o anual, porque a regra é a DATA, não o tamanho do ciclo.
// ============================================================

import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { acessoLiberado, fimDoCicloPago } from './acesso';

const EM = (iso: string) => new Date(iso + 'T12:00:00.000Z');

describe('acessoLiberado()', () => {
  it('sem assinatura nenhuma, liberado', () => {
    expect(acessoLiberado(null)).toBe(true);
    expect(acessoLiberado(undefined)).toBe(true);
  });

  it.each([
    [SubscriptionStatus.ACTIVE, true],
    [SubscriptionStatus.TRIALING, true],
    [SubscriptionStatus.PAST_DUE, false],
    // INCOMPLETE libera: quem abriu a tela de pagamento e desistiu volta
    // para onde estava. Ninguém perde acesso por ter olhado o preço.
    [SubscriptionStatus.INCOMPLETE, true],
  ])('status %s → libera: %s', (status, esperado) => {
    expect(
      acessoLiberado({ status, cancelAtPeriodEnd: false, currentPeriodEnd: null }),
    ).toBe(esperado);
  });

  // O caso que gerou tudo isto: cancelou no dia 3, pagou até o dia 30.
  it('cancelada no meio do mês segue liberada até o fim do ciclo pago', () => {
    const a = {
      status: SubscriptionStatus.CANCELED,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: EM('2026-11-30'),
    };
    expect(acessoLiberado(a, EM('2026-11-03'))).toBe(true);
    expect(acessoLiberado(a, EM('2026-11-29'))).toBe(true);
  });

  it('passado o fim do ciclo, aí sim bloqueia', () => {
    const a = {
      status: SubscriptionStatus.CANCELED,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: EM('2026-11-30'),
    };
    expect(acessoLiberado(a, EM('2026-12-01'))).toBe(false);
  });

  // Anual pela MESMA regra: quem pagou doze meses e cancela no segundo
  // segue até o fim dos doze. A regra é a data, não o tamanho do ciclo.
  it('anual cancelado no segundo mês vale os dez que faltam', () => {
    const a = {
      status: SubscriptionStatus.CANCELED,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: EM('2027-10-20'),
    };
    expect(acessoLiberado(a, EM('2026-12-15'))).toBe(true);
    expect(acessoLiberado(a, EM('2027-10-19'))).toBe(true);
    expect(acessoLiberado(a, EM('2027-10-21'))).toBe(false);
  });

  // Cancelamento imediato é outra coisa: quem pediu para sair agora, sai.
  it('cancelamento imediato não ganha cortesia', () => {
    expect(
      acessoLiberado(
        { status: SubscriptionStatus.CANCELED, cancelAtPeriodEnd: false, currentPeriodEnd: EM('2026-11-30') },
        EM('2026-11-03'),
      ),
    ).toBe(false);
  });

  // Sem data não há o que honrar. Liberar seria dar acesso vitalício a quem
  // cancelou antes de qualquer pagamento ser confirmado.
  it('cancelada sem data de fim não libera', () => {
    expect(
      acessoLiberado({ status: SubscriptionStatus.CANCELED, cancelAtPeriodEnd: true, currentPeriodEnd: null }),
    ).toBe(false);
  });

  // PAST_DUE é ciclo NAO pago: nao ha cortesia a dar, mesmo com data no
  // futuro sobrando de um ciclo anterior.
  it('inadimplente não entra na cortesia, mesmo com data no futuro', () => {
    expect(
      acessoLiberado(
        { status: SubscriptionStatus.PAST_DUE, cancelAtPeriodEnd: true, currentPeriodEnd: EM('2027-01-01') },
        EM('2026-11-03'),
      ),
    ).toBe(false);
  });
});

// O tranco que isto corrige: antes de clicar em "Assinar" nao havia
// assinatura nenhuma e tudo estava liberado; depois de abrir o checkout e
// desistir, a linha ficava INCOMPLETE e a conta travava. Olhar o preco
// trancava o app.
describe('desistir do checkout não pode trancar a conta', () => {
  it('quem abriu a tela e nao concluiu fica como estava', () => {
    const semAssinatura = acessoLiberado(null);
    const depoisDeDesistir = acessoLiberado({
      status: SubscriptionStatus.INCOMPLETE,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(depoisDeDesistir).toBe(semAssinatura);
    expect(depoisDeDesistir).toBe(true);
  });

  // E quem ja pagou e parou continua bloqueado: a diferenca entre os dois
  // e ter recebido o servico.
  it('mas quem pagou e parou continua bloqueado', () => {
    expect(
      acessoLiberado({
        status: SubscriptionStatus.PAST_DUE,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      }),
    ).toBe(false);
  });
});

describe('fimDoCicloPago()', () => {
  it('mensal soma um mês', () => {
    expect(fimDoCicloPago(EM('2026-11-05'), BillingInterval.MONTHLY).toISOString().slice(0, 10))
      .toBe('2026-12-05');
  });

  it('anual soma um ano', () => {
    expect(fimDoCicloPago(EM('2026-11-05'), BillingInterval.YEARLY).toISOString().slice(0, 10))
      .toBe('2027-11-05');
  });

  // A mesma regra do resto do app: dia 31 cai no último dia válido do mês
  // seguinte, em vez de escorregar para o mês de depois.
  it('31 de janeiro vira 28 de fevereiro, não 3 de março', () => {
    expect(fimDoCicloPago(EM('2027-01-31'), BillingInterval.MONTHLY).toISOString().slice(0, 10))
      .toBe('2027-02-28');
  });

  it('e em ano bissexto, 29', () => {
    expect(fimDoCicloPago(EM('2028-01-31'), BillingInterval.MONTHLY).toISOString().slice(0, 10))
      .toBe('2028-02-29');
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(fimDoCicloPago(EM('2026-12-20'), BillingInterval.MONTHLY).toISOString().slice(0, 10))
      .toBe('2027-01-20');
  });

  // O nome deste teste dizia uma coisa e a asserção aceitava outra: o
  // `setUTCFullYear` escorregava para 1º de março. Agora os dois intervalos
  // usam a mesma regra do resto do app.
  it('29 de fevereiro no anual cai em 28, e não em março', () => {
    expect(fimDoCicloPago(EM('2028-02-29'), BillingInterval.YEARLY).toISOString().slice(0, 10))
      .toBe('2029-02-28');
  });

  it('31 de agosto no anual continua 31 de agosto', () => {
    expect(fimDoCicloPago(EM('2026-08-31'), BillingInterval.YEARLY).toISOString().slice(0, 10))
      .toBe('2027-08-31');
  });
});
