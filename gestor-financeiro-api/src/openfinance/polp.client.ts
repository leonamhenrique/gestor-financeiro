// ============================================================
// polp.client.ts — a conversa com o provedor, e só isso
// ============================================================
// Esta classe fala com a Polp (provedor Celcoin) e devolve os dados já
// NORMALIZADOS. Ela não decide nada sobre lançamento de ninguém: não casa,
// não grava, não classifica. Separar assim é o que permite trocar de
// provedor sem tocar na regra, e testar a regra sem rede.
//
// POR QUE AS CHAVES FICAM AQUI, E NÃO NO NAVEGADOR
// `x-api-secret` dá acesso a TODOS os consentimentos da conta — os de todo
// mundo, não só os de quem está logado. No navegador ela seria pública. O
// app fala com a nossa API; a nossa API fala com a Polp.
//
// AS TRÊS ARMADILHAS DO PAYLOAD, todas medidas em 15/11/2026 contra fatura
// de verdade (ver scripts/openfinance/MEDICAO.md):
//
// 1. DATA. Chega como `2026-10-16T03:00:00.000000Z` — meia-noite de
//    Brasília escrita em UTC. Converter para hora local TIRA UM DIA, e num
//    cartão que fecha dia 30 isso joga a compra para a outra fatura. Por
//    isso se cortam os 10 primeiros caracteres, e não se usa `new Date`.
//
// 2. VALOR. Vem como string e SEM SINAL (`{ amount: "1500.00" }`). A
//    direção mora em `credit_debit_type`. Somar sem olhar esse campo
//    inverte despesa e receita.
//
// 3. PARCELA FUTURA. Reconhece-se por `bill_id === null`, nunca pela
//    data-sentinela `"0001-01-01"` que a documentação promete e que não
//    apareceu em ambiente nenhum. `bill_forecast_date` existe e é o mês do
//    VENCIMENTO (469 de 469 transações, cartão que atravessa o mês) — mas
//    entra só como CONFERÊNCIA: quem decide a fatura é a regra do app.
// ============================================================

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Uma transação do provedor, já traduzida para o vocabulário do app. */
export interface LancamentoDoProvedor {
  /** O id NO PROVEDOR. É a chave de idempotência: vira `providerTxId`. */
  providerTxId: string;
  /** `AAAA-MM-DD`, sem fuso. Ver armadilha 1. */
  data: string;
  /** Sempre positivo. A direção está em `tipo`. */
  valor: number;
  tipo: 'INCOME' | 'EXPENSE';
  descricao: string;
  /** Categoria que o provedor sugere, quando sugere. Nunca manda no app. */
  categoriaDoProvedor?: string | null;
  /** Parcela `n` de `total`, quando é compra parcelada. */
  parcela?: { numero: number; total: number } | null;
  /** Já faturada? `false` = parcela futura. Ver armadilha 3. */
  faturada: boolean;
  /** `AAAA-MM` do vencimento previsto pelo banco. Só conferência. */
  faturaPrevista?: string | null;
  /** Pagamento de fatura: o app tem caminho próprio e não lança de novo. */
  pagamentoDeFatura: boolean;
}

export interface ContaDoProvedor {
  providerAccountId: string;
  nome: string;
  tipo?: string | null;
  saldo?: number | null;
}

export interface CartaoDoProvedor {
  providerAccountId: string;
  nome: string;
  bandeira?: string | null;
  /** Dias lidos das faturas, quando dá para ler. O app pode comparar. */
  fechamento?: number | null;
  vencimento?: number | null;
}

/* A categoria que o provedor usa para pagamento de fatura de cartão. O app
 * já tem tela e regra próprias para pagar fatura — relançar isso como
 * despesa contaria o mesmo dinheiro duas vezes, porque a fatura já é a soma
 * das compras. Medido: 6 ocorrências num extrato real, nenhuma no sandbox. */
const PAGAMENTO_DE_FATURA = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';

/** Os 10 primeiros caracteres. Ver armadilha 1 — isto não é preciosismo. */
export const soODia = (iso: unknown): string => String(iso ?? '').slice(0, 10);
/** `AAAA-MM`. */
export const soOMes = (iso: unknown): string => String(iso ?? '').slice(0, 7);

@Injectable()
export class PolpClient {
  private readonly base = process.env.POLP_BASE_URL || 'https://api.polp.com.br/api/v2';

  private get client(): string {
    return process.env.POLP_API_CLIENT || '';
  }
  private get secret(): string {
    return process.env.POLP_API_SECRET || '';
  }

  /** Sem chaves não há integração — e isso não é erro, é "desligado". */
  get configurado(): boolean {
    return Boolean(this.client && this.secret);
  }

  private async pedir<T = any>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
    if (!this.configurado) {
      throw new ServiceUnavailableException('Open Finance não está configurado.');
    }
    let r: Response;
    try {
      r = await fetch(this.base + caminho, {
        ...opcoes,
        headers: {
          'x-api-client': this.client,
          'x-api-secret': this.secret,
          'Content-Type': 'application/json',
          ...((opcoes.headers as Record<string, string>) || {}),
        },
      });
    } catch (e: any) {
      /* Rede caindo não é erro do usuário: ele não tem o que corrigir. */
      throw new ServiceUnavailableException('Não consegui falar com o provedor.');
    }
    const texto = await r.text();
    let corpo: any = null;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = null;
    }
    if (!r.ok) {
      /* 402 é plano/fatura da NOSSA conta no provedor, 401 é chave errada:
       * nos dois casos quem conserta somos nós, e o usuário só precisa
       * saber que não deu. A mensagem crua do provedor não sobe. */
      throw new ServiceUnavailableException(
        'O provedor recusou a chamada (HTTP ' + r.status + ').',
      );
    }
    return (corpo?.data ?? corpo) as T;
  }

  // ---------------------------------------------------------------- bancos
  async instituicoes(): Promise<
    Array<{ id: string; nome: string; tipo: string; disponivel: boolean }>
  > {
    const lista = (await this.pedir<any[]>('/institutions')) || [];
    return lista.map((i) => ({
      id: i.id,
      nome: i.name,
      tipo: i.type,
      disponivel: i.status === 'OPERATIONAL',
    }));
  }

  // ----------------------------------------------------------- consentimento
  /**
   * Cria o consentimento e devolve o link em que o DONO DA CONTA autoriza.
   *
   * O CPF passa por aqui e não fica: ele vai para o provedor e some. Guardar
   * documento de alguém para uma integração opcional seria aumentar o que se
   * perde num vazamento, em troca de nada — na reconexão o usuário digita de
   * novo, e isso custa cinco segundos uma vez por ano.
   */
  async criarConsentimento(dados: {
    institutionId: string;
    cpf: string;
    clienteUserId: string;
  }): Promise<{
    consentId: string;
    status: string;
    urlParaAutorizar: string | null;
    urlExpiraEm: string | null;
  }> {
    const c = await this.pedir<any>('/consents', {
      method: 'POST',
      body: JSON.stringify({
        institution_id: dados.institutionId,
        cpf: dados.cpf.replace(/\D/g, ''),
        cliente_user_id: dados.clienteUserId,
        products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
      }),
    });
    return {
      consentId: c.id,
      status: c.status,
      urlParaAutorizar: c.url_to_authenticate ?? null,
      urlExpiraEm: c.url_to_authenticate_expires_at ?? null,
    };
  }

  async consentimento(consentId: string): Promise<{ status: string; execucao: string | null }> {
    const c = await this.pedir<any>('/consents/' + consentId);
    return { status: c.status, execucao: c.execution_status ?? null };
  }

  async revogar(consentId: string): Promise<void> {
    await this.pedir('/consents/' + consentId, { method: 'DELETE' });
  }

  // ------------------------------------------------------------- recursos
  async contas(consentId: string): Promise<ContaDoProvedor[]> {
    const lista = (await this.pedir<any[]>('/consents/' + consentId + '/accounts')) || [];
    return lista.map((c) => ({
      providerAccountId: c.id,
      nome: c.name || c.branch_code || 'Conta',
      tipo: c.type ?? null,
      saldo: c.balance?.amount != null ? Number(c.balance.amount) : null,
    }));
  }

  async cartoes(consentId: string): Promise<CartaoDoProvedor[]> {
    const lista = (await this.pedir<any[]>('/consents/' + consentId + '/credit-cards')) || [];
    return lista.map((k) => ({
      providerAccountId: k.id,
      nome: k.name || k.product_type || 'Cartão',
      bandeira: k.brand_name ?? null,
      fechamento: null,
      vencimento: null,
    }));
  }

  /**
   * Os dias de fechamento e vencimento, lidos das FATURAS.
   *
   * O provedor não entrega "dia 30 e dia 7" num campo: entrega as faturas,
   * cada uma com as suas duas datas. O dia se lê delas — e lê-se da mais
   * recente, porque banco deixa mudar vencimento, e a fatura velha guarda o
   * dia que ela teve, não o de agora.
   */
  async diasDoCartao(
    cartaoId: string,
  ): Promise<{ fechamento: number | null; vencimento: number | null }> {
    const faturas = (await this.pedir<any[]>('/credit-cards/' + cartaoId + '/bills')) || [];
    if (!faturas.length) return { fechamento: null, vencimento: null };
    const recente = faturas
      .slice()
      .sort((a, b) =>
        String(b.bill_closing_date ?? '').localeCompare(String(a.bill_closing_date ?? '')),
      )[0];
    const dia = (iso: unknown) => {
      const d = soODia(iso).slice(8, 10);
      return d ? Number(d) : null;
    };
    return { fechamento: dia(recente.bill_closing_date), vencimento: dia(recente.due_date) };
  }

  // ---------------------------------------------------------- transações
  async transacoesDaConta(contaId: string): Promise<LancamentoDoProvedor[]> {
    const lista = (await this.pedir<any[]>('/accounts/' + contaId + '/transactions')) || [];
    return lista.map((t) => this.traduzir(t));
  }

  async transacoesDoCartao(cartaoId: string): Promise<LancamentoDoProvedor[]> {
    const lista = (await this.pedir<any[]>('/credit-cards/' + cartaoId + '/transactions')) || [];
    return lista.map((t) => this.traduzir(t));
  }

  /**
   * Uma transação do provedor vira um lançamento do app.
   *
   * Traduzir e nada mais: o que fazer com ele — casar, perguntar, ignorar —
   * é decisão de outro lugar, com as regras que o app já tem.
   */
  private traduzir(t: any): LancamentoDoProvedor {
    const bruto = t.brazilian_amount || t.amount || {};
    const numero = t.charge_identificator;
    const total = t.charge_number;
    const parcelada = Number(total) > 1 && Number(numero) >= 1;
    const nome =
      (t.counterparty && (t.counterparty.alias || t.counterparty.name)) || t.transaction_name || '';
    return {
      providerTxId: t.id,
      data: soODia(t.transaction_date_time),
      valor: Math.abs(Number(bruto.amount)),
      tipo: t.credit_debit_type === 'CREDITO' ? 'INCOME' : 'EXPENSE',
      descricao: parcelada ? nome + ' - Parcela ' + numero + '/' + total : nome,
      categoriaDoProvedor: t.category_ref ?? null,
      parcela: parcelada ? { numero: Number(numero), total: Number(total) } : null,
      faturada: Boolean(t.bill_id),
      faturaPrevista: t.bill_forecast_date ? soOMes(t.bill_forecast_date) : null,
      pagamentoDeFatura:
        t.category_ref === PAGAMENTO_DE_FATURA || t.transaction_type === 'PAGAMENTO_FATURA',
    };
  }
}
