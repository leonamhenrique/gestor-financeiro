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
import { LinhaDeFatura, RelatorioService } from '../relatorio/relatorio.service';
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
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return /\bsaldo\b|\bsaldos\b|quanto (eu )?tenho|quanto (eu )?sobra|quanto ha na conta/.test(
    t,
  );
}

/** Sem acento e em minúscula, do jeito que as duas perguntas comparam. */
function semAcento(texto: string): string {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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
    if (rascunho && SIM.test(texto)) return this.gravar(userId, rascunho);
    if (rascunho && NAO.test(texto)) {
      this.rascunhos.delete(userId);
      return { texto: 'Ok, não lancei nada.' };
    }

    const ctx = await this.contextoDoUsuario(userId);
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

    if (r.faltando.length) {
      const nomes = r.faltando.includes('destino')
        ? ' ' + this.nomesDeDestino(ctx)
        : '';
      const categorias = r.faltando.includes('categoria')
        ? ' ' + this.ajudaDeCategoria(texto, r.tipo, ctx)
        : '';
      return {
        texto:
          this.resumo(r, ctx) +
          '\n\nFaltou ' +
          r.faltando.join(', ') +
          '.' +
          nomes +
          categorias +
          ' Mande a frase de novo com essa parte, ou lance no app.',
      };
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return {
      texto: this.resumo(r, ctx) + '\n\nConfirma?',
      confirmar: true,
    };
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
    const r = rascunho.lancamento;
    if (r.transferencia)
      return this.gravarTransferencia(userId, r, rascunho.criadoEm);
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
    const [contas, cartoes, categorias, regras] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { userId } }),
      this.prisma.creditCard.findMany({ where: { userId } }),
      this.prisma.category.findMany({
        where: { OR: [{ userId }, { userId: null }] },
      }),
      this.prisma.categoryRule.findMany({ where: { userId } }),
    ]);

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
