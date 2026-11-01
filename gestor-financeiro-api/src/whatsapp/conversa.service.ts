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
import { WhatsappService } from './whatsapp.service';
import { MensagemRecebida } from './meta';
import { AudioService } from './audio.service';

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

    const texto = (m.texto || '').trim();
    if (!texto) return null;
    return this.lerFrase(userId, texto);
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

    const r = fala.interpretarFala(texto, ctx);

    // Transferência segue por outro ramo porque é outra coisa: não tem
    // categoria, não tem cartão, e o que importa é a DIREÇÃO. O resto do
    // caminho é o mesmo — resumo, "sim", grava.
    if (r.transferencia) return this.lerTransferencia(userId, r, ctx);

    if (r.faltando.length) {
      const nomes = r.faltando.includes('destino')
        ? ' ' + this.nomesDeDestino(ctx)
        : '';
      return {
        texto:
          this.resumo(r, ctx) +
          '\n\nFaltou ' +
          r.faltando.join(', ') +
          '.' +
          nomes +
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
      r.tipo === 'INCOME' ? '↓ Receita' : '↑ Despesa',
      // Parcelado são dois números a conferir: o de cada parcela e o que vai
      // ser devido no fim. Mostrar um só deixa metade da conta para a cabeça
      // de quem lê.
      'Valor: ' + this.brl(r.valor) + (r.parcelas ? ' por parcela' : ''),
      'Descrição: ' + (r.desc || '—'),
    ];
    if (r.parcelas) {
      linhas.push(
        '🧾 Parcelas: ' + r.parcelas + 'x — total ' + this.brl(r.valorTotal),
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
      'Categoria: ' +
        (cat?.nome || '—') +
        (r.categoriaDoLojista ? ' (do lojista)' : ''),
    );
    // "2026-12" é chave, não data: quem lê quer o mês.
    if (r.cartaoId && r.faturaMes) linhas.push('Fatura: ' + this.mesBR(r.faturaMes));
    linhas.push('Data: ' + this.dataBR(r.data));
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
      '⇄ Transferência',
      'Valor: ' + this.brl(r.valor),
      '🏦 Sai de: ' + (r.deId ? nome(r.deId) : '—'),
      '🏦 Entra em: ' + (r.paraId ? nome(r.paraId) : '—'),
      'Data: ' + this.dataBR(r.data),
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
