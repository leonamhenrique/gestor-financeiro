// ============================================================
// conversa.service.ts
// ============================================================
// O que acontece entre a mensagem chegar e o lançamento existir.
//
// A regra que organiza tudo aqui: NADA é gravado antes de a pessoa confirmar.
// Uma leitura errada que vira lançamento calado é pior do que uma pergunta a
// mais — ela só aparece dias depois, num saldo que não fecha.
//
// A leitura da frase é a MESMA da tela (ver fala.js). Este arquivo só traduz
// o banco para o contexto que ela espera, escreve a resposta e, depois do
// "sim", chama o mesmo serviço de lançamento que o app chama.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransfersService } from '../transfers/transfers.service';
import {
  LinhaDeFatura,
  LinhaDeObjetivo,
  LinhaDoPlano,
  PlanoDoMes,
  RelatorioService,
} from '../relatorio/relatorio.service';
import { chaveDoMes, dia } from '../credit-cards/invoice-statement';
import { CategoriesService } from '../categories/categories.service';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { GoalsService } from '../goals/goals.service';
import { PeopleService } from '../shared-expenses/people.service';
import { SharedExpensesService } from '../shared-expenses/shared-expenses.service';
import { SharedSummaryService } from '../shared-expenses/shared-summary.service';
/* A divisão do resumo é feita pela MESMA função que o servidor usa para
 * gravar. Recalcular aqui — mesmo com a fórmula certa — daria dois números
 * para a mesma conta no dia em que o arredondamento mudasse de lado, e quem
 * confirmou um valor veria outro gravado. */
import {
  dividir,
  emCentavos,
  emReais,
  parcelarRateio,
  repartirEmParcelas,
  type Participante,
} from '../shared-expenses/shared-expense.utils';
import { WhatsappService } from './whatsapp.service';
import { MensagemRecebida } from './meta';
import { AudioService } from './audio.service';
import { Cupom, CupomService } from './cupom.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fala = require('../fala/fala.js');

/** Quanto tempo um rascunho espera pelo "sim". Curto: passado isso, a pessoa
 * já não lembra qual frase era, e confirmar no escuro é pior que refazer. */
const RASCUNHO_MINUTOS = 15;

/** Ids de mensagem já processados. A Meta reentrega quando o webhook demora a
 * responder, e sem isto a mesma frase viraria dois lançamentos. Na memória
 * porque o custo de errar é baixo (uma reentrega depois de um deploy) e
 * gravar id de mensagem seria guardar conversa, que este app não faz. */
const LEMBRAR_IDS = 500;

/** O fuso em que o app vive. O saldonline é brasileiro: as telas, a moeda, a
 * política, o CNPJ. Quando houver usuário fora daqui isto vira coluna no
 * cadastro — até lá, um fuso fixo é mais honesto que o do servidor. */
const FUSO = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

/**
 * Que dia é hoje para QUEM FALOU.
 *
 * O servidor do Render roda em UTC. Uma mensagem das 21h06 de 31 de outubro
 * chega lá como 00h06 de 1º de novembro, e o lançamento nascia com a data de
 * amanhã — sem ninguém notar, porque das 00h às 21h os dois fusos concordam.
 * Das 21h à meia-noite, todo lançamento caa no dia errado.
 *
 * Devolve um Date cujos componentes LOCAIS são a data brasileira, que é o que
 * `isoDate` e as contas de dia da leitura ("ontem", "dia 12") usam.
 */
export function diaDoUsuario(
  agora: Date = new Date(),
  fuso: string = FUSO,
): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const num = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  return new Date(num('year'), num('month') - 1, num('day'));
}

const SIM =
  /^(sim|s|ok|okay|confirmo?|confirmar|pode|pode lan[çc]ar|isso|claro|beleza|positivo|👍)$/i;
const NAO = /^(n[ãa]o|n|cancela(r)?|deixa|esquece|negativo)$/i;

/** "limite 5000", "limite de R$ 5.000,00", "limite de 5 mil" — o que vem
 * depois da palavra vai para o leitor de dinheiro da frase, que é o mesmo do
 * lançamento — e o "R$" vai JUNTO, porque é ele que faz aquele leitor
 * entender "5.000,00" como cinco mil em vez de cinco. A palavra "limite" é
 * obrigatória: sem ela, "1, 10 e 20" seria um cartão de limite vinte ou um
 * vencimento no dia 20. */
const RE_LIMITE = /limite\s*(?:de\s*)?((?:r\$\s*)?[\d.,]+)/i;

/**
 * O que a conversa responde.
 *
 * `confirmar` liga os botões Sim/Cancelar. Só a pergunta de confirmação tem
 * resposta fechada, e é justamente ela que não pode depender de a pessoa
 * digitar "sim" sem errar — um "aim" vira uma frase nova, que o app tenta ler
 * como lançamento. Digitar continua valendo: o botão é atalho, não substituto.
 */
export interface Resposta {
  texto: string;
  confirmar?: boolean;
}

/** Sem acento e em minúscula, do jeito que as duas perguntas comparam. */
function semAcento(texto: string): string {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * A frase é uma PERGUNTA de saldo, e não um lançamento?
 *
 * O guarda é o valor: pergunta não traz dinheiro. "Quanto tenho?" pergunta;
 * "gastei 30 no saldo do nubank" é gasto, mesmo com a palavra saldo dentro.
 * Sem isso, uma frase com as duas coisas responderia o saldo e engoliria o
 * lançamento em silêncio — e silêncio aqui é o defeito que mais custou caro
 * neste módulo.
 */
export function perguntaDeSaldo(texto: string, temValor: boolean): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  if (/\bsaldo\b|\bsaldos\b|quanto (eu )?tenho|quanto (eu )?sobra|quanto ha na conta/.test(t)) {
    return true;
  }

  // "Qual o VALOR que tenho em conta hoje?" é a mesma pergunta de "qual o
  // saldo", e o usuário a fez assim. Mas "valor" sozinho não serve de pista:
  // ele é a palavra mais comum de um lançamento ("valor 50 no mercado"), e
  // aparece também na pergunta da fatura e na do resultado.
  //
  // Por isso as três condições juntas. A da CONTA é a que faz o trabalho:
  // sem ela, "qual o valor que gastei esse mês" viraria saldo, e a pessoa
  // receberia os saldos no lugar do resultado. As perguntas de fatura e de
  // resultado já são testadas antes desta, então o que chega aqui com
  // "valor" e "conta" só pode ser isto.
  const pergunta = /\bqual\b|\bquanto\b|\bquanta\b/.test(t);
  const dinheiro = /\bvalor(es)?\b|\bdinheiro\b|\bgrana\b/.test(t);
  const conta = /\bcontas?\b|\bbancos?\b/.test(t);
  return pergunta && dinheiro && conta;
}

/**
 * A frase é uma pergunta sobre o RESULTADO de um mês?
 *
 * Saldo e resultado são perguntas diferentes, e confundi-las é dar o número
 * certo para a pergunta errada: saldo é quanto existe na conta HOJE; resultado
 * é o que entrou menos o que saiu NAQUELE MÊS, previstos incluídos. Quem
 * pergunta "qual meu resultado?" no fim do mês não quer o extrato do banco.
 *
 * O guarda do valor é o mesmo de `perguntaDeSaldo`, e pela mesma razão:
 * pergunta não traz dinheiro. A consequência conhecida é que "resultado de
 * 11/2026" é lido como lançamento, porque o 11 parece valor — e aí a resposta
 * mostra o que entendeu, que é o jeito de a pessoa ver o engano em vez de
 * sofrê-lo calada. Com o mês por nome ("resultado de novembro") não há
 * ambiguidade.
 */
export function perguntaDeResultado(texto: string, temValor: boolean): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  // As palavras do próprio rótulo da tela ("Resultado mês a mês"), mais as
  // duas formas que aparecem em conversa.
  if (/\bresultado\b|\bbalanco\b|fech(ei|amento) (o )?(do )?mes/.test(t)) return true;
  // "quanto gastei" sozinho poderia ser sobre uma categoria ou uma loja — só
  // vale como pergunta do mês quando o mês está na frase.
  return (
    /quanto (eu )?(gastei|gasto|recebi|entrou|saiu|sobrou)/.test(t) && temMesNaFrase(t)
  );
}

/**
 * A frase pergunta pelas MAIORES categorias do mês? Devolve 'EXPENSE',
 * 'INCOME' ou null.
 *
 * É a pergunta "em quê eu gastei mais", que na tela é o bloco "Maiores
 * despesas". Ela vem antes da pergunta de resultado na ordem de leitura,
 * porque "quanto gastei em outubro" e "onde mais gastei em outubro" dividem
 * quase todas as palavras — o que separa as duas é o superlativo, e quem o
 * tem é esta.
 *
 * O tipo sai do verbo: "gastei/despesas" é despesa, "recebi/receitas" é
 * receita. Sem verbo nenhum ("minhas maiores categorias"), despesa — que é
 * o que a pessoa quase sempre quer saber, e é o primeiro bloco da tela.
 */
export function perguntaDeMaiores(texto: string, temValor: boolean): 'EXPENSE' | 'INCOME' | null {
  if (temValor) return null;
  const t = semAcento(texto);

  const superlativo = /\bmaior(es)?\b|\bmais\b|\btop\b|\branking\b|\bprincipais\b/.test(t);
  if (!superlativo) return null;

  // "onde/com o que gastei mais", "maiores gastos", "gastei mais com o quê".
  const despesa = /\bgast(ei|o|os|ei)\b|\bdespesas?\b|\bgastei\b|\bcompras\b|\bsa[ií]das?\b/.test(t);
  const receita = /\breceitas?\b|\brecebi\b|\bganhei\b|\bentradas?\b|\bganhos?\b/.test(t);
  if (receita && !despesa) return 'INCOME';
  if (despesa) return 'EXPENSE';

  // Sem verbo, só vale com uma palavra que amarre a pergunta a categorias —
  // senão "qual o maior cartão" ou "meu maior saldo" cairiam aqui.
  if (/\bcategorias?\b/.test(t)) return 'EXPENSE';
  return null;
}

/**
 * A frase pergunta pelo PLANEJAMENTO — "quanto ainda posso gastar com
 * alimentação neste mês?"
 *
 * É uma quarta pergunta de mês, e a única que olha para a FRENTE: as outras
 * três contam o que já aconteceu (saldo, resultado, maiores), e esta compara
 * o que aconteceu com o que a pessoa se propôs. Sem planejamento salvo ela
 * não tem resposta possível — e dizer isso é a resposta.
 *
 * Dois caminhos, e o segundo é o que importa:
 *
 *   1. o vocabulário da tela — meta, planejamento, teto, orçamento;
 *   2. "quanto" + o verbo no INFINITIVO ("gastar"), que é o que separa esta
 *      pergunta das outras. "Quanto gastei" é passado e é resultado; "quanto
 *      posso gastar" é o que ainda cabe. Nenhum lançamento diz "gastar".
 *
 * Ela é lida ANTES de resultado e de saldo porque as frases se encostam:
 * "quanto ainda tenho para gastar com alimentação" casa com `quanto tenho` da
 * pergunta de saldo, e "quanto gastei da meta de alimentação esse mês" casa
 * com a de resultado. Nos dois casos a pessoa receberia um número certo para
 * a pergunta errada — o engano que mais parece acerto.
 *
 * Fica DEPOIS da de fatura, de propósito: "quanto ainda posso gastar na
 * fatura do Nubank" é pergunta de cartão, e o limite da fatura não é o teto
 * do mês.
 *
 * O preço de ler "meta" como planejamento: quem tem um objetivo de poupança
 * ("minha meta da viagem") recebe o planejamento do mês. A resposta começa
 * dizendo o que ela é, então o engano aparece na primeira linha em vez de
 * virar um número sem procedência.
 */
/**
 * A frase pergunta pelos OBJETIVOS — "quanto tenho guardado nos meus
 * objetivos hoje?"
 *
 * Ela é lida antes de todas as outras de consulta, e isso resolve dois
 * encontros que já existiam:
 *
 *   - **saldo**: "quanto tenho guardado" casa com o `quanto tenho` da
 *     pergunta de saldo, e a pessoa recebia o saldo das contas com UMA linha
 *     de objetivos dentro — o número certo para outra pergunta, e sem o
 *     quanto falta, o prazo, ou um objetivo sequer nomeado;
 *   - **planejamento**: "minha meta da viagem" é objetivo, não teto do mês.
 *     Quem nomeia objetivo está falando de objetivo, mesmo usando a palavra
 *     meta — que nos dois lugares quer dizer coisas diferentes.
 *
 * "Poupança" ficou DE FORA das palavras-pista de propósito: ela é um tipo de
 * conta no app ("conta poupança"), e "quanto tenho na poupança" é pergunta
 * de saldo.
 */
/**
 * A frase pergunta pela DÍVIDA de alguém — "quanto a Ana me deve?".
 *
 * Ela é lida antes da pergunta de saldo, e isso conserta um engano medido:
 * "qual o saldo com a Ana" casava com `perguntaDeSaldo` e respondia o saldo
 * das CONTAS. Número certo para a pergunta errada, que é o defeito que mais
 * parece acerto.
 *
 * Fica depois da fatura de propósito: "quanto devo da fatura do Nubank" é
 * pergunta de fatura, e a palavra "devo" aparece nas duas.
 */
export function perguntaDeDivida(
  texto: string,
  temValor: boolean,
  nomeouPessoa = false,
): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  if (/\bdev[eo]\b|\bdevem\b|\bdevendo\b|\bdevia\b|\bdividas?\b|\bquites?\b/.test(t)) return true;
  // "Minhas compartilhadas de novembro", "o que rachei este mês".
  if (/\bcompartilhad[ao]s?\b|\brachei\b|\brachamos\b/.test(t)) return true;
  /* E o caso que motivou esta pergunta existir: "qual o SALDO COM A ANA"
   * não tem nenhuma palavra de dívida, casa com `perguntaDeSaldo` e
   * respondia o saldo das contas. Nomear uma pessoa muda a pergunta — saldo
   * com alguém é a conta entre vocês dois, não o dinheiro no banco. */
  return nomeouPessoa && perguntaDeSaldo(texto, temValor);
}

export function perguntaDeObjetivos(texto: string, temValor: boolean): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  if (/\bobjetivos?\b/.test(t)) return true;
  return /\bguardad[oa]s?\b|\bguardei\b|\bguardo\b|\bpoupad[oa]s?\b|\bpoupei\b|\breserva\b|\bcofrinho\b/.test(t);
}

/** Teto do valor, o mesmo do formulário (ver `dto/goal.dto.ts`): não é
 * limite de produto, é barreira contra dedo escorregado. */
const TETO_OBJETIVO = 99999999.99;

/**
 * Os verbos que pedem um objetivo NOVO.
 *
 * "Adicionar", "incluir" e "abrir" ficaram de fora de propósito: "adiciona
 * 500 no objetivo viagem" é aplicação, não cadastro, e um verbo ambíguo aqui
 * roubaria a frase de quem está guardando dinheiro — ver `OBJETIVO_ENTRA` no
 * fala.js, que é quem lê aquela outra.
 */
const RE_CRIAR_OBJETIVO = /\b(criar|cria|crie|criando|cadastrar|cadastra|cadastre|montar|monta|monte)\b/i;

/** O pedido sem verbo: "novo objetivo", "outro objetivo", "objetivo novo". */
const RE_OBJETIVO_NOVO = /\b(nov[oa]|outr[oa])\s+objetivo\b|\bobjetivo\s+nov[oa]\b/;

/** Palavra de pergunta na ABERTURA da frase. Quem pergunta não está pedindo
 * cadastro: "quanto preciso guardar para criar o objetivo da viagem" é
 * consulta, e cairia aqui por causa do "criar". */
const RE_PERGUNTANDO = /^\W*(quanto|quanta|qual|quais|como|quando|onde|porque|por que)\b/;

/** Onde o NOME acaba: o dinheiro, o prazo, ou a vírgula que separa um do
 * outro. Um nome com número dentro ("objetivo iPhone 15") é cortado no
 * número — e é por isso que o resumo mostra o nome antes do "Criar?", em vez
 * de criar calado algo que a pessoa não disse.
 *
 * O `(?![a-z])` depois de "até" não é enfeite, e `\b` ali estaria errado: a
 * borda de palavra do JavaScript só conhece [A-Za-z0-9_], então depois do "é"
 * de "até" ela não existe. Com `\b`, "Carro até 31/12/2027" era cortado no
 * número e o objetivo nascia chamado "Carro até". */
const FIM_DO_NOME = /\bat[eé](?![a-z])|R\$|\d|,|;|\bprazo\b|\breais?\b|\bmil\b/i;

/** O mês como marco de prazo dentro da frase, do jeito que a tela o escreve
 * (com acento) e do jeito que se digita no telefone (sem). */
const RE_MES_NO_NOME = new RegExp(
  '\\b(' +
    (fala.MESES as string[])
      .concat((fala.MESES as string[]).map((m) => semAcento(m)))
      .join('|') +
    ')\\b',
  'i',
);

/** Recheio que vem ANTES do nome e não é o nome: "um objetivo CHAMADO
 * viagem", "objetivo PARA A viagem". */
const RECHEIO_ANTES =
  /^(?:\W*\b(?:chamad[oa]|nomead[oa]|nome|de|do|da|dos|das|para|pra|pro|com|o|a|os|as|um|uma|meu|minha|nov[oa]|outr[oa]|que|e|em|no|na)\b)+/i;

/** E o que sobra DEPOIS, quando o corte caiu no meio de uma preposição:
 * "casa de praia de 200000" corta no número e deixa "casa de praia de". */
const RECHEIO_DEPOIS = /(?:\s*\b(?:de|do|da|para|pra|com|e|em|no|na|que)\b\W*)+$/i;

/**
 * A pontuação em volta do nome. Quem escreve "criar objetivo. Comprar carro"
 * está separando a frase, e não batizando um objetivo chamado ". Comprar
 * carro" — que foi o nome que nasceu no primeiro uso de verdade.
 *
 * A lista é escrita à mão, e `\W` seria o atalho errado: para o JavaScript,
 * "Ó" e "Á" não são letras, e um objetivo chamado "Ótica" ou "Água" perderia
 * a primeira letra.
 */
const PONTUACAO_EM_VOLTA =
  /^[\s.,;:!?"'()[\]{}<>|*_+=~^—–-]+|[\s.,;:!?"'()[\]{}<>|*_+=~^—–-]+$/g;

/**
 * A frase PEDE para criar um objetivo?
 *
 * Esta é lida antes de todas as outras — antes da pergunta dos objetivos, que
 * devolveria a lista para quem quer criar, e antes da leitura do lançamento,
 * que lia "criar objetivo viagem de 6000 até dezembro" como uma DESPESA de
 * R$ 6.000,00 chamada "Criar objetivo viagem". Era o pior dos dois: a pessoa
 * pedia um objetivo e recebia um rascunho de gasto.
 *
 * A palavra "objetivo" é obrigatória. "Meta" não serve: no app ela é o teto
 * do mês, no planejamento, e quem diz "criar uma meta de 600 para alimentação"
 * está falando daquela outra tela — ver `perguntaDeMeta`.
 */
export function pedidoDeCriarObjetivo(texto: string): boolean {
  const t = semAcento(texto);
  if (!/\bobjetivos?\b/.test(t)) return false;
  if (RE_PERGUNTANDO.test(t)) return false;
  return RE_CRIAR_OBJETIVO.test(t) || RE_OBJETIVO_NOVO.test(t);
}

/**
 * O nome dito, com os acentos e as maiúsculas de quem escreveu — é ele que
 * vai ficar no cadastro, e "viagem para a europa" em caixa baixa seria o app
 * reescrevendo o que a pessoa nomeou.
 *
 * Depois da palavra "objetivo" é onde o nome está, quando ela aparece. Sem
 * ela (a resposta a "qual o nome?"), a frase inteira é o nome.
 */
export function nomeDoObjetivoDito(texto: string): string {
  const cru = /\bobjetivos?\b/i.test(texto)
    ? texto.replace(/^[\s\S]*?\bobjetivos?\b/i, '')
    : texto.replace(RE_CRIAR_OBJETIVO, ' ');
  let nome = cru;
  for (const marca of [FIM_DO_NOME, RE_MES_NO_NOME]) {
    const i = nome.search(marca);
    if (i >= 0) nome = nome.slice(0, i);
  }
  /* Até parar de encolher: pontuação e recheio se alternam ("objetivo: para a
   * viagem"), e uma passada só de cada deixaria metade para trás. Termina
   * sempre, porque cada volta só tira caracteres. */
  let antes = '';
  while (antes !== nome) {
    antes = nome;
    nome = nome
      .replace(PONTUACAO_EM_VOLTA, '')
      .replace(RECHEIO_ANTES, '')
      .replace(RECHEIO_DEPOIS, '');
  }
  return nome.trim();
}

/**
 * O PRAZO dito, em 'AAAA-MM-DD'. Devolve também o trecho que o disse, porque
 * ele precisa sair do texto antes de o dinheiro ser procurado.
 *
 * Mês sem ano é o próximo mês com aquele nome, e não "o mais recente" como
 * nas perguntas (ver `mesDaPergunta`): prazo de objetivo é sempre para a
 * frente. E mês dito é o FIM do mês — quem diz "até dezembro" tem dezembro
 * inteiro, não o dia 1º.
 */
export function prazoDoObjetivo(
  texto: string,
  hoje: Date,
): { iso: string; trecho: string } | null {
  const t = semAcento(texto);
  const fimDoMes = (y: number, m: number) => fala.isoDate(new Date(y, m + 1, 0));

  // 31/12/2027, 31-12-2027, 31/12/27
  let m = t.match(/\b(0?[1-9]|[12]\d|3[01])[/-](0?[1-9]|1[0-2])(?:[/-](\d{2}|\d{4}))?\b/);
  if (m) {
    const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : hoje.getFullYear();
    const d = new Date(ano, Number(m[2]) - 1, Number(m[1]));
    /* 31/02 existe como frase e não como dia: o Date rolaria para março, e o
     * prazo sairia três dias depois do que a pessoa leu na própria mensagem. */
    if (d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1])) {
      return { iso: fala.isoDate(d), trecho: m[0] };
    }
    return null;
  }

  // 12/2027 e 2027-12: o mês inteiro.
  m = t.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/);
  if (m) return { iso: fimDoMes(Number(m[2]), Number(m[1]) - 1), trecho: m[0] };
  m = t.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (m) return { iso: fimDoMes(Number(m[1]), Number(m[2]) - 1), trecho: m[0] };

  // "em 18 meses", "daqui a 2 anos".
  m = t.match(/\b(\d{1,3})\s*(mes|meses|ano|anos)\b/);
  if (m) {
    const n = Number(m[1]) * (/ano/.test(m[2]) ? 12 : 1);
    const alvo = new Date(hoje.getFullYear(), hoje.getMonth() + n, 1);
    const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
    alvo.setDate(Math.min(hoje.getDate(), ultimo));
    return { iso: fala.isoDate(alvo), trecho: m[0] };
  }

  if (/\b(fim|final)\s+d[eo]\s+ano\b/.test(t)) {
    return { iso: fimDoMes(hoje.getFullYear(), 11), trecho: 'ano' };
  }

  // "dezembro", "dezembro de 2027".
  for (const palavra of t.split(/[^a-z0-9]+/)) {
    const mes = fala.mesPorNome(palavra);
    if (mes < 0) continue;
    const ano = t.match(/\b(20\d{2})\b/);
    if (ano) return { iso: fimDoMes(Number(ano[1]), mes), trecho: palavra };
    // O mês que já passou neste ano é o do ano que vem.
    const y = hoje.getFullYear() + (mes < hoje.getMonth() ? 1 : 0);
    return { iso: fimDoMes(y, mes), trecho: palavra };
  }
  return null;
}

/** O que um objetivo precisa, do jeito que a frase trouxer. O que faltar vem
 * vazio, e quem pergunta é a conversa. */
export interface ObjetivoNovo {
  nome?: string;
  valor?: number;
  prazo?: string;
}

export function partesDoObjetivo(texto: string, hoje: Date): ObjetivoNovo {
  const prazo = prazoDoObjetivo(texto, hoje);
  /* O prazo SAI do texto antes de o dinheiro ser procurado: em "até
   * 31/12/2027" o leitor de valor acharia 31 — um número solto que, para ele,
   * não é ano nem dia do mês —, e a meta nasceria de R$ 31,00. */
  const semOPrazo = prazo ? semAcento(texto).replace(prazo.trecho, ' ') : semAcento(texto);
  const valor = fala.valorDaFala(fala.normalizarFala(semOPrazo));
  const nome = nomeDoObjetivoDito(texto);
  return {
    nome: nome || undefined,
    valor: valor && valor > 0 ? valor : undefined,
    prazo: prazo ? prazo.iso : undefined,
  };
}

/** As três informações na mão. Enquanto falta uma, o rascunho está esperando
 * uma RESPOSTA, e não um "sim" — e é essa diferença que faz "6000" ser lido
 * como a meta em vez de virar uma despesa. */
function objetivoCompleto(n: ObjetivoNovo): boolean {
  return !!(n.nome && n.valor && n.prazo);
}

export function perguntaDeMeta(texto: string, temValor: boolean): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  if (/\bmetas?\b|\bplanejamento\b|\bplanejad[ao]s?\b|\bplanejei\b|\borcamento\b|\bteto\b/.test(t)) {
    return true;
  }
  return /\bquant[oa]\b/.test(t) && /\bgastar\b/.test(t);
}

/**
 * A frase PEDE um regime? Devolve 'compra', 'fatura' ou null.
 *
 * Serve para olhar o mês pelo outro regime sem trocar a preferência: "qual
 * meu resultado nesse mês pela data da compra" responde por competência e vai
 * embora, deixando a escolha das Configurações onde estava. Trocar uma
 * preferência porque alguém fez uma pergunta seria mudar TODAS as telas da
 * pessoa por causa de uma consulta — e ela descobriria dias depois, pelos
 * números que mudaram sozinhos.
 *
 * Só a forma "pela/por" conta. "Das minhas faturas" fala das faturas em si,
 * que é outra pergunta (ver `perguntaDeFatura`), e não um jeito de contar.
 */
export function regimeDaPergunta(texto: string): 'compra' | 'fatura' | null {
  const t = semAcento(texto);
  // Só "pela/por": "na compra do mercado" é onde se gastou, e não um jeito
  // de contar. Era falso positivo em "quanto gastei esse mes na compra...".
  if (/(pel[ao]|por) (data da )?compra\b|data (da|de) compra|data do lancamento|competencia/.test(t)) {
    return 'compra';
  }
  if (/(pel[ao]|por) fatura|pelo vencimento|data (de|do) vencimento|regime de caixa/.test(t)) {
    return 'fatura';
  }
  return null;
}

/**
 * A frase é uma pergunta sobre FATURA?
 *
 * "Qual o valor das minhas faturas em novembro" não é o resultado do mês nem
 * o saldo: é quanto o cartão vai cobrar da conta. São três perguntas
 * vizinhas e três números diferentes, e dar o número certo para a pergunta
 * errada é o engano que mais parece acerto.
 *
 * Esta é testada ANTES da de resultado: quem nomeia a fatura está perguntando
 * da fatura, mesmo que use a palavra "resultado" na mesma frase.
 */
export function perguntaDeFatura(texto: string, temValor: boolean): boolean {
  if (temValor) return false;
  const t = semAcento(texto);
  if (!/\bfatura\b|\bfaturas\b/.test(t)) return false;
  // "qual meu resultado nesse mês PELA FATURA" nomeia a fatura como jeito de
  // contar, e não como assunto: quem pede um regime está pedindo o resultado
  // por ele. Sem esta linha, a palavra "fatura" sequestrava a pergunta e a
  // pessoa recebia a lista de faturas em vez do resultado do mês.
  if (perguntaDeResultado(texto, temValor) && regimeDaPergunta(texto)) return false;
  // "gastei na fatura de dezembro" sem valor nenhum ainda é tentativa de
  // lançamento, e não pergunta: o verbo de gasto manda.
  return !/\b(gastei|gasto|paguei|comprei|lancei|lanca|recebi)\b/.test(t);
}

/** A frase aponta algum mês? "esse mes", "mes passado", "em outubro". */
function temMesNaFrase(t: string): boolean {
  if (/\bmes\b|\bmeses\b/.test(t)) return true;
  return t.split(/[^a-z0-9]+/).some((w) => fala.mesPorNome(w) >= 0);
}

/**
 * De que mês a pergunta fala. Devolve 'AAAA-MM'.
 *
 * Sem mês dito, é o mês corrente — o mesmo padrão da tela, que abre no mês de
 * hoje. "Mês passado" e "mês que vem" andam um para cada lado.
 *
 * Mês dito por nome sem ano é o caso ambíguo: "janeiro", em novembro, pode ser
 * o janeiro que passou ou o que vem. A regra é "o mais recente, aceitando um
 * mês à frente": dezembro perguntado em novembro é o próximo (previsto, que a
 * tela também mostra), janeiro perguntado em novembro é o deste ano, que já
 * passou. Qualquer que seja a escolha, a resposta DIZ o mês e o ano — é isso
 * que deixa a pessoa corrigir em vez de acreditar.
 */
export function mesDaPergunta(texto: string, hoje: Date): string {
  const t = semAcento(texto);
  const chave = (y: number, m: number) =>
    y + '-' + String(m + 1).padStart(2, '0');
  const andar = (n: number) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + n, 1);
    return chave(d.getFullYear(), d.getMonth());
  };

  if (/mes (passado|anterior|retrasado)|mes que passou/.test(t)) {
    return andar(/retrasado/.test(t) ? -2 : -1);
  }
  if (/mes que vem|proximo mes|mes seguinte/.test(t)) return andar(1);

  // "10/2026" e "2026-10" ditos por extenso na mensagem.
  const barra = t.match(/\b(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/);
  if (barra) return chave(Number(barra[2]), Number(barra[1]) - 1);
  const iso = t.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) return chave(Number(iso[1]), Number(iso[2]) - 1);

  for (const palavra of t.split(/[^a-z0-9]+/)) {
    const m = fala.mesPorNome(palavra);
    if (m < 0) continue;
    const ano = t.match(/\b(20\d{2})\b/);
    if (ano) return chave(Number(ano[1]), m);
    const atual = hoje.getFullYear() * 12 + hoje.getMonth();
    const candidato = hoje.getFullYear() * 12 + m;
    // Mais de um mês à frente é passado: é o ano anterior que ela quis dizer.
    return candidato > atual + 1 ? chave(hoje.getFullYear() - 1, m) : chave(hoje.getFullYear(), m);
  }
  return andar(0);
}

interface Rascunho {
  lancamento: any;
  criadoEm: number;
  /** A categoria que o "sim" cria antes de lançar. Fica no rascunho, e não
   * gravada na hora da leitura, porque nada nasce nesta conversa sem a pessoa
   * confirmar — nem lançamento, nem categoria. */
  categoriaNova?: { nome: string; tipo: string };
  /** A conta que o "sim" cria antes de lançar, pela mesma razão. */
  contaNova?: { nome: string };
  /** O cartão por criar. Diferente dos outros dois, ele pode ficar aqui
   * INCOMPLETO: sem os dias do ciclo, o rascunho está esperando a resposta
   * com eles, e não um "sim". */
  cartaoNovo?: { nome: string; fechamento?: number; vencimento?: number; limite?: number };
  /** O objetivo por nascer. Como o cartão, ele pode ficar aqui INCOMPLETO:
   * faltando o nome, o valor ou o prazo, o rascunho espera a resposta com a
   * parte que falta. Diferente de todos os outros, ele vem SEM lançamento
   * nenhum atrás — criar um objetivo não é lançar nada. */
  objetivoNovo?: ObjetivoNovo;
}

@Injectable()
export class ConversaService {
  private readonly log = new Logger('WhatsApp');
  private readonly rascunhos = new Map<string, Rascunho>();
  private readonly processadas: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly transfers: TransfersService,
    private readonly whatsapp: WhatsappService,
    private readonly audio: AudioService,
    private readonly cupom: CupomService,
    private readonly relatorio: RelatorioService,
    private readonly categorias: CategoriesService,
    private readonly contas: BankAccountsService,
    private readonly cartoes: CreditCardsService,
    // Aplicar e resgatar passam pelo serviço de objetivos, e não por uma
    // escrita própria: é ele que trava o resgate no guardado e que mexe no
    // saldo da conta dentro da mesma transação.
    private readonly goals: GoalsService,
    // A despesa dividida nasce pela porta do formulário: é ela que cria o
    // lançamento e a divisão na mesma transação de banco.
    private readonly pessoas: PeopleService,
    private readonly divididas: SharedExpensesService,
    // Quem soma a conta entre duas pessoas. A mesma do topo da tela de
    // Compartilhadas — a dívida não se recalcula aqui.
    private readonly contaEntreNos: SharedSummaryService,
  ) {}

  /** Devolve o texto da resposta, ou `null` quando não há o que responder.
   * Quem manda a resposta é o controlador — assim este serviço inteiro é
   * testável sem rede. */
  async responderA(m: MensagemRecebida): Promise<Resposta | null> {
    if (this.jaProcessada(m.id)) return null;
    this.marcarProcessada(m.id);

    const userId = await this.whatsapp.donoDoTelefone(m.de);
    if (!userId) return this.semVinculo(m);

    await this.whatsapp.registrarUso(userId);

    // Áudio vira texto e segue pelo MESMO caminho da frase digitada. Nada
    // abaixo daqui sabe se a pessoa falou ou escreveu — e é isso que faz o
    // recado de voz responder igualzinho ao que ela veria no app.
    if (m.audioId) {
      if (!this.audio.disponivel()) {
        return {
          texto:
            'Ainda não escuto áudio por aqui. ' +
            'Escreva a frase: "gastei 40 no mercado pelo débito".',
        };
      }
      const ouvido = await this.audio.ouvir(m.audioId);
      if (!ouvido) {
        return {
          texto:
            'Não consegui entender o áudio. Mande de novo, mais perto do microfone, ou escreva a frase.',
        };
      }
      // O que foi ouvido vem ANTES do resumo, sempre. Metade dos enganos de
      // voz é o transcritor trocando uma palavra, e a pessoa só descobre se
      // a resposta disser o que ele achou que ouviu.
      const resposta = await this.lerFrase(userId, ouvido);
      if (!resposta) return null;
      return {
        ...resposta,
        texto: 'Ouvi: “' + ouvido + '”\n\n' + resposta.texto,
      };
    }

    if (m.imagemId) return this.lerCupom(userId, m.imagemId, (m.texto || '').trim());

    const texto = (m.texto || '').trim();
    if (!texto) return null;
    return this.lerFrase(userId, texto);
  }

  /**
   * A foto de um cupom, com a legenda dizendo onde lançar.
   *
   * **Duas fontes, sem sobreposição**, e é isso que mantém uma regra só no
   * app: o CUPOM diz valor, data, parcelas e estabelecimento; a LEGENDA diz
   * destino e, se a pessoa quiser, categoria. A legenda passa pelo mesmo
   * leitor de frase de sempre.
   *
   * O nome da loja NÃO entra no texto lido pelo leitor, e isso é deliberado:
   * ele procura conta, cartão e categoria por nome dentro da frase, e um
   * cupom de uma loja chamada "Itaú Supermercados" mandaria o lançamento
   * para a conta errada — calado. O estabelecimento só vira descrição, e é
   * dela que sai a regra de lojista, pela mesma chamada que o formulário
   * digitado faz.
   */
  private async lerCupom(
    userId: string,
    imagemId: string,
    legenda: string,
  ): Promise<Resposta | null> {
    if (!this.cupom.disponivel()) {
      return {
        texto:
          'Ainda não leio foto por aqui. ' +
          'Escreva a frase: "gastei 182,94 no mercado no crédito do nubank".',
      };
    }

    const ctx = await this.contextoDoUsuario(userId);
    if (!ctx.contas.length && !ctx.cartoes.length) {
      return { texto: 'Antes de lançar por aqui, cadastre uma conta ou um cartão no app.' };
    }

    const lido = await this.cupom.ler(imagemId);
    if (!lido) {
      return {
        texto:
          'Não consegui ler esse cupom. Mande a foto mais de perto e sem dobras, ' +
          'ou escreva a frase: "gastei 182,94 no mercado no crédito do nubank".',
      };
    }

    const r = this.juntarCupomComLegenda(lido, legenda, ctx);

    const contaDoCupom = this.ofereceCriarConta(userId, r, ctx);
    if (contaDoCupom) return contaDoCupom;

    const criarDoCupom = this.ofereceCriarCategoria(userId, r, ctx);
    if (criarDoCupom) return criarDoCupom;

    if (r.faltando.length) {
      const nomes = r.faltando.includes('destino') ? ' ' + this.nomesDeDestino(ctx) : '';
      const categorias = r.faltando.includes('categoria')
        ? ' ' + this.ajudaDeCategoria(legenda, r.tipo, ctx)
        : '';
      return {
        texto:
          this.resumo(r, ctx) +
          '\n\nLi o cupom, mas faltou ' +
          r.faltando.join(', ') +
          '.' +
          nomes +
          categorias +
          ' Responda com essa parte, ou lance no app.',
      };
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return { texto: this.resumo(r, ctx) + '\n\nConfirma?', confirmar: true };
  }

  /**
   * O lançamento que nasce do cupom mais a legenda.
   *
   * As contas que o leitor de frase faria, feitas aqui com as MESMAS funções
   * dele (ver `fala.js`): a fatura sugerida pela data da compra, a regra de
   * lojista pela descrição e o rateio da parcela. O que não é dele é a
   * decisão de onde cada campo vem — e essa é a razão deste método existir.
   */
  private juntarCupomComLegenda(cupom: Cupom, legenda: string, ctx: any): any {
    // A legenda pode ser vazia: o leitor devolve o esqueleto com destino e
    // categoria faltando, que é exatamente o que a resposta vai perguntar.
    const r = fala.interpretarFala(legenda, ctx);

    // Cupom é compra: nunca receita, e nunca transferência.
    r.tipo = 'EXPENSE';
    r.transferencia = false;

    r.valor = cupom.valor;
    if (cupom.parcelas >= 2) {
      r.parcelas = cupom.parcelas;
      r.valor = Math.round((cupom.valor * 100) / cupom.parcelas) / 100;
      r.valorTotal = Math.round(r.valor * cupom.parcelas * 100) / 100;
      // O mesmo aviso do centavo da frase falada: parcelas iguais nem sempre
      // somam o total do cupom.
      if (r.valorTotal !== cupom.valor) r.valorDito = cupom.valor;
    }

    if (cupom.data) r.data = cupom.data;

    // A descrição da legenda ganha: quem escreveu "almoço do time" quis isso.
    if (!r.desc && cupom.estabelecimento) r.desc = cupom.estabelecimento;

    // A categoria aprendida do lojista, quando a legenda não disse — a mesma
    // consulta que o formulário digitado faz, com a mesma guarda de tipo.
    if (!r.categoriaId && r.desc) {
      const regra = fala.regraParaDigitado(ctx.regras, r.desc);
      const daRegra = regra ? fala.byId(ctx.categorias, regra.categoriaId) : null;
      const serve =
        daRegra &&
        fala
          .categoriasLancaveis(r.tipo, ctx.categorias)
          .some((c: any) => c.id === daRegra.id);
      if (serve) {
        r.categoriaId = daRegra.id;
        r.categoriaDoLojista = true;
      }
    }

    // A fatura segue a data do CUPOM, e não a do dia em que a foto chegou:
    // recalculada aqui porque o leitor a calculou com a data da legenda.
    const cartao = r.cartaoId ? fala.byId(ctx.cartoes, r.cartaoId) : null;
    r.faturaMes = cartao && cartao.fechamento ? fala.monthKey(fala.faturaSugerida(r.data, cartao)) : null;

    // Cupom na mão é compra feita: nasce confirmada, como a compra no cartão
    // no leitor de frase.
    r.confirmada = true;

    // O que falta, recontado depois da junção — a lista do leitor foi feita
    // só com a legenda, quando o valor ainda não existia.
    r.faltando = [];
    if (!r.valor) r.faltando.push('valor');
    if (!r.contaId && !r.cartaoId) r.faltando.push('destino');
    if (!r.categoriaId) r.faltando.push('categoria');
    return r;
  }

  /** Daqui para baixo tanto faz se a frase foi falada ou digitada. */
  private async lerFrase(
    userId: string,
    texto: string,
  ): Promise<Resposta | null> {
    const rascunho = this.rascunhoDe(userId);

    // O rascunho pode estar esperando os dois dias do ciclo, e não um "sim".
    // Esta resposta vem antes de qualquer leitura: "1 e 10" é uma frase que
    // o leitor de lançamento entenderia como valor, e responderia bobagem.
    if (rascunho?.cartaoNovo && !rascunho.cartaoNovo.fechamento) {
      return this.lerDiasDoCiclo(userId, rascunho, texto);
    }

    // E pode estar esperando o nome, o valor ou o prazo de um objetivo. Mesma
    // razão dos dias do cartão: "6000", lido como frase nova, viraria uma
    // despesa de seis mil reais sem destino nem categoria.
    if (rascunho?.objetivoNovo && !objetivoCompleto(rascunho.objetivoNovo)) {
      return this.lerFaltaDoObjetivo(userId, rascunho, texto);
    }

    if (rascunho && SIM.test(texto)) return this.gravar(userId, rascunho);
    if (rascunho && NAO.test(texto)) {
      this.rascunhos.delete(userId);
      // O que se desistiu de fazer, dito pelo nome: "não lancei nada" depois
      // de desistir de um objetivo manda a pessoa procurar um lançamento que
      // nunca existiu.
      return {
        texto: rascunho.objetivoNovo ? 'Ok, não criei o objetivo.' : 'Ok, não lancei nada.',
      };
    }

    const ctx = await this.contextoDoUsuario(userId);

    /* Criar objetivo vem antes de TUDO, inclusive da trava de "cadastre uma
     * conta ou um cartão": objetivo não precisa de nenhum dos dois para
     * existir — a conta entra na hora de aplicar —, e mandar embora quem
     * acabou de instalar o app e quer começar a guardar dinheiro seria
     * fechar a porta no único lugar onde ela estava aberta. */
    if (pedidoDeCriarObjetivo(texto)) {
      return this.lerPedidoDeObjetivo(userId, texto, ctx);
    }

    if (!ctx.contas.length && !ctx.cartoes.length) {
      return {
        texto:
          'Antes de lançar por aqui, cadastre uma conta ou um cartão no app.',
      };
    }

    // As perguntas vêm ANTES da leitura do lançamento: lida como lançamento,
    // "qual meu saldo" responderia "faltou valor, destino, categoria" — o
    // app tratando uma pergunta como um formulário mal preenchido.
    const temValor = !!fala.valorDaFala(fala.normalizarFala(texto));

    // Resultado antes de saldo, porque as duas se encostam numa palavra:
    // "quanto sobrou?" é saldo, mas "quanto sobrou ESSE MÊS?" é resultado. A
    // de resultado só reclama de "quanto sobrou" quando há mês na frase, então
    // deixá-la perguntar primeiro resolve o encontro sem tirar nada da outra.
    if (perguntaDeFatura(texto, temValor)) {
      return { texto: await this.responderFaturas(userId, texto, ctx) };
    }
    /* A DÍVIDA vem antes do saldo: "qual o saldo com a Ana" respondia o
     * saldo das contas — ver `perguntaDeDivida`. */
    /* O texto vai NORMALIZADO para a busca: `acharPorNome` compara com o
     * nome sem acento e em minúscula, e "a Ana" com maiúscula não casava —
     * a pergunta voltava para o saldo das contas. */
    const nomeouPessoa = !!fala.acharPorNome(ctx.pessoas || [], fala.normalizarFala(texto));
    if (perguntaDeDivida(texto, temValor, nomeouPessoa)) {
      return { texto: await this.responderDivida(userId, texto, ctx) };
    }
    // Os OBJETIVOS vêm na frente das outras consultas: "quanto tenho
    // guardado" caía no saldo, e "minha meta da viagem" cairia no
    // planejamento. Ver `perguntaDeObjetivos`.
    if (perguntaDeObjetivos(texto, temValor)) {
      return { texto: await this.responderObjetivos(userId) };
    }
    // O PLANEJAMENTO vem antes das três contas do passado: ele é a única
    // pergunta que olha para a frente, e as frases dela caem nas outras —
    // "quanto ainda tenho para gastar" seria saldo, "quanto gastei da meta
    // esse mês" seria resultado. Ver `perguntaDeMeta`.
    if (perguntaDeMeta(texto, temValor)) {
      return { texto: await this.responderMeta(userId, texto, ctx) };
    }
    // As MAIORES vêm antes do resultado: "quanto gastei em outubro" e "onde
    // mais gastei em outubro" dividem quase todas as palavras, e o que separa
    // as duas é o superlativo. Quem tem o superlativo é esta.
    const maiores = perguntaDeMaiores(texto, temValor);
    if (maiores) {
      return { texto: await this.responderMaiores(userId, texto, maiores) };
    }
    if (perguntaDeResultado(texto, temValor)) {
      return { texto: await this.responderResultado(userId, texto) };
    }
    if (perguntaDeSaldo(texto, temValor)) {
      return { texto: await this.responderSaldo(userId, ctx) };
    }

    const r = fala.interpretarFala(texto, ctx);

    // Transferência segue por outro ramo porque é outra coisa: não tem
    // categoria, não tem cartão, e o que importa é a DIREÇÃO. O resto do
    // caminho é o mesmo — resumo, "sim", grava.
    if (r.transferencia) return this.lerTransferencia(userId, r, ctx);

    // Aplicar e resgatar num objetivo: outro caminho pelo mesmo motivo da
    // transferência — não tem categoria, não tem cartão, e o dinheiro só
    // muda de lugar.
    if (r.objetivo) return this.lerMovimentoDeObjetivo(userId, r, ctx);

    /* Receita não se divide, e a frase foi entendida inteira — o que há é
     * um impedimento, não uma falta. A frase é a mesma que a API responderia
     * se a chamada chegasse lá, e sai daqui para a pessoa não descobrir isso
     * depois de confirmar. */
    /* Parcelar e repetir são duas repetições diferentes na mesma frase: uma
     * reparte o valor, a outra o repete inteiro. As duas foram entendidas, e
     * escolher uma em silêncio seria gravar o que a pessoa não disse. */
    if (r.repeticaoEParcela) {
      return {
        texto:
          '⚠️ "' + r.parcelas + 'x" e "' + this.comQueFrequencia(r.repeticao.freq) +
          '" são duas repetições diferentes na mesma frase.\n\n' +
          'Parcelado reparte o valor (3.000 em 3x são três de 1.000); ' +
          'fixo repete o valor inteiro (2.500 todo mês são 2.500 todo mês). ' +
          'Mande de novo com uma das duas.',
      };
    }

    if (r.divisaoEmReceita) {
      return {
        texto:
          '⚠️ Só despesa se divide: receita não é gasto de ninguém.\n\n' +
          'Se a entrada foi um acerto — alguém te pagando o que devia —, ' +
          'isso é "recebi" na tela de compartilhadas, no app.',
      };
    }

    const cartao = this.ofereceCriarCartao(userId, r, ctx);
    if (cartao) return cartao;

    const conta = this.ofereceCriarConta(userId, r, ctx);
    if (conta) return conta;

    const criar = this.ofereceCriarCategoria(userId, r, ctx);
    if (criar) return criar;

    if (r.faltando.length) {
      const nomes = r.faltando.includes('destino')
        ? ' ' + this.nomesDeDestino(ctx)
        : '';
      const categorias = r.faltando.includes('categoria')
        ? ' ' + this.ajudaDeCategoria(texto, r.tipo, ctx)
        : '';
      /* "Faltou pessoa, partes" não diz nada a ninguém. Cada uma destas
       * duas é uma pergunta diferente, e as duas são da divisão. */
      const daDivisao = this.ajudaDaDivisao(r, ctx);
      /* "Faltou por quantas vezes" precisa dizer o que responder: "todo mês"
       * não diz até quando, e o app não inventa um prazo. */
      const daRepeticao = r.faltando.includes('por quantas vezes')
        ? ' Diga por quantas vezes: "' + this.exemploDeRepeticao(r.repeticao.freq) + '".'
        : '';
      return {
        texto:
          this.resumo(r, ctx) +
          '\n\nFaltou ' +
          r.faltando.join(', ') +
          '.' +
          nomes +
          categorias +
          daDivisao +
          daRepeticao +
          ' Mande a frase de novo com essa parte, ou lance no app.',
      };
    }

    /* A conta que não fecha é dita ANTES do "sim", com a frase do próprio
     * serviço de divisão — e sem rascunho: confirmar algo que o servidor vai
     * recusar é fazer a pessoa esperar por um erro que já se conhecia. */
    const impossivel = this.linhasDaDivisao(r).erro;
    if (impossivel) {
      return { texto: this.resumo(r, ctx) + '\n\n⚠️ ' + impossivel };
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return {
      texto: this.resumo(r, ctx) + this.avisoDePessoaNova(r) + '\n\nConfirma?',
      confirmar: true,
    };
  }

  /** "Vou criar a pessoa Carla" — dito antes do sim, como a conta e a
   * categoria novas. Criar gente em silêncio encheria a agenda de quem
   * errou um nome, e ninguém saberia de onde vieram. */
  private avisoDePessoaNova(r: any): string {
    const novas: string[] = (r.divisao && r.divisao.novas) || [];
    if (!novas.length) return '';
    return (
      '\n\n' +
      (novas.length === 1
        ? 'Você ainda não tem ' + novas[0] + ' na sua lista de pessoas. Crio junto.'
        : 'Você ainda não tem ' + this.comE(novas) + ' na sua lista de pessoas. Crio junto.')
    );
  }

  /**
   * "transferi 200 do nubank para o cofre".
   *
   * A mesma conta dos dois lados não é "faltou" — é contradição, e merece
   * recado próprio: o servidor recusaria, e "faltou conta de destino" mandaria
   * a pessoa procurar o que ela já disse.
   */
  private lerTransferencia(userId: string, r: any, ctx: any): Resposta {
    const ativas = ctx.contas.filter((c: any) => c.isActive !== false);
    if (ativas.length < 2) {
      return {
        texto:
          'Transferência precisa de duas contas, e você tem ' +
          (ativas.length === 1 ? 'uma' : 'nenhuma') +
          '. Cadastre outra no app, em Contas.',
      };
    }
    if (r.deId && r.deId === r.paraId) {
      return {
        texto:
          'Você disse a mesma conta duas vezes. Diga de qual sai e para qual vai, nessa ordem.',
      };
    }
    if (r.faltando.length) {
      return {
        texto:
          this.resumoTransferencia(r, ctx) +
          '\n\nFaltou ' +
          r.faltando.join(', ') +
          '. ' +
          this.nomesDeConta(ctx) +
          ' A primeira conta dita é a que paga, a segunda é a que recebe.',
      };
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return {
      texto: this.resumoTransferencia(r, ctx) + '\n\nConfirma?',
      confirmar: true,
    };
  }

  /**
   * "Apliquei 500 na viagem" / "resgatei 200 do objetivo viagem".
   *
   * Move dinheiro entre uma conta e um objetivo, e por isso não é lançamento:
   * não entra em receita nem em despesa, não tem categoria e não mexe no
   * resultado do mês. É a mesma natureza da transferência, e segue o mesmo
   * rito — resumo, "sim", grava.
   *
   * **A trava do resgate não é refeita aqui.** Quem sabe quanto o objetivo
   * tem é o `GoalsService`, que recusa resgate maior que o guardado com a
   * frase certa; recalcular o guardado nesta conversa seria uma segunda
   * implementação da mesma regra, e o dia em que as duas discordassem seria
   * o dia em que o WhatsApp prometeria o que a tela nega.
   */
  private lerMovimentoDeObjetivo(userId: string, r: any, ctx: any): Resposta {
    const objetivos = ctx.objetivos || [];
    if (!objetivos.length) {
      return {
        texto:
          'Você ainda não tem objetivo cadastrado. Crie um no app, em Objetivos — ' +
          'depois dá para aplicar e resgatar por aqui.',
      };
    }
    if (r.objetivoConcluido) {
      return {
        texto:
          '🎯 Esse objetivo já foi concluído e não recebe novas aplicações.\n\n' +
          'Reabra ele no app se quiser voltar a guardar. Resgatar continua valendo.',
      };
    }
    if (!r.objetivoId) {
      const nomes = objetivos.map((o: any) => o.nome).join(', ');
      return {
        texto:
          (r.objetivoDito
            ? 'Não achei o objetivo "' + r.objetivoDito + '".'
            : 'Não entendi em qual objetivo.') +
          '\n\nOs seus são: ' + nomes + '.',
      };
    }
    if (r.faltando.length) {
      return {
        texto:
          this.resumoDeObjetivo(r, ctx) +
          '\n\nFaltou ' + r.faltando.join(', ') + '. ' +
          (r.faltando.indexOf('conta') >= 0 ? this.nomesDeConta(ctx) : ''),
      };
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return { texto: this.resumoDeObjetivo(r, ctx) + '\n\nConfirma?', confirmar: true };
  }

  /** O resumo do movimento: a direção em primeiro lugar, que é o que a
   * pessoa precisa conferir — de qual conta sai e para qual objetivo vai. */
  private resumoDeObjetivo(r: any, ctx: any): string {
    const aplicando = r.movimento === 'DEPOSIT';
    const alvo = (ctx.objetivos || []).filter((o: any) => o.id === r.objetivoId)[0];
    const conta = (ctx.contas || []).filter((c: any) => c.id === r.contaId)[0];
    const linhas = [
      aplicando ? '🎯 Aplicar no objetivo' : '🎯 Resgatar do objetivo',
      '💵 Valor: ' + this.brl(r.valor),
      '🏁 Objetivo: ' + (alvo ? alvo.nome : '—'),
      (aplicando ? '🏦 Sai da conta: ' : '🏦 Entra na conta: ') + (conta ? conta.nome : '—'),
      '📅 Data: ' + this.dataBR(r.data),
    ];
    if (r.desc) linhas.push('📝 Descrição: ' + r.desc);
    return linhas.join('\n');
  }

  // ----------------------------------------------------------
  // despesa dividida
  // ----------------------------------------------------------
  /** Os participantes no formato do rateio. A pessoa que ainda não existe
   * entra com um id de mentira — `dividir` só o usa como etiqueta e para
   * recusar nome repetido, e é o mesmo id que o resumo e a gravação usam
   * para falar da mesma pessoa. */
  private participantesDoRateio(divisao: any): Participante[] {
    return (divisao.participantes || []).map((p: any) => ({
      personId: p.pessoaId || 'nova:' + fala.normalizarFala(p.nome),
      amount: p.valor ?? undefined,
      percent: p.percent ?? undefined,
    }));
  }

  /**
   * A divisão, em linhas — e a MINHA parte junto, que é o número que a
   * pessoa quer ver.
   *
   * Quem calcula é `dividir`, a mesma função que o servidor usa para gravar.
   * Ela também é quem recusa o impossível ("3,00 não dá para dividir entre 5
   * pessoas", "a soma das partes passou do valor"), e a recusa vem com a
   * frase pronta — repeti-la aqui seria escrever a segunda versão da mesma
   * regra.
   */
  private linhasDaDivisao(r: any): { linhas: string[]; erro: string | null } {
    const d = r.divisao;
    if (!d || !r.valor || !d.participantes.length) return { linhas: [], erro: null };
    /* Parcelada, o valor que se divide é o da COMPRA, e não o da parcela —
     * a mesma regra do formulário. Dividir a parcela daria a conta certa por
     * acaso no caso redondo e errada no resto. */
    const parcelas = r.parcelas >= 2 ? r.parcelas : 0;
    const total = parcelas ? r.valorTotal : r.valor;
    let partes;
    let totais: typeof partes;
    let minha: number;
    try {
      const rateio = dividir(total, d.modo, this.participantesDoRateio(d));
      if (parcelas) {
        /* O que cada um deve POR PARCELA sai das mesmas funções que vão
         * gravar. Fazer essa conta à mão aqui — dividir a parte por N —
         * erraria o centavo que elas distribuem na primeira parcela, e o
         * resumo mostraria um número que o extrato não teria. */
        const valores = repartirEmParcelas(emCentavos(total), parcelas);
        const daPrimeira = parcelarRateio(rateio.partes, valores)[0];
        const dosOutros = daPrimeira.reduce((soma, p) => soma + emCentavos(p.amount), 0);
        partes = daPrimeira;
        /* O total de cada um vem do rateio, e NÃO da primeira parcela vezes
         * N: o centavo que sobra fica só na primeira, e multiplicar daria
         * R$ 10,02 onde a dívida é R$ 10,00. */
        totais = rateio.partes;
        minha = emReais(valores[0] - dosOutros);
      } else {
        partes = rateio.partes;
        totais = rateio.partes;
        minha = rateio.minhaParte;
      }
    } catch (e: any) {
      return { linhas: [], erro: e?.message || 'Não consegui dividir esse valor.' };
    }
    const comoFoiDito =
      d.modo === 'IGUAL' ? 'em partes iguais' : d.modo === 'VALOR' ? 'por valor' : 'por percentual';
    /* Repetida, a divisão é a MESMA toda vez (fixa repete o valor inteiro),
     * então o total de cada um é a parte vezes o número de vezes — sem
     * centavo para distribuir, ao contrário da parcelada. */
    const vezes = r.repeticao && r.repeticao.quantas ? r.repeticao.quantas : 0;
    const aCada = parcelas ? ' por parcela' : vezes ? ' cada vez' : '';
    const linhas = [
      '',
      '👥 Dividida ' + comoFoiDito +
        (parcelas ? ', parcela a parcela' : vezes ? ', toda vez' : ''),
    ];
    partes.forEach((parte, i) => {
      const dito = d.participantes[i];
      const noTotal = parcelas
        ? Number(totais[i].amount)
        : vezes
          ? Math.round(Number(parte.amount) * vezes * 100) / 100
          : null;
      linhas.push(
        '🧑 ' + dito.nome + ': ' + this.brl(parte.amount) + aCada +
        (parte.percent === null ? '' : ' (' + this.pct(Number(parte.percent)) + ')') +
        (noTotal === null ? '' : ' · ' + this.brl(noTotal) + ' no total'),
      );
    });
    linhas.push('🙋 Você: ' + this.brl(minha) + aCada);
    return { linhas, erro: null };
  }

  /** A frequência como se fala dela. Num lugar só: ela aparece no resumo,
   * na pergunta do que falta e na recusa da contradição. */
  private comQueFrequencia(freq: string): string {
    return freq === 'BIWEEKLY' ? 'a cada 15 dias'
      : freq === 'QUARTERLY' ? 'a cada 3 meses'
      : freq === 'YEARLY' ? 'todo ano'
      : 'todo mês';
  }

  /** O exemplo que vai junto da pergunta, na mesma frequência que a pessoa
   * disse — pedir "por 12 meses" a quem falou em ano seria pedir outra
   * coisa. */
  private exemploDeRepeticao(freq: string): string {
    return freq === 'YEARLY' ? 'por 3 anos'
      : freq === 'QUARTERLY' ? 'por 4 vezes'
      : freq === 'BIWEEKLY' ? 'por 6 vezes'
      : 'por 12 meses';
  }

  /** "40%" sem casa decimal quando ela é zero: 40,0000 é como o banco guarda,
   * não como se fala. */
  private pct(valor: number): string {
    return (Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace('.', ',')) + '%';
  }

  /** O que falta na DIVISÃO, com as palavras dela. */
  private ajudaDaDivisao(r: any, ctx: any): string {
    if (!r.divisao) return '';
    const partes: string[] = [];
    if (r.faltando.includes('pessoa')) {
      const nomes = (ctx.pessoas || []).map((p: any) => p.nome).join(', ');
      partes.push(
        ' Diga com quem: "dividido com a Ana".' +
        (nomes ? ' Suas pessoas: ' + nomes + '.' : ''),
      );
    }
    if (r.faltando.includes('partes')) {
      partes.push(
        ' Você disse a parte de uns e não a de outros. Diga a de todos' +
        ' ("com a Ana 50 e o João 30") ou a de ninguém, que aí divide igual.',
      );
    }
    return partes.join('');
  }

  // ----------------------------------------------------------
  // o que fazer com quem ainda não conectou
  // ----------------------------------------------------------
  /** Resposta igual para todo número desconhecido, com ou sem conta no app.
   * Dizer "esta conta não tem WhatsApp ligado" confirmaria, para quem
   * adivinhou um número, que existe conta ali. */
  private async semVinculo(m: MensagemRecebida): Promise<Resposta> {
    const ligou = await this.whatsapp.vincularPorCodigo(m.de, m.texto || '');
    if (ligou) {
      return {
        texto:
          'Pronto. Este número agora lança na sua conta do saldonline.\n\n' +
          'Experimente: "gastei 40 no mercado pelo débito".',
      };
    }
    return {
      texto:
        'Não reconheço este número. Para conectar, abra o app, vá em Perfil → WhatsApp ' +
        'e mande daqui o código que aparecer lá.',
    };
  }

  // ----------------------------------------------------------
  // gravar, depois do sim
  // ----------------------------------------------------------
  private async gravar(userId: string, rascunho: Rascunho): Promise<Resposta> {
    this.rascunhos.delete(userId);
    // O objetivo novo não tem lançamento atrás dele: o "sim" aqui cria o
    // cadastro e acaba.
    if (rascunho.objetivoNovo) return this.criarObjetivo(userId, rascunho.objetivoNovo);
    const r = rascunho.lancamento;
    if (r.transferencia)
      return this.gravarTransferencia(userId, r, rascunho.criadoEm);
    if (r.objetivo) return this.gravarMovimentoDeObjetivo(userId, r, rascunho.criadoEm);

    if (rascunho.cartaoNovo?.fechamento && rascunho.cartaoNovo.vencimento) {
      const criado = await this.criarCartao(userId, rascunho.cartaoNovo as Required<typeof rascunho.cartaoNovo>);
      if (!criado) {
        return {
          texto:
            'Não consegui criar o cartão ' +
            rascunho.cartaoNovo.nome +
            '. Crie no app, em Cartões, e mande a frase de novo.',
        };
      }
      r.cartaoId = criado;
    }

    if (rascunho.contaNova) {
      const criada = await this.criarConta(userId, rascunho.contaNova.nome);
      if (!criada) {
        return {
          texto:
            'Não consegui criar a conta ' +
            rascunho.contaNova.nome +
            '. Crie no app, em Contas, e mande a frase de novo.',
        };
      }
      r.contaId = criada;
    }

    if (rascunho.categoriaNova) {
      const criada = await this.criarCategoria(userId, rascunho.categoriaNova);
      if (!criada) {
        return {
          texto:
            'Não consegui criar a categoria ' +
            rascunho.categoriaNova.nome +
            '. Crie no app, em Categorias, e mande a frase de novo.',
        };
      }
      r.categoriaId = criada;
    }

    const pedido = {
      userId,
      type: r.tipo,
      amount: r.valor,
      categoryId: r.categoriaId,
      description: r.desc || undefined,
      transactionDate: new Date(r.data + 'T12:00:00.000Z'),
      bankAccountId: r.contaId || undefined,
      creditCardId: r.cartaoId || undefined,
      isConfirmed: r.confirmada,
      invoiceMonth: r.cartaoId && r.faturaMes ? r.faturaMes : undefined,
      // A mesma chave para a mesma frase: se a Meta reentregar o "sim"
      // depois de o lançamento existir, o servidor devolve o que já está
      // gravado em vez de lançar o dobro.
      clientKey:
        'wa-' + userId.slice(0, 8) + '-' + Math.round(rascunho.criadoEm / 1000),
    };

    /* Gasto dividido vai por outra porta: é ela que cria o lançamento E a
     * divisão na mesma transação de banco. Chamar o lançamento aqui e a
     * divisão depois deixaria, no tropeço do meio, um gasto sem divisão —
     * e ninguém devendo nada a ninguém. */
    if (r.divisao) return this.gravarDividida(userId, r, rascunho.criadoEm);

    try {
      // Parcelado vira SÉRIE, e não N lançamentos soltos: é o `seriesId` que
      // faz existirem "excluir todas", editar em série e antecipar. Mesmo
      // caminho do formulário.
      if (r.parcelas >= 2) {
        await this.transactions.createSeries(pedido, {
          kind: 'INSTALLMENT',
          frequency: 'MONTHLY',
          count: r.parcelas,
        });
      } else if (r.repeticao && r.repeticao.quantas) {
        /* FIXA repete o valor INTEIRO a cada vez — um aluguel de 2.500 é
         * 2.500 todo mês. É a diferença para a parcelada, que reparte: lá o
         * valor do pedido é o da compra, aqui é o de cada ocorrência. */
        await this.transactions.createSeries(pedido, {
          kind: 'FIXED',
          frequency: r.repeticao.freq,
          count: r.repeticao.quantas,
        });
      } else {
        await this.transactions.create(pedido);
      }
    } catch (e: any) {
      this.log.error('falha ao lançar pelo WhatsApp: ' + (e?.message || e));
      return {
        texto:
          'Não consegui lançar agora. Tente de novo em instantes, ou lance pelo app.',
      };
    }
    // Depois do sucesso, nunca antes — e sem deixar que um tropeço aqui diga
    // à pessoa que o lançamento falhou, porque ele não falhou.
    try {
      await this.talvezAprenderLojista(userId, r.desc, r.categoriaId);
    } catch (e: any) {
      this.log.warn('não consegui aprender o lojista: ' + (e?.message || e));
    }

    return { texto: '✅ Lançado. ' + this.linhaCurta(r) };
  }

  // ----------------------------------------------------------
  // objetivo novo, pela conversa
  // ----------------------------------------------------------
  /**
   * "Quero criar um objetivo" — com as três informações na mesma frase ou sem
   * nenhuma delas.
   *
   * Nome, quanto e até quando é o que faz um objetivo. O que a frase trouxer
   * é lido; o que faltar é PERGUNTADO, e o rascunho espera a resposta — o
   * mesmo caminho do cartão, que também não nasce de uma frase só.
   *
   * Por que criar aqui, em vez de mandar para o app como era até agora: quem
   * está no WhatsApp quase sempre está longe do app (é por isso que está no
   * WhatsApp), e "crie no app" é onde a vontade de começar a guardar dinheiro
   * morre.
   */
  private lerPedidoDeObjetivo(userId: string, texto: string, ctx: any): Resposta {
    return this.objetivoEmAndamento(userId, partesDoObjetivo(texto, ctx.hoje), ctx);
  }

  /**
   * A resposta que completa o rascunho: o nome, o valor, o prazo, ou o que
   * faltava de uma vez.
   *
   * O que já está no rascunho MANDA sobre o que a resposta trouxer. Sem isso,
   * "6000" — respondido quando faltava só o valor — apagaria um nome já dado:
   * o leitor corta o nome no primeiro número, e nessa frase ele não acharia
   * nome nenhum.
   */
  private async lerFaltaDoObjetivo(
    userId: string,
    rascunho: Rascunho,
    texto: string,
  ): Promise<Resposta> {
    if (NAO.test(texto)) {
      this.rascunhos.delete(userId);
      return { texto: 'Ok, não criei o objetivo.' };
    }
    const ctx = await this.contextoDoUsuario(userId);
    const lido = partesDoObjetivo(texto, ctx.hoje);
    const tinha = rascunho.objetivoNovo!;
    const novo: ObjetivoNovo = {
      nome: tinha.nome || lido.nome,
      valor: tinha.valor ?? lido.valor,
      prazo: tinha.prazo || lido.prazo,
    };
    /* O rascunho ANDOU? É isso, e não "a resposta tinha alguma coisa", que
     * decide se a pergunta volta dizendo "Não entendi". Uma resposta como
     * "não sei ainda" é lida como nome — nome é texto livre, qualquer palavra
     * serve —, e com o nome já preenchido ela não muda nada: a pergunta
     * voltava idêntica, e quem leu achou que a mensagem não tinha chegado. */
    const andou =
      novo.nome !== tinha.nome || novo.valor !== tinha.valor || novo.prazo !== tinha.prazo;
    return this.objetivoEmAndamento(userId, novo, ctx, andou ? undefined : 'Não entendi.');
  }

  /**
   * Onde o objetivo novo para em pé: o que já se sabe, o que falta, e o
   * "Criar?" quando nada mais falta.
   *
   * É a mesma decisão nas duas entradas — a primeira frase e a resposta que
   * completa —, e por isso vive num lugar só. As três recusas (nome repetido,
   * valor acima do teto, prazo no passado) tiram só a parte recusada e
   * perguntam de novo: jogar o rascunho inteiro fora por causa de um prazo
   * errado cobraria a frase toda outra vez.
   */
  private objetivoEmAndamento(
    userId: string,
    novo: ObjetivoNovo,
    ctx: any,
    erro?: string,
  ): Resposta {
    let aviso = erro;
    const nome = novo.nome;

    /* Nome repetido não vira objetivo gêmeo: "apliquei 500 no objetivo
     * viagem" escolhe o objetivo PELO NOME, e com dois iguais o dinheiro
     * entraria no que a busca achasse primeiro. */
    if (nome) {
      const igual = (ctx.objetivos || []).filter(
        (o: any) => fala.normalizarFala(o.nome) === fala.normalizarFala(nome),
      )[0];
      if (igual) {
        this.rascunhos.delete(userId);
        return {
          texto:
            '🎯 Você já tem um objetivo chamado ' + igual.nome + '.\n\n' +
            'Para guardar nele, mande: "apliquei 500 no objetivo ' + igual.nome + '". ' +
            'Para mudar a meta ou o prazo, é no app, em Objetivos.',
        };
      }
      if (nome.length > 80) {
        aviso = 'Esse nome é comprido demais — o limite é 80 letras.';
        novo = { ...novo, nome: undefined };
      }
    }

    if (novo.valor && novo.valor > TETO_OBJETIVO) {
      aviso = 'Esse valor passa do que o app aceita.';
      novo = { ...novo, valor: undefined };
    }

    // Prazo no passado não é objetivo: o "por mês" viraria "tudo o que falta,
    // neste mês", e o objetivo nasceria atrasado.
    if (novo.prazo && novo.prazo < fala.isoDate(ctx.hoje)) {
      aviso = this.dataBR(novo.prazo) + ' já passou.';
      novo = { ...novo, prazo: undefined };
    }

    this.rascunhos.set(userId, { lancamento: null, criadoEm: Date.now(), objetivoNovo: novo });

    if (!objetivoCompleto(novo)) {
      return { texto: this.pedidoDoObjetivo(novo, ctx.hoje, aviso) };
    }
    return {
      texto: this.resumoDoObjetivo(novo) + '\n\nCriar o objetivo ' + novo.nome + '?',
      confirmar: true,
    };
  }

  /** As três informações, uma por linha, com — no que ainda falta. O mesmo
   * desenho do resumo do lançamento: é a mesma pessoa lendo as duas coisas no
   * mesmo lugar, e um bloco com marca e outro sem fariam o app parecer dois
   * apps. */
  private resumoDoObjetivo(novo: ObjetivoNovo): string {
    return [
      '🎯 Objetivo novo',
      '🏷️ Nome: ' + (novo.nome || '—'),
      '💰 Meta: ' + (novo.valor ? this.brl(novo.valor) : '—'),
      '📅 Prazo: ' + (novo.prazo ? this.dataBR(novo.prazo) : '—'),
    ].join('\n');
  }

  /**
   * O pedido do que falta, com um exemplo feito SÓ das partes que faltam —
   * um exemplo completo, quando falta uma coisa só, faz a pessoa repetir o
   * que ela já disse.
   *
   * O ano do exemplo sai de HOJE, e não de uma data escrita aqui: um exemplo
   * com ano no passado seria um exemplo que o próprio app recusaria.
   */
  private pedidoDoObjetivo(novo: ObjetivoNovo, hoje: Date, aviso?: string): string {
    const falta: string[] = [];
    const exemplo: string[] = [];
    if (!novo.nome) {
      falta.push('o nome');
      exemplo.push('Viagem');
    }
    if (!novo.valor) {
      falta.push('quanto você quer juntar');
      exemplo.push('6000');
    }
    let linhaDoExemplo = exemplo.join(', ');
    if (!novo.prazo) {
      falta.push('até quando');
      linhaDoExemplo +=
        (linhaDoExemplo ? ' ' : '') + 'até dezembro de ' + (hoje.getFullYear() + 1);
    }
    return [
      this.resumoDoObjetivo(novo),
      '',
      (aviso ? aviso + ' ' : '') + 'Falta ' + this.comE(falta) + '.',
      '',
      '👉 Responda numa frase. Exemplo:',
      '',
      linhaDoExemplo,
      '',
      'Ou responda “não” para desistir.',
    ].join('\n');
  }

  /** "o nome, quanto você quer juntar e até quando" — a última vírgula vira
   * "e", que é como se fala. */
  private comE(partes: string[]): string {
    if (partes.length <= 1) return partes.join('');
    return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
  }

  /**
   * O objetivo criado no "sim" — pelo MESMO serviço do formulário, que é quem
   * confere o prazo contra a data de início e guarda o valor como decimal.
   *
   * Começa hoje e com saldo inicial ZERO: "quanto você já tem guardado fora
   * do app" seria uma quarta pergunta, e ela transformaria a conversa num
   * formulário. No app esse campo está lá, e a resposta diz onde — o que não
   * dá é deixar um número que ninguém informou contando como progresso.
   */
  private async criarObjetivo(userId: string, novo: ObjetivoNovo): Promise<Resposta> {
    try {
      const criado = await this.goals.create({
        userId,
        name: novo.nome!,
        startDate: fala.isoDate(diaDoUsuario()),
        targetDate: novo.prazo!,
        targetAmount: novo.valor!,
      });
      /* As contas vêm do serviço, e não de uma divisão feita aqui: o "por
       * mês" é `falta ÷ meses que restam`, o mesmo número que a tela mostra,
       * recalculado a cada leitura. */
      const comAsContas: any = await this.goals.findOne(criado.id, userId);
      const p = comAsContas.progress;
      const linhas = this.linhasDoObjetivo({
        id: criado.id,
        nome: criado.name,
        meta: Number(criado.targetAmount),
        guardado: Number(p.saved),
        falta: Number(p.remaining),
        pct: Math.round(p.percent * 100),
        prazo: novo.prazo!,
        meses: p.monthsLeft,
        mensal: Number(p.monthlyTarget),
        atrasado: !p.onTrack,
        concluido: false,
        dasContas: Number(comAsContas.appliedFromAccounts),
      });
      return {
        texto: [
          '✅ Objetivo criado',
          ...linhas,
          '',
          'Para guardar nele, mande: "apliquei 500 no objetivo ' + criado.name + '".',
          'Já tem dinheiro guardado fora do app? O saldo inicial é no app, em Objetivos.',
        ].join('\n'),
      };
    } catch (e: any) {
      this.log.error('falha ao criar objetivo pelo WhatsApp: ' + (e?.message || e));
      return {
        texto:
          'Não consegui criar o objetivo agora. Tente de novo em instantes, ou crie no app, em Objetivos.',
      };
    }
  }

  /**
   * O gasto dividido, gravado depois do "sim".
   *
   * As pessoas novas nascem primeiro, e uma a uma: o serviço de divisão
   * precisa de ids, e nome não é id. Falhando a criação de alguma, nada do
   * resto acontece — metade da divisão seria uma dívida errada, pior que
   * nenhuma.
   *
   * O parcelamento NÃO entra aqui ainda: uma compra dividida e parcelada
   * tem série própria (`createSeries`), e o valor muda de significado entre
   * os dois casos — é o total da compra, não o de cada parcela. Misturar as
   * duas coisas sem dizer qual é qual cobraria do amigo cinco vezes a conta.
   */
  private async gravarDividida(userId: string, r: any, criadoEm: number): Promise<Resposta> {
    const d = r.divisao;
    const idPorNome: Record<string, string> = {};
    try {
      for (const nome of d.novas as string[]) {
        const criada = await this.pessoas.create({ userId, name: nome });
        idPorNome[fala.normalizarFala(nome)] = criada.id;
      }
    } catch (e: any) {
      this.log.warn('não consegui criar a pessoa: ' + (e?.message || e));
      return {
        texto:
          'Não consegui criar ' + (d.novas as string[]).join(', ') +
          ' na sua lista de pessoas. Crie no app, em Compartilhadas, e mande a frase de novo.',
      };
    }

    const participantes: Participante[] = d.participantes.map((p: any) => ({
      personId: p.pessoaId || idPorNome[fala.normalizarFala(p.nome)],
      amount: p.valor ?? undefined,
      percent: p.percent ?? undefined,
    }));

    /* Parcelada: o valor do pedido é o da COMPRA INTEIRA, e quem reparte é o
     * serviço. Mandar o valor da parcela criaria uma série de 3x3.000 — o
     * triplo do que a pessoa gastou. */
    const parcelas = r.parcelas >= 2 ? r.parcelas : 0;
    const pedido = {
      userId,
      amount: parcelas ? r.valorTotal : r.valor,
      date: r.data,
      categoryId: r.categoriaId,
      description: r.desc || undefined,
      bankAccountId: r.contaId || undefined,
      creditCardId: r.cartaoId || undefined,
      invoiceMonth: r.cartaoId && r.faturaMes ? r.faturaMes : undefined,
      isConfirmed: r.confirmada,
      mode: d.modo,
      participants: participantes,
      clientKey: 'wa-div-' + userId.slice(0, 8) + '-' + Math.round(criadoEm / 1000),
    };

    try {
      /* Parcelado vira SÉRIE, como no lançamento comum — e aqui ela importa
       * ainda mais: cada parcela ganha a SUA divisão, porque cada uma é uma
       * dívida do mês dela. Uma divisão só, presa à primeira, diria que o
       * amigo deve a compra inteira já no primeiro mês.
       *
       * Sem isto, a resposta prometia "3x de R$ 1.000,00, total R$ 3.000,00"
       * e gravava UM gasto de R$ 1.000,00 — medido. */
      if (parcelas) {
        await this.divididas.createSeries(pedido, {
          kind: 'INSTALLMENT',
          frequency: 'MONTHLY',
          count: parcelas,
        });
      } else if (r.repeticao && r.repeticao.quantas) {
        // O aluguel rachado: cada mês é um gasto, e cada um com a sua
        // divisão — quitar o de novembro não quita o de dezembro.
        await this.divididas.createSeries(pedido, {
          kind: 'FIXED',
          frequency: r.repeticao.freq,
          count: r.repeticao.quantas,
        });
      } else {
        await this.divididas.create(pedido);
      }
    } catch (e: any) {
      this.log.error('falha ao dividir pelo WhatsApp: ' + (e?.message || e));
      // A recusa do serviço vem com a frase pronta e o número dentro ("a
      // soma das partes passou do valor da despesa"). Repassá-la é melhor
      // do que um "não consegui" que não diz o que corrigir.
      const motivo = e?.response?.message || e?.message;
      return {
        texto: motivo
          ? '⚠️ ' + motivo
          : 'Não consegui lançar a despesa dividida agora. Tente de novo em instantes, ou lance no app.',
      };
    }

    try {
      await this.talvezAprenderLojista(userId, r.desc, r.categoriaId);
    } catch (e: any) {
      this.log.warn('não consegui aprender o lojista: ' + (e?.message || e));
    }

    /* A mesma conta do resumo, para a confirmação não dizer outro número do
     * que a pessoa acabou de ler e aprovar. */
    const mostrado = this.linhasDaDivisao(r);
    const nomes = d.participantes.map((p: any) => p.nome).join(', ');
    const minha = mostrado.linhas[mostrado.linhas.length - 1] || '';
    return {
      texto:
        '✅ Lançado e dividido. ' + this.linhaCurta(r) + '\n' +
        '👥 ' + nomes + ' · sua parte: ' + minha.replace('🙋 Você: ', ''),
    };
  }

  /**
   * O cartão novo, criado no "sim" — pelo mesmo serviço do formulário, que é
   * quem já cria a primeira fatura e o período de origem do ciclo.
   *
   * Limite zero: é o único número que não dá para supor, e é o que menos
   * machucha errado — ele se corrige no app a qualquer hora, enquanto os dias
   * do ciclo valem da fatura aberta em diante.
   */
  private async criarCartao(
    userId: string,
    novo: { nome: string; fechamento: number; vencimento: number; limite?: number },
  ): Promise<string | null> {
    try {
      const criado = await this.cartoes.create({
        userId,
        name: novo.nome,
        limitAmount: novo.limite ?? 0,
        closingDay: novo.fechamento,
        dueDay: novo.vencimento,
      });
      return criado.id;
    } catch (e: any) {
      this.log.warn('não consegui criar o cartão: ' + (e?.message || e));
      return null;
    }
  }

  /**
   * A conta nova, criada no "sim" — pelo mesmo serviço do formulário.
   *
   * Conta corrente e saldo zero, que é o único saldo que dá para afirmar: o
   * app não sabe quanto havia nela, e inventar um número seria pior do que
   * zero, que a pessoa corrige no app. O lançamento que vem logo a seguir já
   * mexe nesse saldo pelo caminho normal.
   */
  private async criarConta(userId: string, nome: string): Promise<string | null> {
    try {
      const criada = await this.contas.create({
        userId,
        institutionName: nome,
        accountType: 'CHECKING' as any,
        initialBalance: 0,
      });
      return criada.id;
    } catch (e: any) {
      this.log.warn('não consegui criar a conta: ' + (e?.message || e));
      return null;
    }
  }

  /**
   * A categoria nova, criada no "sim" — pelo mesmo serviço que o formulário
   * usa, e não por um `prisma.create` daqui. É ele que confere o nome repetido
   * e dá a ordem na lista, e duas portas para a mesma criação viram duas
   * regras na primeira correção.
   *
   * Nasce sem pai: escolher subcategoria por frase é outra gramática, e no app
   * a pessoa move depois. Devolve o id, ou `null` quando não deu — e aí o
   * lançamento não acontece, porque lançar sem a categoria que a pessoa pediu
   * seria gravar outra coisa.
   */
  private async criarCategoria(
    userId: string,
    nova: { nome: string; tipo: string },
  ): Promise<string | null> {
    try {
      const criada = await this.categorias.create({
        userId,
        name: nova.nome,
        type: nova.tipo as any,
      });
      return criada.id;
    } catch (e: any) {
      this.log.warn('não consegui criar a categoria: ' + (e?.message || e));
      return null;
    }
  }

  /**
   * Guarda o lojista, como o app guarda depois de um lançamento digitado.
   *
   * Sem isto o WhatsApp era o único lugar que nunca ficava mais esperto: ele
   * LIA as regras e nunca escrevia nenhuma. E é justamente onde se lança com
   * pressa, que é quando mais vale o app já saber a categoria.
   *
   * A chave e o piso de tamanho vêm do `fala.js` compartilhado, os mesmos da
   * tela: dois lados ensinando a mesma tabela com réguas diferentes seria pior
   * do que um lado não ensinar.
   */
  private async talvezAprenderLojista(
    userId: string,
    desc: string,
    categoriaId: string,
  ) {
    if (!categoriaId || !desc) return;
    const chave = fala.chaveDeLojista(desc);
    if (chave.length < fala.MIN_LOJISTA) return;

    const regras = await this.prisma.categoryRule.findMany({
      where: { userId },
      select: { merchant: true, categoryId: true },
    });
    // Já existe regra para este lojista: foi ela que sugeriu a categoria, e
    // reescrevê-la aqui apagaria, sem pergunta, uma decisão tomada na tela.
    const jaSabe = fala.regraDoLojista(
      regras.map((r) => ({ lojista: r.merchant, categoriaId: r.categoryId })),
      desc,
    );
    if (jaSabe) return;

    // O rótulo é o nome como a pessoa escreveu ("Padaria"), e não a chave
    // normalizada ("padaria"): chave não se mostra a ninguém.
    const label = fala.lojistaDoHistorico(desc);
    await this.prisma.categoryRule.upsert({
      where: { userId_merchant: { userId, merchant: chave } },
      create: { userId, merchant: chave, label, categoryId: categoriaId },
      update: {
        categoryId: categoriaId,
        hits: { increment: 1 },
        ...(label ? { label } : {}),
      },
    });
  }

  /** Transferência tem serviço próprio, e é ele que debita uma conta e credita
   * a outra na mesma transação de banco. Aqui só se traduz o pedido. */
  private async gravarTransferencia(
    userId: string,
    r: any,
    criadoEm: number,
  ): Promise<Resposta> {
    try {
      await this.transfers.create({
        userId,
        fromAccountId: r.deId,
        toAccountId: r.paraId,
        amount: r.valor,
        description: r.desc || undefined,
        transferDate: r.data,
        isConfirmed: r.confirmada,
        clientKey:
          'wa-' + userId.slice(0, 8) + '-' + Math.round(criadoEm / 1000),
      });
    } catch (e: any) {
      this.log.error('falha ao transferir pelo WhatsApp: ' + (e?.message || e));
      return {
        texto:
          'Não consegui transferir agora. Tente de novo em instantes, ou faça pelo app.',
      };
    }
    return {
      texto:
        '✅ Transferido. ' +
        this.brl(r.valor) +
        ' em ' +
        this.dataBR(r.data) +
        '.',
    };
  }

  /**
   * Grava o movimento de objetivo pela MESMA porta do app: as rotas de
   * aplicar e resgatar do `GoalsService`, com a mesma `clientKey` que impede
   * o "sim" repetido de guardar duas vezes.
   *
   * **A recusa do serviço é repassada como está.** Resgatar mais do que o
   * objetivo tem, ou aplicar num objetivo concluído, voltam dele com a frase
   * pronta ("O objetivo tem R$ 300,00 guardados — não dá para resgatar mais
   * que isso"). Trocar essa frase por uma genérica esconderia justamente o
   * número que resolve a dúvida de quem mandou a mensagem.
   */
  private async gravarMovimentoDeObjetivo(
    userId: string,
    r: any,
    criadoEm: number,
  ): Promise<Resposta> {
    const aplicando = r.movimento === 'DEPOSIT';
    const entrada = {
      userId,
      bankAccountId: r.contaId,
      amount: r.valor,
      description: r.desc || undefined,
      movementDate: r.data,
      clientKey: 'wa-' + userId.slice(0, 8) + '-' + Math.round(criadoEm / 1000),
    };
    try {
      if (aplicando) await this.goals.aplicar(r.objetivoId, entrada);
      else await this.goals.resgatar(r.objetivoId, entrada);
    } catch (e: any) {
      // 400 é regra de negócio e vem com a frase certa; o resto é falha.
      if (e?.status === 400 && e?.message) return { texto: '⚠️ ' + e.message };
      this.log.error('falha ao mover objetivo pelo WhatsApp: ' + (e?.message || e));
      return {
        texto: 'Não consegui mexer no objetivo agora. Tente de novo em instantes, ou faça pelo app.',
      };
    }
    return {
      texto:
        (aplicando ? '✅ Aplicado. ' : '✅ Resgatado. ') +
        this.brl(r.valor) +
        ' em ' +
        this.dataBR(r.data) +
        '.',
    };
  }

  /**
   * O saldo de hoje, pela MESMA conta que a tela de Resumo faz.
   *
   * Duas regras vêm de lá e não podem ser reinventadas aqui, sob pena de o
   * WhatsApp dizer um número e o app mostrar outro:
   *
   *   1. conta arquivada ou OCULTA não entra. Ocultar existe justamente para
   *      tirar uma conta do número do topo, e quem oculta não quer vê-la
   *      aparecer por outra porta;
   *   2. o que está guardado em objetivo CONTINUA sendo saldo. Aplicar não é
   *      gastar — o dinheiro só mudou de lugar —, e sem essa parcela o total
   *      cairia toda vez que alguém guardasse dinheiro.
   *
   * As linhas somam o total exibido. Um total que não fecha com a lista
   * embaixo dele é um número que ninguém consegue conferir.
   */
  private async responderSaldo(userId: string, ctx: any): Promise<string> {
    const visiveis = await this.prisma.bankAccount.findMany({
      where: { userId, isActive: true, isHidden: false },
      orderBy: { sortOrder: 'asc' },
    });

    // Só os movimentos das contas visíveis, pelo mesmo motivo do item 1.
    const movimentos = await this.prisma.goalMovement.findMany({
      where: { userId, bankAccount: { isHidden: false, isActive: true } },
      select: { goalId: true, type: true, amount: true },
    });

    const porObjetivo = new Map<string, number>();
    for (const m of movimentos) {
      const sinal = m.type === 'DEPOSIT' ? 1 : -1;
      porObjetivo.set(
        m.goalId,
        (porObjetivo.get(m.goalId) ?? 0) + sinal * Number(m.amount),
      );
    }
    // Piso em zero por objetivo, como no app: quem resgatou mais do que
    // aplicou tirou do saldo inicial do objetivo, que o total nunca contou.
    const guardado = [...porObjetivo.values()].reduce(
      (s, v) => s + Math.max(0, v),
      0,
    );

    const nasContas = visiveis.reduce(
      (s, c) => s + Number(c.currentBalance),
      0,
    );

    if (!visiveis.length && !guardado) {
      return 'Você ainda não tem conta cadastrada. Crie uma no app, em Contas.';
    }

    const linhas = visiveis.map(
      (c) =>
        '🏦 ' + c.institutionName + ': ' + this.brl(Number(c.currentBalance)),
    );
    if (guardado)
      linhas.push('🎯 Guardado em objetivos: ' + this.brl(guardado));

    return (
      '💰 Saldo de hoje: ' +
      this.brl(nasContas + guardado) +
      '\n\n' +
      linhas.join('\n')
    );
  }

  /**
   * O resultado do mês, pela MESMA conta da tela de Resumo.
   *
   * A conta não está aqui nem em lugar nenhum do servidor: é o recorte do
   * app (`relatorio.js`), que `RelatorioService` alimenta com o estado do
   * banco. Daqui sai só o texto.
   *
   * Três coisas a resposta diz sempre, e cada uma existe por um engano
   * possível:
   *
   *   - **o mês e o ano**, porque "esse mês" e "outubro" foram interpretados
   *     e a pessoa precisa poder discordar;
   *   - **que previstos contam**, porque o número do mês corrente inclui o
   *     que ainda não aconteceu — quem comparar com o extrato do banco vai
   *     achar diferença, e é melhor saber por quê;
   *   - **o regime**, porque é ele que explica por que uma compra no cartão
   *     não apareceu no mês em que foi feita. É a escolha da pessoa, lida do
   *     cadastro dela, a mesma que a tela usa.
   */
  /**
   * "Quais foram meus maiores gastos em outubro?" — as mesmas cinco
   * categorias que o Resumo mostra, pelo mesmo cálculo.
   *
   * O regime aparece na resposta sempre, e não só quando foi pedido: por
   * compra e por fatura o MÊS INTEIRO muda de lugar (a compra de outubro no
   * cartão vira despesa de novembro), e um ranking sem dizer por qual conta
   * ele foi feito é um ranking que a pessoa não consegue conferir na tela.
   */
  private async responderMaiores(
    userId: string,
    texto: string,
    tipo: 'EXPENSE' | 'INCOME',
  ): Promise<string> {
    const mes = mesDaPergunta(texto, diaDoUsuario());
    const preferido = await this.relatorio.regime(userId);
    const pedido = regimeDaPergunta(texto);
    const r = await this.relatorio.maioresDoMes(userId, mes, tipo, pedido ?? preferido);

    const marca = tipo === 'INCOME' ? '📈' : '📉';
    const oQue = tipo === 'INCOME' ? 'receitas' : 'despesas';

    if (!r.itens.length) {
      return (
        marca + ' Maiores ' + oQue + ' de ' + this.rotuloMes(mes) +
        '\n\nSem ' + oQue + ' neste mês.' +
        '\n\n' + this.notaDoRegime(r.regime, preferido)
      );
    }

    const linhas = [marca + ' Maiores ' + oQue + ' de ' + this.rotuloMes(mes), ''];
    for (const i of r.itens) {
      linhas.push(
        '🏷️ ' + i.categoria + ': ' + this.brl(i.valor) +
          ' (' + i.parte.toFixed(0) + '%)',
      );
    }
    if (r.restantes) {
      linhas.push('');
      linhas.push(
        r.restantes === 1
          ? 'E mais 1 categoria.'
          : 'E mais ' + r.restantes + ' categorias.',
      );
    }
    linhas.push('');
    linhas.push('💵 Total: ' + this.brl(r.total));
    linhas.push('');
    linhas.push(this.notaDoRegime(r.regime, preferido));
    return linhas.join('\n');
  }

  // ----------------------------------------------------------
  // a conta entre duas pessoas
  // ----------------------------------------------------------
  /**
   * "Quanto a Ana me deve esse mês?"
   *
   * **Dívida não é mensal, e a resposta diz isso na primeira linha.** Ela é
   * acumulada: a Ana pode dever de outubro, e um acerto de dezembro abate
   * tudo. Responder só o mês diria "R$ 0,00" para quem tem R$ 800,00 em
   * aberto — certo sobre o mês e mentira sobre a dívida.
   *
   * Então o total em aberto vem primeiro, e o mês perguntado vem logo
   * abaixo, como detalhe: é ele que explica de onde o número veio.
   *
   * Sem nome na frase, é a lista de todo mundo com conta aberta — o topo da
   * tela de Compartilhadas.
   */
  private async responderDivida(userId: string, texto: string, ctx: any): Promise<string> {
    const resumo = await this.contaEntreNos.resumo(userId);
    if (!resumo.pessoas.length) {
      return (
        '👥 Você ainda não tem ninguém na lista de pessoas.\n\n' +
        'Para dividir um gasto, mande: "gastei 200 no mercado dividido com a Ana".'
      );
    }

    const quem = fala.acharPorNome(ctx.pessoas || [], fala.normalizarFala(texto));
    if (!quem) return this.dividaDeTodos(resumo);

    const linha = resumo.pessoas.filter((p: any) => p.personId === quem.id)[0];
    const saldo = linha ? Number(linha.saldo) : 0;
    const mes = mesDaPergunta(texto, diaDoUsuario());
    const preferido = await this.relatorio.regime(userId);
    const extrato = await this.contaEntreNos.extratoDaPessoa(
      userId,
      quem.id,
      mes,
      (regimeDaPergunta(texto) ?? preferido) as any,
    );

    const linhas = [this.comoEstaACconta(quem.nome, saldo), ''];

    linhas.push('📅 ' + this.rotuloMes(mes));
    const gastos = extrato.lancamentos.length;
    if (gastos) {
      const parteDela =
        Math.round((Number(extrato.totalDoMes) - Number(extrato.minhaParteNoMes)) * 100) / 100;
      linhas.push(
        '📉 ' + (gastos === 1 ? '1 gasto dividido' : gastos + ' gastos divididos') +
        ': ' + this.brl(Number(extrato.totalDoMes)) + ' no total · a parte de ' +
        quem.nome + ', ' + this.brl(parteDela),
      );
    } else {
      linhas.push('📉 Nenhum gasto dividido com ' + quem.nome + ' neste mês.');
    }
    if (extrato.acertos.length) {
      linhas.push(
        '🤝 ' + (extrato.acertos.length === 1 ? '1 acerto' : extrato.acertos.length + ' acertos') +
        ' neste mês.',
      );
    }
    /* O saldo que vinha de antes é o que explica a diferença entre a
     * primeira linha e o mês. Sem ele, quem vê "R$ 1.250,00 em aberto" e
     * "R$ 0,00 no mês" não tem como ligar os dois números. */
    if (Number(extrato.saldoAnterior) !== 0) {
      linhas.push(
        '📊 Antes deste mês ' +
        (Number(extrato.saldoAnterior) > 0 ? quem.nome + ' já devia ' : 'você já devia ') +
        this.brl(Math.abs(Number(extrato.saldoAnterior))) + '.',
      );
    }

    /* Acerto AGENDADO não mexe na dívida de hoje — o dinheiro não andou —,
     * mas já existe como lançamento previsto. Dizer os dois números evita
     * que a pessoa cobre de novo o que já está marcado para ser pago. */
    const emAberto = linha ? Number(linha.saldoEmAberto) : 0;
    if (emAberto !== saldo) {
      linhas.push('');
      linhas.push(
        '🕒 Com os acertos já agendados, sobra ' +
        (emAberto === 0
          ? 'zero.'
          : (emAberto > 0 ? quem.nome + ' devendo ' : 'você devendo ') +
            this.brl(Math.abs(emAberto)) + '.'),
      );
    }

    return linhas.join('\n');
  }

  /** Quem te deve e a quem você deve, numa linha cada — o topo da tela de
   * Compartilhadas. Só quem tem conta aberta: listar quem está quite seria
   * encher a resposta de zeros. */
  private dividaDeTodos(resumo: any): string {
    const abertas = resumo.pessoas.filter((p: any) => Number(p.saldo) !== 0);
    if (!abertas.length) {
      return '👥 Ninguém te deve nada, e você não deve a ninguém. Está tudo quite.';
    }
    const linhas = ['👥 Como está a conta com cada um', ''];
    abertas.forEach((p: any) => {
      const saldo = Number(p.saldo);
      linhas.push(
        '🧑 ' + p.name + ': ' +
        (saldo > 0 ? 'te deve ' + this.brl(saldo) : 'você deve ' + this.brl(-saldo)),
      );
    });
    linhas.push('');
    if (Number(resumo.aReceber)) linhas.push('📈 A receber: ' + this.brl(Number(resumo.aReceber)));
    if (Number(resumo.aPagar)) linhas.push('📉 A pagar: ' + this.brl(Number(resumo.aPagar)));
    return linhas.join('\n');
  }

  /** A primeira linha, que é a resposta da pergunta. O sinal decide a frase:
   * positivo é ela devendo, negativo sou eu. */
  private comoEstaACconta(nome: string, saldo: number): string {
    if (saldo === 0) return '👥 Você e ' + nome + ' estão quites.';
    return saldo > 0
      ? '👥 ' + nome + ' te deve ' + this.brl(saldo) + '.'
      : '👥 Você deve ' + this.brl(-saldo) + ' para ' + nome + '.';
  }

  /**
   * "Quanto tenho guardado nos meus objetivos hoje?" — a tela de Objetivos.
   *
   * **Os três números do topo da tela vêm com os rótulos da tela**, e sem
   * nunca serem somados entre si. Eles se parecem e são sobre conjuntos
   * diferentes: o guardado é dos objetivos EM ANDAMENTO, e o "aplicado das
   * contas" é de todos, concluídos incluídos. Apresentá-los como uma
   * repartição faria a conta não fechar na tela do lado — e quem compara os
   * dois acharia que um dos dois está errado.
   *
   * O que cada um responde, em uma linha: o guardado é o que a pessoa juntou;
   * o aplicado das contas é a parte que ainda é saldo dela (e é a única que o
   * "quanto tenho" soma); o saldo inicial é o que já era dela e nunca passou
   * por uma conta do app.
   */
  private async responderObjetivos(userId: string): Promise<string> {
    const r = await this.relatorio.objetivos(userId);

    if (!r.quantos) {
      return (
        '🎯 Você ainda não tem objetivo cadastrado.\n\n' +
        'No app, em Objetivos, você diz quanto quer juntar e até quando — e ' +
        'o app passa a dizer quanto falta por mês.'
      );
    }

    const linhas: string[] = [];
    if (r.ativos.length) {
      linhas.push('🎯 Guardado nos objetivos: ' + this.brl(r.guardado));
      linhas.push(
        r.ativos.length === 1
          ? '1 objetivo em andamento'
          : r.ativos.length + ' objetivos em andamento',
      );
      linhas.push('');
      // Cinco, como as maiores categorias: a lista é para reconhecer, e o
      // resto cabe no app.
      for (const o of r.ativos.slice(0, 5)) linhas.push(...this.linhasDoObjetivo(o));
      if (r.ativos.length > 5) {
        linhas.push('… e mais ' + (r.ativos.length - 5) + ' no app.');
      }
    } else {
      // Todos concluídos: dizer "R$ 0,00 guardado" seria verdade sobre os em
      // andamento e mentira sobre o esforço da pessoa.
      linhas.push('🎯 Nenhum objetivo em andamento agora.');
    }

    if (r.dasContas || r.inicial) {
      linhas.push('');
      linhas.push('De onde vem o guardado');
      if (r.dasContas) {
        linhas.push(
          '💰 Aplicado das contas: ' + this.brl(r.dasContas) +
          ' — saiu de uma conta e continua no seu saldo.',
        );
      }
      if (r.inicial) {
        linhas.push(
          '🪙 Saldo inicial: ' + this.brl(r.inicial) +
          ' — dinheiro que já era seu, fora das contas.',
        );
      }
    }

    if (r.concluidos.length) {
      linhas.push('');
      const nomes = r.concluidos.slice(0, 3).map((o) => o.nome).join(', ');
      linhas.push(
        '✅ ' + (r.concluidos.length === 1 ? '1 objetivo concluído' : r.concluidos.length + ' objetivos concluídos') +
        ': ' + nomes + (r.concluidos.length > 3 ? ' e outros.' : '.'),
      );
    }

    return linhas.join('\n');
  }

  /** Um objetivo em duas linhas: onde ele está, e o que falta para chegar.
   *
   * O "por mês" só aparece quando ainda dá tempo. Depois do prazo ele seria
   * um número inventado — `mesesAteOPrazo` nunca desce de 1, então o valor
   * passaria a ser "tudo o que falta, neste mês", que não é um plano. */
  private linhasDoObjetivo(o: LinhaDeObjetivo): string[] {
    const cabeca =
      '🏷️ ' + o.nome + ': ' + this.brl(o.guardado) + ' de ' + this.brl(o.meta) +
      ' (' + o.pct + '%)';
    if (o.falta <= 0) return [cabeca, '   Meta alcançada 🎉'];
    if (o.atrasado) {
      return [
        cabeca,
        '   Faltam ' + this.brl(o.falta) + ' · o prazo venceu em ' + this.dataBR(o.prazo),
      ];
    }
    return [
      cabeca,
      '   Faltam ' + this.brl(o.falta) + ' · ' + this.brl(o.mensal) +
      ' por mês até ' + this.dataBR(o.prazo),
    ];
  }

  /**
   * "Quanto ainda posso gastar com alimentação neste mês?" — o planejamento
   * do mês e o quanto dele já foi usado, pela conta da tela de Planejamento.
   *
   * Três respostas, porque são três situações diferentes:
   *
   *   - **sem planejamento no mês**: não existe resposta numérica, e inventar
   *     uma seria o pior resultado. A resposta diz que falta o teto e oferece
   *     o que a tela oferece — copiar de um mês já planejado, ou começar do
   *     zero;
   *   - **com a categoria nomeada**: meta, usado e o que ainda cabe. Se a
   *     categoria não tem meta própria mas a pai tem, é a meta da pai que
   *     limita aquele gasto, e é ela que vem;
   *   - **sem categoria**: o mês inteiro, com as metas linha por linha.
   *
   * O nome da categoria sai da frase pela MESMA porta do lançamento
   * (`acharPorNome`), e sem o filtro de "lançável": a categoria pai é
   * justamente a que mais costuma carregar a meta, e ela não recebe
   * lançamento direto quando tem filhas.
   *
   * O previsto conta — é o padrão da tela —, e a resposta diz isso. Um teto
   * que ignora a parcela do cartão e a conta agendada deste mês afirma que
   * cabe dinheiro que já está comprometido, que é o erro que mais custa caro
   * nesta pergunta.
   */
  private async responderMeta(userId: string, texto: string, ctx: any): Promise<string> {
    const mes = mesDaPergunta(texto, diaDoUsuario());
    const preferido = await this.relatorio.regime(userId);
    const pedido = regimeDaPergunta(texto);
    const cat = fala.acharPorNome(
      (ctx.categorias || []).filter((c: any) => c.tipo === 'EXPENSE'),
      fala.normalizarFala(texto),
    );
    const r = await this.relatorio.planoDoMes(
      userId,
      mes,
      pedido ?? preferido,
      cat ? cat.id : null,
    );

    if (!r.temPlano) {
      const outros = r.planejados.filter((m) => m !== mes);
      return (
        '🎯 Planejamento de ' + this.rotuloMes(mes) + '\n\n' +
        // Sem "neste mês": o mês já está no cabeçalho, e a pergunta pode ser
        // sobre outro — "este" apontaria para o mês de hoje.
        'Você ainda não definiu um teto, então não tenho com o que comparar os ' +
        'seus gastos.\n\n' +
        (outros.length
          ? 'No app, em Planejamento, dá para copiar o de ' + this.rotuloMes(outros[0]) +
            ' ou começar do zero.'
          : 'No app, em Planejamento, você diz quanto quer gastar no mês e reparte ' +
            'esse teto entre as categorias que quer acompanhar de perto.')
      );
    }

    const rodape = [this.notaDoRegime(r.regime, preferido), this.notaDosFiltros(r.filtros)];
    // A procedência vem ANTES dos números, e não no rodapé: ela muda como se
    // lê um "passou do teto", e lida depois do veredito já chegou tarde.
    const heranca = this.notaDaHeranca(r.herdadoDe);

    // ---- uma categoria ----
    if (r.categoria) {
      const c = r.categoria;
      const linhas = ['🎯 ' + c.nome + ' em ' + this.rotuloMes(mes), ''];
      if (heranca) linhas.push(heranca, '');

      if (c.temMeta) {
        linhas.push('🏷️ Meta: ' + this.brl(c.meta));
        linhas.push('📉 Já usou: ' + this.brl(c.gasto) + ' (' + c.pct + '%)');
        linhas.push(
          c.resta >= 0
            ? '✅ Ainda cabem: ' + this.brl(c.resta)
            : '🔺 Passou em: ' + this.brl(-c.resta),
        );
        if (c.filhas) {
          linhas.push('');
          linhas.push('🧩 Somando as subcategorias de ' + c.nome + '.');
        }
      } else {
        linhas.push(c.nome + ' não tem meta neste planejamento.');
        linhas.push('📉 Já usou: ' + this.brl(c.gasto));
        linhas.push('');
        if (r.paiComMeta) {
          // A filha está DENTRO da pai: é a meta da pai que limita este gasto.
          linhas.push('Esse gasto entra em ' + r.paiComMeta.nome + ', que tem meta:');
          linhas.push('🏷️ ' + this.linhaDoPlano(r.paiComMeta));
        } else {
          const outras = r.linhas.filter((l) => l.outras)[0];
          linhas.push('Ela entra no que sobrou do teto, junto com as outras sem meta:');
          if (outras) linhas.push('🏷️ ' + this.linhaDoPlano(outras));
        }
      }

      linhas.push('');
      linhas.push('💵 No mês: ' + this.textoDoTeto(r));
      linhas.push('');
      linhas.push(...rodape);
      return linhas.join('\n');
    }

    // ---- o mês inteiro ----
    const linhas = ['🎯 Planejamento de ' + this.rotuloMes(mes), ''];
    if (heranca) linhas.push(heranca, '');
    if ((r.teto ?? 0) <= 0) {
      // A mesma frase da tela quando o teto é zero: sem teto não há
      // porcentagem nem sobra, e mostrar "0%" seria dizer que está tudo bem.
      linhas.push('Nenhum teto definido para o mês.');
      linhas.push('📉 Já gastou: ' + this.brl(r.gasto ?? 0));
    } else {
      linhas.push('💵 Teto: ' + this.brl(r.teto ?? 0));
      linhas.push('📉 Já usou: ' + this.brl(r.gasto ?? 0) + ' (' + r.pct + '%)');
      linhas.push(
        (r.resta ?? 0) >= 0
          ? '✅ Ainda cabem: ' + this.brl(r.resta ?? 0)
          : '🔺 Passou em: ' + this.brl(-(r.resta ?? 0)),
      );
    }

    // A receita, que é a outra metade do planejamento: o teto foi repartido
    // contando com um dinheiro que ia entrar, e "ainda cabem R$ 1.850" só
    // vale se ele entrou. A tela mostra os dois lado a lado pelo mesmo
    // motivo.
    if ((r.receitaEsperada ?? 0) > 0 || (r.receitaLancada ?? 0) > 0) {
      linhas.push('');
      linhas.push(
        '📈 Receitas: ' + this.brl(r.receitaLancada ?? 0) +
          ((r.receitaEsperada ?? 0) > 0
            ? ' · você esperava ' + this.brl(r.receitaEsperada ?? 0)
            : ''),
      );
    }

    // As metas, na ordem da tela: a pai, a filha logo abaixo dela, e "outras
    // categorias" fechando a conta.
    const metas = r.linhas.slice(0, 6);
    if (metas.length) {
      linhas.push('');
      for (const l of metas) {
        linhas.push((l.filha ? '   ↳ ' : '🏷️ ') + this.linhaDoPlano(l));
      }
      if (r.linhas.length > metas.length) {
        linhas.push('… e outras ' + (r.linhas.length - metas.length) + ' metas.');
      }
    }

    linhas.push('');
    linhas.push(...rodape);
    return linhas.join('\n');
  }

  /** Uma meta em uma linha: nome, usado, teto e o que ainda cabe. "de" em vez
   * de "/" porque é como a tela escreve ("de R$ 800,00 planejados"). */
  private linhaDoPlano(l: LinhaDoPlano): string {
    const fim =
      l.meta <= 0
        ? (l.gasto > 0 ? ' · sem meta' : '')
        : l.resta >= 0
          ? ' · cabem ' + this.brl(l.resta)
          : ' · passou ' + this.brl(-l.resta);
    return l.nome + ': ' + this.brl(l.gasto) + ' de ' + this.brl(l.meta) + fim;
  }

  /** O mês inteiro em uma linha, com as palavras da tela. */
  private textoDoTeto(r: PlanoDoMes): string {
    const teto = r.teto ?? 0;
    const gasto = r.gasto ?? 0;
    const resta = r.resta ?? 0;
    if (teto <= 0) return this.brl(gasto) + ' gastos, sem teto definido';
    return (
      this.brl(gasto) + ' de ' + this.brl(teto) + ' planejados · ' +
      (resta >= 0 ? 'ainda cabem ' + this.brl(resta) : 'passou ' + this.brl(-resta))
    );
  }

  /**
   * De onde veio o teto, quando não foi decidido no mês perguntado.
   *
   * O planejamento segue para a frente sozinho: um mês sem decisão própria
   * usa a decisão mais recente, porque a compra no cartão de hoje já pesa num
   * mês lá na frente e um mês sem teto não tem resposta nenhuma. Mas aí a
   * meta não é a desta pessoa PARA ESTE MÊS, e um "passou em R$ 1.200,00"
   * sem essa linha seria uma acusação sem procedência — e o que falta não é
   * cortar gasto, é decidir o mês.
   */
  private notaDaHeranca(de?: string | null): string {
    if (!de) return '';
    return '📋 Teto herdado de ' + this.rotuloMes(de) + ', que se repetiu até aqui.';
  }

  /** O que entrou na conta do planejamento, nas palavras dos três botões da
   * tela. Vai na resposta porque é o que permite conferir o número lá: sem
   * saber que o previsto está dentro, a pessoa procura a diferença no lugar
   * errado. */
  private notaDosFiltros(f?: { previsto: boolean; cartao: boolean; ocultas: boolean }): string {
    if (!f) return '';
    const partes = [
      f.previsto ? 'confirmado e previsto' : 'só o confirmado',
      f.cartao ? 'com os gastos no cartão' : 'sem os gastos no cartão',
    ];
    if (f.ocultas) partes.push('incluindo contas ocultas');
    return '💡 Contando ' + partes.join(', ') + ' — como a tela de Planejamento abre.';
  }

  private async responderResultado(userId: string, texto: string): Promise<string> {
    const mes = mesDaPergunta(texto, diaDoUsuario());
    // A preferência é lida sempre, e não só quando a frase cala: é dela que a
    // resposta precisa para avisar que o regime pedido vale SÓ ali. Sem esse
    // aviso, a pessoa veria "contado pela data da compra" e teria motivo para
    // achar que a pergunta mudou a configuração dela.
    const preferido = await this.relatorio.regime(userId);
    const pedido = regimeDaPergunta(texto);
    const r = await this.relatorio.doMes(userId, mes, pedido ?? preferido);

    if (r.vazio) {
      return (
        '📊 ' + this.rotuloMes(mes) + '\n\nSem movimento neste mês.' +
        '\n\n' + this.notaDoRegime(r.regime, preferido)
      );
    }

    const sobrou = r.resultado >= 0;
    const linhas = [
      '📊 Resultado de ' + this.rotuloMes(mes),
      '',
      '📈 Receitas: ' + this.brl(r.entradas),
      '📉 Despesas: ' + this.brl(r.saidas),
      (sobrou ? '✅ Sobrou: ' : '🔻 Faltou: ') + this.brl(Math.abs(r.resultado)),
    ];

    // As faturas, uma a uma: é a linha que mais surpreende quem olha o
    // número do mês, porque ela não é um gasto que a pessoa fez hoje — é a
    // soma das compras de um cartão chegando para pagar.
    if (r.faturas.length) {
      linhas.push('');
      for (const f of r.faturas.slice(0, 4)) {
        linhas.push(
          '💳 ' + f.cartao + ' (fatura ' + this.mesBR(f.referencia) + ', ' +
          f.situacao.toLowerCase() + '): ' + this.brl(Math.abs(f.valor)),
        );
      }
      if (r.faturas.length > 4) {
        linhas.push('… e outras ' + (r.faturas.length - 4) + ' faturas.');
      }
    }

    linhas.push('');
    linhas.push(
      '🧾 ' + r.lancamentos + (r.lancamentos === 1 ? ' lançamento' : ' lançamentos') +
      ', previstos incluídos.',
    );
    linhas.push(this.notaDoRegime(r.regime, preferido));
    return linhas.join('\n');
  }

  /**
   * As faturas que vencem no mês, uma por cartão, com o total.
   *
   * Cada linha traz o mês DA FATURA e o dia do VENCIMENTO, porque as duas
   * podem ser de meses diferentes: num cartão que fecha 25 e vence 5, a
   * fatura de outubro é cobrada em novembro. Sem as duas datas, a pessoa
   * confere o número contra o mês errado e acha que o app errou.
   *
   * O total vem por último, como no saldo: primeiro as linhas que alguém
   * consegue conferir, depois a soma delas.
   */
  private async responderFaturas(userId: string, texto: string, ctx: any): Promise<string> {
    const mes = mesDaPergunta(texto, diaDoUsuario());
    // O cartão nomeado sai da frase pela MESMA porta do lançamento
    // (`acharPorNome`, do recorte): "qual a fatura do Nubank" reconhece o
    // apelido como "gastei 30 no Nubank" reconhece. Uma segunda regra de
    // apelido aqui faria o mesmo nome valer num lugar e não valer no outro.
    const cartao = fala.acharPorNome(ctx.cartoes, fala.normalizarFala(texto));
    const r = await this.relatorio.faturasDoMes(userId, mes);

    if (!r.cartoes) {
      return 'Você não tem cartão cadastrado. Crie um no app, em Cartões.';
    }

    // Um cartão nomeado: só ele. Como cada cartão tem no máximo uma fatura
    // vencendo num mês, a resposta é uma linha — e um "Total" repetindo essa
    // mesma linha logo abaixo dela não informa nada.
    if (cartao) {
      const dele = r.faturas.filter((f) => f.cartaoId === cartao.id);
      if (!dele.length) {
        return '💳 ' + cartao.nome + ' não tem fatura vencendo em ' + this.rotuloMes(mes) + '.';
      }
      return (
        '💳 ' + cartao.nome + ' — fatura que vence em ' + this.rotuloMes(mes) + '\n\n' +
        this.linhaDeFatura(dele[0], false)
      );
    }

    if (!r.faturas.length) {
      return (
        '💳 Nenhuma fatura vence em ' + this.rotuloMes(mes) + '.' + '\n' +
        'Nenhuma compra sua caiu numa fatura que seja cobrada neste mês.'
      );
    }

    const linhas = ['💳 Faturas que vencem em ' + this.rotuloMes(mes), ''];
    for (const f of r.faturas) linhas.push(this.linhaDeFatura(f, true));
    linhas.push('');
    linhas.push('🧾 Total: ' + this.brl(r.total));
    return linhas.join('\n');
  }

  /** Uma fatura em uma linha. `comNome` só quando a lista tem mais de um
   * cartão — com o cartão já no cabeçalho, repetir o nome em cada linha é
   * ruído. */
  private linhaDeFatura(f: LinhaDeFatura, comNome: boolean): string {
    return (
      (comNome ? f.cartao + ' — fatura ' : 'Fatura ') +
      this.mesBR(f.referencia) + ', ' + f.situacao.toLowerCase() + ': ' +
      this.brl(Math.abs(f.valor)) + ' (vence ' + this.dataBR(f.vencimento) + ')'
    );
  }

  /** O regime, em uma linha — e no vocabulário das Configurações. */
  private notaDoRegime(usado: string, preferido: string): string {
    const porCompra = usado === 'compra';
    if (usado !== preferido) {
      // Pedido na frase: a linha diz que foi só aqui, e qual continua sendo a
      // escolha — o aviso vale mais que a explicação do regime, que a pessoa
      // acabou de dar.
      return (
        '🧮 Contado pel' + (porCompra ? 'a data da compra' : 'o vencimento da fatura') +
        ', só nesta resposta. Nas Configurações a sua escolha continua sendo ' +
        (preferido === 'compra' ? 'a data da compra' : 'o vencimento da fatura') + '.'
      );
    }
    return porCompra
      ? '🧮 Contado pela data da compra, como você escolheu nas Configurações.'
      : '🧮 Contado pelo vencimento da fatura: compra no cartão pesa no mês em que a fatura vence.';
  }

  /** "Novembro 2026" — como a tela escreve, pela tabela da tela. */
  private rotuloMes(chave: string): string {
    const p = String(chave).split('-');
    return fala.MESES[Number(p[1]) - 1] + ' ' + p[0];
  }

  // ----------------------------------------------------------
  // o contexto, traduzido do banco
  // ----------------------------------------------------------
  /** As listas do dono da mensagem, no formato que a leitura espera.
   *
   * A tradução vive aqui, na fronteira, como no app: lá dentro tudo fala
   * conta, cartão e categoria; o banco fala `bankAccount`, `creditCard` e
   * `category`. */
  async contextoDoUsuario(userId: string) {
    const [contas, cartoes, categorias, regras, viradas, objetivos, pessoas] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { userId } }),
      this.prisma.creditCard.findMany({ where: { userId }, include: { cycles: { orderBy: { validFrom: 'asc' } } } }),
      this.prisma.category.findMany({
        where: { OR: [{ userId }, { userId: null }] },
      }),
      this.prisma.categoryRule.findMany({ where: { userId } }),
      // As faturas VIRADAS: sem elas, a compra lançada pelo WhatsApp cairia na
      // fatura que o calendário indica, enquanto a tela — que conhece a virada
      // — mostraria a seguinte. A mesma compra em dois lugares diferentes.
      this.prisma.creditCardInvoice.findMany({
        where: { creditCard: { userId }, earlyClosedAt: { not: null } },
        select: { creditCardId: true, referenceMonth: true, earlyClosedAt: true },
      }),
      this.prisma.goal.findMany({
        where: { userId },
        select: { id: true, name: true, accountId: true, completedAt: true },
      }),
      /* As pessoas com quem se divide gasto. Só as ATIVAS: dividir um gasto
       * novo com quem foi arquivada é reabrir uma conta encerrada — a mesma
       * regra do formulário, que usa `cpAtivas()`. */
      this.prisma.person.findMany({
        where: { userId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);

    const viradasDoCartao: Record<string, Record<string, string>> = {};
    for (const v of viradas) {
      (viradasDoCartao[v.creditCardId] ??= {})[chaveDoMes(v.referenceMonth)] = dia(v.earlyClosedAt!);
    }

    // Sem `any` nos parâmetros, de propósito: o tipo vem do Prisma, e foi um
    // `any` aqui que deixou passar `c.name` numa tabela cujo campo se chama
    // `institutionName` — conta nenhuma era achada, e o teste não viu porque o
    // mock tinha sido escrito com a mesma crença errada.
    return {
      contas: contas.map((c) => ({
        id: c.id,
        nome: c.institutionName,
        isActive: c.isActive,
      })),
      // `fechamento` vai junto porque a leitura precisa dele para escolher a
      // fatura da compra — a mesma conta que a tela faz.
      cartoes: cartoes.map((k) => ({
        id: k.id,
        nome: k.name,
        contaId: k.bankAccountId,
        fechamento: k.closingDay,
        viradas: viradasDoCartao[k.id] ?? {},
        // A linha do tempo do ciclo, no formato que a leitura do app usa. Sem
        // ela, uma compra lançada pelo WhatsApp num cartão que mudou de
        // vencimento cairia na fatura que o par de HOJE indica, enquanto a
        // tela — que conhece os períodos — mostraria outra.
        ciclos: k.cycles.map((c) => ({
          inicio: chaveDoMes(c.validFrom),
          fechamento: c.closingDay,
          vencimento: c.dueDay,
        })),
      })),
      categorias: categorias.map((c) => ({
        id: c.id,
        nome: c.name,
        tipo: c.type,
        paiId: c.parentId || null,
      })),
      regras: regras.map((r) => ({
        lojista: r.merchant,
        categoriaId: r.categoryId,
      })),
      /* Os objetivos entram porque a frase pode mover dinheiro para dentro de
       * um ("apliquei 500 na viagem"), e o nome dito só vira id com a lista
       * na mão. `contaId` é a conta sugerida do objetivo — é o que evita
       * perguntar de qual conta sai quando a pessoa já escolheu uma.
       *
       * O GUARDADO não vem aqui: ele é a soma dos movimentos sobre o saldo
       * inicial, e calculá-lo nesta consulta seria uma segunda implementação
       * da regra que o `GoalsService` já tem. Quem trava o resgate é ele, e a
       * conversa repassa a frase dele. */
      objetivos: objetivos.map((o) => ({
        id: o.id,
        nome: o.name,
        contaId: o.accountId,
        concluidoEm: o.completedAt ? dia(o.completedAt) : null,
      })),
      /* `nome`, e não `name`: a leitura procura pessoa pelo mesmo campo com
       * que procura conta, cartão e categoria. */
      pessoas: pessoas.map((p) => ({ id: p.id, nome: p.name })),
      // O dia é o de quem falou, não o do servidor — ver `diaDoUsuario`.
      hoje: diaDoUsuario(),
    };
  }

  // ----------------------------------------------------------
  // o texto da resposta
  // ----------------------------------------------------------
  /* As figuras ficam onde ajudam a BATER O OLHO e reconhecer: o banco, o
   * cartão, e se o dinheiro já andou. Não há uma em cada linha de propósito —
   * emoji em tudo vira enfeite, e enfeite em toda linha não destaca nenhuma. */
  private resumo(r: any, ctx: any): string {
    const linhas = [
      // 📈/📉 são o mesmo par que a resposta de resultado usa para
      // Receitas/Despesas: o mesmo símbolo quer dizer a mesma coisa nas duas.
      r.tipo === 'INCOME' ? '📈 Receita' : '📉 Despesa',
      // Parcelado são dois números a conferir: o de cada parcela e o que vai
      // ser devido no fim. Mostrar um só deixa metade da conta para a cabeça
      // de quem lê.
      '💵 Valor: ' + this.brl(r.valor) + (r.parcelas ? ' por parcela' : ''),
      '📝 Descrição: ' + (r.desc || '—'),
    ];
    if (r.parcelas) {
      // O centavo da divisão torta é dito, e não escondido: R$ 20,00 em 3x
      // dá parcelas de 6,67 que somam 20,01. A série tem um valor só, então
      // o total REAL é esse — mostrar 20,00 aqui seria prometer um número
      // que o extrato depois não teria.
      const sobra = r.valorDito
        ? ' (' + this.brl(r.valorDito) + ' não divide certo por ' + r.parcelas + ')'
        : '';
      linhas.push(
        '🔢 Parcelas: ' + r.parcelas + 'x — total ' + this.brl(r.valorTotal) + sobra,
      );
    }
    const cartao = ctx.cartoes.find((k: any) => k.id === r.cartaoId);
    const conta = ctx.contas.find((c: any) => c.id === r.contaId);
    linhas.push(
      (cartao ? '💳 Cartão: ' : '🏦 Conta: ') +
        (cartao?.nome || conta?.nome || '—'),
    );
    const cat = ctx.categorias.find((c: any) => c.id === r.categoriaId);
    linhas.push(
      '🏷️ Categoria: ' +
        (cat?.nome || '—') +
        (r.categoriaDoLojista ? ' (do lojista)' : ''),
    );
    // "2026-12" é chave, não data: quem lê quer o mês.
    //
    // A nota fiscal (🧾) é a fatura, e não as parcelas: no lançamento
    // parcelado as duas linhas aparecem juntas, e é a fatura que ela nomeia.
    if (r.cartaoId && r.faturaMes)
      linhas.push('🧾 Fatura: ' + this.mesBR(r.faturaMes));
    linhas.push('📅 Data: ' + this.dataBR(r.data));
    linhas.push(
      r.confirmada ? '✅ Situação: confirmado' : '🕒 Situação: previsto',
    );
    /* A repetição vem antes da divisão: ela muda o que a divisão significa
     * ("R$ 1.250,00 por mês" em vez de "R$ 1.250,00"). */
    if (r.repeticao && r.repeticao.quantas) {
      linhas.push(
        '🔁 Repete: ' + r.repeticao.quantas + 'x ' + this.comQueFrequencia(r.repeticao.freq) +
        ' · ' + this.brl(r.valor) + ' cada vez · total ' +
        this.brl(Math.round(r.valor * r.repeticao.quantas * 100) / 100),
      );
    }
    /* A divisão entra no MESMO resumo, e não num recado à parte: é um gasto
     * só, e quem confere o valor precisa ver, na mesma tela, quanto dele
     * sobra para si. */
    linhas.push(...this.linhasDaDivisao(r).linhas);
    return linhas.join('\n');
  }

  /**
   * Os nomes que a frase podia ter dito.
   *
   * "Faltou destino" sozinho é um beco sem saída: quem está no WhatsApp não
   * tem a tela à mão e não lembra se cadastrou "Itaú" ou "Itaú Corrente".
   * Dizer a lista transforma a recusa em resposta.
   *
   * Categoria fica de fora de propósito: são dezenas, e uma parede de texto no
   * lugar de um recado curto não ajuda ninguém — para ela o caminho é a regra
   * de lojista, que aprende sozinha.
   */
  /**
   * O recado quando a categoria não saiu da frase.
   *
   * Antes daqui, a resposta só dizia "Faltou categoria" — e quem tinha dito
   * "categoria doação" sem ter criado a categoria recebia exatamente isso,
   * repetia a mesma frase e recebia de novo, sem nunca saber que o nome dito
   * não existia. O destino já tinha essa cortesia ("Suas contas: …"); a
   * categoria não.
   *
   * Lançar por aqui não CRIA categoria de propósito: cadastro é no app, onde
   * se escolhe tipo, cor e categoria mãe. Mas isso só se sustenta se a
   * resposta mandar a pessoa para lá, em vez de calar.
   *
   * A lista respeita o tipo e a regra de "lançável" do app (categoria mãe com
   * filhas não recebe lançamento), porque é a mesma função da tela.
   */
  /**
   * A frase nomeou um cartão que não existe. Aqui a conversa ganha um passo a
   * mais, e ele não é capricho: cartão precisa de FECHAMENTO e VENCIMENTO, e
   * esses dois dias decidem em qual fatura cada compra cai e quando ela
   * vence. Criar com um palpite seria plantar um erro que só aparece meses
   * depois, numa fatura com a data errada.
   *
   * A pergunta é sempre uma, e sempre a mesma. Cheguei a aceitar os dias na
   * própria frase ("no cartão C6 que fecha dia 1 e vence dia 10"), e medi o
   * estrago: "dia 1" vira a DATA da compra pelo leitor de sempre, o
   * lançamento nascia previsto para 01/12, e o nome do cartão saía "C6 bank
   * que fecha". Duas gramáticas disputando as mesmas palavras. O atalho valia
   * uma mensagem a menos; não vale uma data errada.
   *
   * O limite é opcional, e a pergunta DIZ que ele cabe ali: aceitar sem
   * contar seria uma opção que não existe para quem lê. Omitido, nasce zero —
   * que se corrige no app a qualquer hora, e cujo único efeito é o
   * "disponível" aparecer negativo até lá.
   */
  private ofereceCriarCartao(userId: string, r: any, ctx: any): Resposta | null {
    if (!r.cartaoDito) return null;
    if (r.faltando.length !== 1 || !r.faltando.includes('destino')) return null;

    const existente = fala.acharPorNome(ctx.cartoes, fala.normalizarFala(r.cartaoDito));
    if (existente) {
      r.cartaoId = existente.id;
      r.faltando = [];
      r.faturaMes = fala.monthKey(fala.faturaSugerida(r.data, existente));
      this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
      return { texto: this.resumo(r, ctx) + '\n\nConfirma?', confirmar: true };
    }

    this.rascunhos.set(userId, {
      lancamento: r,
      criadoEm: Date.now(),
      cartaoNovo: { nome: r.cartaoDito },
    });
    return { texto: this.pedidoDoCartao(r.cartaoDito) };
  }

  /**
   * A resposta com os dois dias. Primeiro número é fechamento, segundo é
   * vencimento — a ordem em que a pergunta os pede.
   *
   * Não entendendo, a pergunta se repete em vez de o rascunho morrer: quem
   * respondeu errado uma vez quase sempre acerta na segunda, e perder o
   * lançamento inteiro por causa disso seria cobrar caro demais.
   */
  private async lerDiasDoCiclo(userId: string, rascunho: Rascunho, texto: string): Promise<Resposta> {
    if (NAO.test(texto)) {
      this.rascunhos.delete(userId);
      return { texto: 'Ok, não lancei nada.' };
    }

    // O limite sai da frase ANTES dos dias, e some dela: "limite 5000" tem
    // um número que não é dia nenhum, e deixá-lo ali faria "50" disputar
    // lugar com o fechamento.
    const limite = this.limiteDaResposta(texto);
    const semLimite = fala.normalizarFala(texto).replace(RE_LIMITE, ' ');

    const numeros = (semLimite.match(/\d{1,2}/g) || []).map(Number).filter((d) => d >= 1 && d <= 31);
    const nome = rascunho.cartaoNovo!.nome;
    if (numeros.length < 2) {
      return { texto: this.pedidoDoCartao(nome, true) };
    }

    return this.comContexto(userId, (ctx) =>
      this.cartaoParaConfirmar(userId, rascunho.lancamento, ctx, nome, {
        fechamento: numeros[0],
        vencimento: numeros[1],
        limite,
      }),
    );
  }

  /**
   * O limite, quando a resposta o traz: "1 e 10, limite 5000".
   *
   * Ele tem de vir NOMEADO. Sem a palavra "limite", "1, 10 e 20" seria um
   * cartão de limite vinte ou um vencimento no dia 20 — e adivinhar entre as
   * duas é escolher qual erro cometer. O valor passa pelo mesmo leitor de
   * dinheiro da frase, então "limite de 5 mil" e "limite R$ 5.000,00" valem
   * igual.
   */
  private limiteDaResposta(texto: string): number | undefined {
    const m = RE_LIMITE.exec(fala.normalizarFala(texto));
    if (!m) return undefined;
    const valor = fala.valorDaFala(m[1]);
    return valor && valor > 0 ? valor : undefined;
  }

  /**
   * O pedido dos dias do cartão, nas duas vezes em que ele aparece: a
   * primeira e a repetição de quem respondeu outra coisa.
   *
   * Uma marca por linha, como no resumo que antecede o "sim" — é a mesma
   * pessoa lendo as duas coisas no mesmo lugar, e um bloco com marca e outro
   * sem fariam o app parecer dois apps. O exemplo fica em linha própria
   * porque é ele que vai ser copiado.
   */
  private pedidoDoCartao(nome: string, repetindo = false): string {
    const abertura = repetindo
      ? 'Não entendi os dias. Preciso de dois números de 1 a 31.'
      : 'Não encontrei esse cartão cadastrado.';
    return [
      '💳 Cartão ' + nome,
      '',
      abertura,
      '',
      'Para criar, preciso de duas informações:',
      '',
      '📅 Dia do fechamento da fatura',
      '📆 Dia do vencimento da fatura',
      '',
      '👉 Responda com os dois dias, nessa ordem. Exemplo:',
      '',
      '1 e 10',
      '',
      '💰 Se quiser, informe também o limite:',
      '',
      '1 e 10, limite 5000',
      ...(repetindo ? ['', 'Ou responda “não” para desistir.'] : []),
    ].join('\n');
  }

  /** O contexto do usuário, recarregado. O rascunho guarda o LANÇAMENTO, e
   * não as listas do dono: elas podem ter mudado entre uma mensagem e a
   * seguinte, e guardá-las seria responder com um retrato velho. */
  private async comContexto(userId: string, usar: (ctx: any) => Resposta): Promise<Resposta> {
    return usar(await this.contextoDoUsuario(userId));
  }

  /** O resumo com o cartão que ainda vai nascer, e a fatura que a data dele
   * indica — calculada com os dias que a pessoa acabou de dizer. */
  private cartaoParaConfirmar(
    userId: string,
    r: any,
    ctx: any,
    nome: string,
    dias: { fechamento: number; vencimento: number; limite?: number },
  ): Resposta {
    const futuro = { id: 'novo', nome, fechamento: dias.fechamento, vencimento: dias.vencimento, ciclos: [] };
    r.cartaoId = 'novo';
    r.faltando = [];
    r.faturaMes = fala.monthKey(fala.faturaSugerida(r.data, futuro));

    const comOCartao = { ...ctx, cartoes: [...ctx.cartoes, futuro] };
    this.rascunhos.set(userId, {
      lancamento: r,
      criadoEm: Date.now(),
      cartaoNovo: {
        nome,
        fechamento: dias.fechamento,
        vencimento: dias.vencimento,
        limite: dias.limite ?? 0,
      },
    });
    return {
      texto:
        this.resumo(r, comOCartao) +
        '\n\nCriar o cartão ' + nome +
        ' (fecha dia ' + dias.fechamento + ', vence dia ' + dias.vencimento +
        ', limite ' + this.brl(dias.limite ?? 0) + ') e lançar?',
      confirmar: true,
    };
  }

  /**
   * A frase nomeou uma conta que não existe: ofereço criar, como na categoria.
   *
   * As mesmas quatro condições de lá, e uma a mais que é só daqui: a conta
   * nasce com **saldo zero**, e isso a resposta diz com todas as letras. Conta
   * tem número, categoria não — criar uma sem perguntar o saldo e ficar calado
   * sobre isso deixaria o saldo geral errado sem ninguém saber de onde veio.
   * Perguntar o saldo aqui, por outro lado, seria mais uma pergunta no meio de
   * um lançamento; o app é onde isso se ajusta, e a frase diz isso.
   *
   * Cartão não entra: ele precisa de limite, fechamento e vencimento, três
   * números que ninguém dita de passagem e dos quais a fatura inteira depende.
   */
  private ofereceCriarConta(userId: string, r: any, ctx: any): Resposta | null {
    if (!r.contaDita) return null;
    if (r.faltando.length !== 1 || !r.faltando.includes('destino')) return null;

    const existente = fala.acharPorNome(
      ctx.contas.filter((c: any) => c.isActive !== false),
      fala.normalizarFala(r.contaDita),
    );
    if (existente) {
      r.contaId = existente.id;
      r.faltando = [];
      this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
      return { texto: this.resumo(r, ctx) + '\n\nConfirma?', confirmar: true };
    }

    this.rascunhos.set(userId, {
      lancamento: r,
      criadoEm: Date.now(),
      contaNova: { nome: r.contaDita },
    });
    return {
      texto:
        this.resumo(r, ctx) +
        '\n\nVocê ainda não tem a conta ' +
        r.contaDita +
        '. Criar (conta corrente, saldo R$ 0,00) e lançar?',
      confirmar: true,
    };
  }

  /**
   * A frase nomeou uma categoria que não existe: ofereço criar, em vez de
   * mandar a pessoa para o app.
   *
   * Quatro condições, e cada uma tira um jeito de isso dar errado:
   *
   *   1. a categoria tem de ter sido DITA ("categoria doação"). O nome sai de
   *      `categoriaDaFala`, que só olha o pedaço logo depois da palavra
   *      "categoria" — sem isso, cada lojista desconhecido viraria categoria;
   *   2. ela tem de ser a ÚNICA coisa faltando. Faltando valor ou destino, a
   *      pergunta é outra, e empilhar duas perguntas numa resposta só é o que
   *      faz ninguém responder nenhuma;
   *   3. o nome não pode ser de uma categoria que já existe, comparado sem
   *      acento e sem maiúscula — é o mesmo `acharPorNome` do lançamento. Sem
   *      isso, "alimentacao" criaria a gêmea de "Alimentação";
   *   4. nada é gravado agora. O que sai daqui é uma PERGUNTA; a categoria
   *      nasce no "sim", junto com o lançamento.
   *
   * O tipo vem do lançamento, como no formulário: categoria de receita não
   * nasce dentro de uma despesa.
   */
  private ofereceCriarCategoria(userId: string, r: any, ctx: any): Resposta | null {
    if (!r.categoriaDita) return null;
    if (r.faltando.length !== 1 || !r.faltando.includes('categoria')) return null;

    // A comparação é a mesma do lançamento, e de propósito: o que a leitura
    // reconhece como "é esta categoria" não pode divergir do que aqui conta
    // como "já existe".
    const existente = fala.acharPorNome(
      fala.categoriasLancaveis(r.tipo, ctx.categorias),
      fala.normalizarFala(r.categoriaDita),
    );
    if (existente) {
      r.categoriaId = existente.id;
      r.faltando = [];
      this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
      return { texto: this.resumo(r, ctx) + '\n\nConfirma?', confirmar: true };
    }

    const quais = r.tipo === 'INCOME' ? 'receita' : 'despesa';
    this.rascunhos.set(userId, {
      lancamento: r,
      criadoEm: Date.now(),
      categoriaNova: { nome: r.categoriaDita, tipo: r.tipo },
    });
    return {
      texto:
        this.resumo(r, ctx) +
        '\n\nVocê ainda não tem a categoria ' +
        r.categoriaDita +
        ' em ' +
        quais +
        '. Criar e lançar?',
      confirmar: true,
    };
  }

  private ajudaDeCategoria(texto: string, tipo: string, ctx: any): string {
    const nomes = fala
      .categoriasLancaveis(tipo, ctx.categorias)
      .map((c: any) => c.nome)
      .filter(Boolean);

    // "Não achei essa categoria" só quando a pessoa nomeou uma: dizer isso a
    // quem simplesmente esqueceu a categoria seria acusá-la de um engano que
    // ela não cometeu.
    const disse = /categoria/i.test(texto) ? 'Não achei essa categoria. ' : '';
    const quais = tipo === 'INCOME' ? 'receita' : 'despesa';
    if (!nomes.length) {
      return (
        disse + 'Você ainda não tem categoria de ' + quais +
        '. Crie uma no app, em Categorias.'
      );
    }
    return (
      disse + 'Suas categorias de ' + quais + ': ' + this.ateOito(nomes) +
      '. Se for uma nova, crie no app, em Categorias.'
    );
  }

  private nomesDeConta(ctx: any): string {
    const contas = ctx.contas
      .filter((c: any) => c.isActive !== false)
      .map((c: any) => c.nome)
      .filter(Boolean);
    return contas.length ? 'Suas contas: ' + this.ateOito(contas) + '.' : '';
  }

  private nomesDeDestino(ctx: any): string {
    const cartoes = ctx.cartoes.map((k: any) => k.nome).filter(Boolean);
    const partes = [this.nomesDeConta(ctx)];
    if (cartoes.length)
      partes.push('Seus cartões: ' + this.ateOito(cartoes) + '.');
    return partes.filter(Boolean).join(' ');
  }

  /** Lista longa vira recado ilegível; o corte diz quantos ficaram de fora. */
  private ateOito(nomes: string[]): string {
    const TETO = 8;
    if (nomes.length <= TETO) return nomes.join(', ');
    return nomes.slice(0, TETO).join(', ') + ' e mais ' + (nomes.length - TETO);
  }

  /** O resumo da transferência diz a DIREÇÃO. Dizer "Conta" duas vezes
   * esconderia justamente o que a pessoa precisa conferir. */
  private resumoTransferencia(r: any, ctx: any): string {
    const nome = (id: string) => {
      const c = ctx.contas.find((x: any) => x.id === id);
      return c ? c.nome : '—';
    };
    return [
      '🔄 Transferência',
      '💵 Valor: ' + this.brl(r.valor),
      '🏦 Sai de: ' + (r.deId ? nome(r.deId) : '—'),
      '🏦 Entra em: ' + (r.paraId ? nome(r.paraId) : '—'),
      '📅 Data: ' + this.dataBR(r.data),
      r.confirmada ? '✅ Situação: confirmada' : '🕒 Situação: prevista',
    ].join('\n');
  }

  private linhaCurta(r: any): string {
    if (r.repeticao && r.repeticao.quantas) {
      return (
        r.repeticao.quantas +
        'x de ' +
        this.brl(r.valor) +
        (r.desc ? ' — ' + r.desc : '') +
        ', ' +
        this.comQueFrequencia(r.repeticao.freq) +
        ', a partir de ' +
        this.dataBR(r.data) +
        '. Total ' +
        this.brl(Math.round(r.valor * r.repeticao.quantas * 100) / 100) +
        '.'
      );
    }
    if (r.parcelas) {
      return (
        r.parcelas +
        'x de ' +
        this.brl(r.valor) +
        (r.desc ? ' — ' + r.desc : '') +
        ', a partir de ' +
        this.dataBR(r.data) +
        '. Total ' +
        this.brl(r.valorTotal) +
        '.'
      );
    }
    return (
      (r.tipo === 'INCOME' ? 'Receita' : 'Despesa') +
      ' de ' +
      this.brl(r.valor) +
      (r.desc ? ' — ' + r.desc : '') +
      ' em ' +
      this.dataBR(r.data) +
      '.'
    );
  }

  private brl(valor: number): string {
    return (
      'R$ ' +
      Number(valor)
        .toFixed(2)
        .replace('.', ',')
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    );
  }

  private mesBR(chave: string): string {
    const p = String(chave || '').split('-');
    return p.length === 2 ? p[1] + '/' + p[0] : chave;
  }

  private dataBR(iso: string): string {
    const p = String(iso || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : '—';
  }

  // ----------------------------------------------------------
  // rascunho e reentrega
  // ----------------------------------------------------------
  private rascunhoDe(userId: string): Rascunho | null {
    const r = this.rascunhos.get(userId);
    if (!r) return null;
    if (Date.now() - r.criadoEm > RASCUNHO_MINUTOS * 60_000) {
      this.rascunhos.delete(userId);
      return null;
    }
    return r;
  }

  private jaProcessada(id: string): boolean {
    return this.processadas.includes(id);
  }

  private marcarProcessada(id: string) {
    this.processadas.push(id);
    if (this.processadas.length > LEMBRAR_IDS) this.processadas.shift();
  }
}
