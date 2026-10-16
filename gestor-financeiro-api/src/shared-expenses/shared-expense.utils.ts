// ============================================================
// shared-expense.utils.ts
// ============================================================
// As contas do módulo, sem banco nenhum: rateio, parte de cada um e saldo
// da pessoa. Separadas para poderem ser testadas sozinhas — é aqui que mora
// o risco de um centavo sumir, e centavo sumido só aparece em teste.
//
// TODA conta acontece em CENTAVOS INTEIROS. Dividir 100 por 3 em ponto
// flutuante devolve 33.33333333333333, e três dessas somam 99,99999999 —
// que não é 100. Com inteiro, o que sobra é um resto explícito, e alguém
// precisa ficar com ele.
//
// Quem fica com o resto sou EU, nunca o outro. Dividir 100 em três dá
// 33,33 + 33,33 + 33,34, e o centavo a mais é meu. Arredondar para o lado do
// amigo seria cobrar dele um centavo que não é dele — e, repetido todo mês,
// é o tipo de diferença que ninguém consegue explicar olhando a tela.
// ============================================================

import { BadRequestException } from '@nestjs/common';

export type ModoDeDivisao = 'IGUAL' | 'VALOR' | 'PERCENTUAL';

export interface Participante {
  personId: string;
  /** Só no modo VALOR: quanto esta pessoa deve. */
  amount?: number;
  /** Só no modo PERCENTUAL: a fatia dela, de 0 a 100. */
  percent?: number;
}

export interface Rateio {
  minhaParte: number;
  partes: { personId: string; amount: number; percent: number | null }[];
}

// ------------------------------------------------------------
// Centavos
// ------------------------------------------------------------

/** Reais → centavos inteiros. `Math.round` e não `|0`: 0.1 + 0.2 chega aqui
 * como 30.000000000000004, e truncar viraria 3000 em um caso e 2999 no
 * outro, dependendo do humor do float. */
export function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function emReais(centavos: number): number {
  return centavos / 100;
}

// ------------------------------------------------------------
// Rateio
// ------------------------------------------------------------

/**
 * Divide `total` entre mim e os participantes. Devolve a parte de cada um
 * deles e a minha — e a soma de tudo é exatamente `total`, sempre.
 *
 * A minha parte nunca é um número informado: é o que sobra. É o mesmo
 * princípio do bloco de saldo do extrato, onde a movimentação do mês é a
 * diferença entre dois saldos, e não uma terceira conta que pode não fechar.
 */
export function dividir(total: number, modo: ModoDeDivisao, participantes: Participante[]): Rateio {
  const T = emCentavos(total);
  if (!Number.isFinite(T) || T <= 0) {
    throw new BadRequestException('O valor da despesa deve ser maior que zero.');
  }
  if (!participantes || participantes.length === 0) {
    throw new BadRequestException('Informe ao menos uma pessoa para dividir.');
  }
  const ids = participantes.map((p) => p.personId);
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('A mesma pessoa foi informada mais de uma vez.');
  }

  const partes =
    modo === 'IGUAL'
      ? igual(T, participantes)
      : modo === 'VALOR'
        ? porValor(T, participantes)
        : porPercentual(T, participantes);

  for (const p of partes) {
    if (p.centavos <= 0) {
      throw new BadRequestException('A parte de cada pessoa deve ser maior que zero.');
    }
  }

  const dosOutros = partes.reduce((s, p) => s + p.centavos, 0);
  if (dosOutros > T) {
    throw new BadRequestException('A soma das partes passou do valor da despesa.');
  }

  return {
    minhaParte: emReais(T - dosOutros),
    partes: partes.map((p) => ({
      personId: p.personId,
      amount: emReais(p.centavos),
      percent: p.percent,
    })),
  };
}

/** Em partes iguais entre mim e eles. O resto da divisão fica comigo. */
function igual(T: number, participantes: Participante[]) {
  const quantos = participantes.length + 1; // eles + eu
  const base = Math.floor(T / quantos);
  // Três centavos entre cinco pessoas não tem resposta: alguém ficaria com
  // zero. A mensagem diz o caso em vez de reclamar de uma "parte" que o
  // usuário nem digitou — neste modo ele só escolheu com quem dividir.
  if (base === 0) {
    throw new BadRequestException(
      `${(T / 100).toFixed(2).replace('.', ',')} não dá para dividir entre ${quantos} pessoas.`,
    );
  }
  return participantes.map((p) => ({ personId: p.personId, centavos: base, percent: null }));
}

function porValor(T: number, participantes: Participante[]) {
  return participantes.map((p) => {
    if (p.amount === undefined || p.amount === null) {
      throw new BadRequestException('Informe o valor da parte de cada pessoa.');
    }
    return { personId: p.personId, centavos: emCentavos(p.amount), percent: null };
  });
}

function porPercentual(T: number, participantes: Participante[]) {
  let soma = 0;
  const partes = participantes.map((p) => {
    if (p.percent === undefined || p.percent === null) {
      throw new BadRequestException('Informe o percentual da parte de cada pessoa.');
    }
    if (p.percent <= 0 || p.percent > 100) {
      throw new BadRequestException('O percentual deve ficar entre 0 e 100.');
    }
    soma += p.percent;
    // Arredonda a parte de cada um, e não o total: é o valor dela que vai
    // ser cobrado, então é ele que precisa ser um número de dinheiro.
    return { personId: p.personId, centavos: Math.round((T * p.percent) / 100), percent: p.percent };
  });
  if (soma > 100) {
    throw new BadRequestException('Os percentuais somam mais de 100%.');
  }
  return partes;
}

// ------------------------------------------------------------
// Saldo
// ------------------------------------------------------------

export interface DespesaParaSaldo {
  /** `true` quando o lançamento é meu (saiu da minha conta ou cartão). */
  euPaguei: boolean;
  /** Valor cheio da despesa. */
  total: number;
  /** A parte DESTA pessoa. */
  parteDela: number;
}

export interface AcertoParaSaldo {
  direction: 'RECEIVED' | 'PAID';
  amount: number;
}

/**
 * Quanto esta pessoa está me devendo. Positivo = tenho a receber dela;
 * negativo = devo a ela.
 *
 *   + parte dela no que EU paguei        (adiantei dinheiro dela)
 *   − minha parte no que ELA pagou       (ela adiantou dinheiro meu)
 *   − acertos recebidos dela             (ela já me pagou)
 *   + acertos pagos a ela                (eu já paguei)
 *
 * Este número não é gravado em lugar nenhum, de propósito: saldo guardado é
 * saldo que um dia sai do ar e ninguém percebe.
 */
export function saldoDaPessoa(despesas: DespesaParaSaldo[], acertos: AcertoParaSaldo[]): number {
  let centavos = 0;

  for (const d of despesas) {
    centavos += d.euPaguei
      ? emCentavos(d.parteDela)
      : // Ela pagou: o que eu devo é a MINHA parte, que é o que sobra do
        // total depois da parte dela (e das dos outros, se houver).
        -(emCentavos(d.total) - emCentavos(d.parteDela));
  }

  for (const a of acertos) {
    centavos += a.direction === 'RECEIVED' ? -emCentavos(a.amount) : emCentavos(a.amount);
  }

  return emReais(centavos);
}

// ------------------------------------------------------------
// Normalização
// ------------------------------------------------------------

/** As duas formas de uma despesa compartilhada, achatadas numa só, para a
 * tela não precisar saber qual delas está olhando.
 *
 * Quando o lançamento é meu, a verdade sobre valor, data e descrição está
 * NELE — não há cópia aqui que possa divergir. Quando quem pagou foi a
 * pessoa, não existe lançamento, e os campos vêm da própria despesa. */
export function normalizarDespesa(d: {
  id: string;
  transaction?: {
    amount: unknown;
    description: string | null;
    transactionDate: Date;
    categoryId: string;
  } | null;
  amount?: unknown;
  description?: string | null;
  expenseDate?: Date | null;
  categoryId?: string | null;
  paidByPersonId?: string | null;
  shares: { personId: string; amount: unknown; percent?: unknown }[];
}) {
  const euPaguei = Boolean(d.transaction);
  const total = Number(euPaguei ? d.transaction!.amount : d.amount ?? 0);
  const partes = d.shares.map((s) => ({
    personId: s.personId,
    amount: Number(s.amount),
    percent: s.percent === null || s.percent === undefined ? null : Number(s.percent),
  }));
  const dosOutros = partes.reduce((soma, p) => soma + emCentavos(p.amount), 0);

  return {
    id: d.id,
    euPaguei,
    paidByPersonId: d.paidByPersonId ?? null,
    total,
    minhaParte: emReais(emCentavos(total) - dosOutros),
    description: euPaguei ? d.transaction!.description : d.description ?? null,
    date: euPaguei ? d.transaction!.transactionDate : d.expenseDate ?? null,
    categoryId: euPaguei ? d.transaction!.categoryId : d.categoryId ?? null,
    partes,
  };
}
