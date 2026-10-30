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

const SIM = /^(sim|s|ok|okay|confirmo?|confirmar|pode|pode lan[çc]ar|isso|claro|beleza|positivo|👍)$/i;
const NAO = /^(n[ãa]o|n|cancela(r)?|deixa|esquece|negativo)$/i;

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
    private readonly whatsapp: WhatsappService,
    private readonly audio: AudioService,
  ) {}

  /** Devolve o texto da resposta, ou `null` quando não há o que responder.
   * Quem manda a resposta é o controlador — assim este serviço inteiro é
   * testável sem rede. */
  async responderA(m: MensagemRecebida): Promise<string | null> {
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
        return (
          'Ainda não escuto áudio por aqui. ' +
          'Escreva a frase: "gastei 40 no mercado pelo débito".'
        );
      }
      const ouvido = await this.audio.ouvir(m.audioId);
      if (!ouvido) {
        return 'Não consegui entender o áudio. Mande de novo, mais perto do microfone, ou escreva a frase.';
      }
      // O que foi ouvido vem ANTES do resumo, sempre. Metade dos enganos de
      // voz é o transcritor trocando uma palavra, e a pessoa só descobre se
      // a resposta disser o que ele achou que ouviu.
      const resposta = await this.lerFrase(userId, ouvido);
      return resposta ? 'Ouvi: “' + ouvido + '”\n\n' + resposta : null;
    }

    const texto = (m.texto || '').trim();
    if (!texto) return null;
    return this.lerFrase(userId, texto);
  }

  /** Daqui para baixo tanto faz se a frase foi falada ou digitada. */
  private async lerFrase(userId: string, texto: string): Promise<string | null> {
    const rascunho = this.rascunhoDe(userId);
    if (rascunho && SIM.test(texto)) return this.gravar(userId, rascunho);
    if (rascunho && NAO.test(texto)) {
      this.rascunhos.delete(userId);
      return 'Ok, não lancei nada.';
    }

    const ctx = await this.contextoDoUsuario(userId);
    if (!ctx.contas.length && !ctx.cartoes.length) {
      return 'Antes de lançar por aqui, cadastre uma conta ou um cartão no app.';
    }

    const r = fala.interpretarFala(texto, ctx);

    if (r.transferencia) {
      return 'Transferência entre contas ainda não vai por aqui — faça no app. Por aqui vão despesas e receitas.';
    }

    if (r.faltando.length) {
      return (
        this.resumo(r, ctx) +
        '\n\nFaltou ' +
        r.faltando.join(', ') +
        '. Mande a frase de novo com essa parte, ou lance no app.'
      );
    }

    this.rascunhos.set(userId, { lancamento: r, criadoEm: Date.now() });
    return this.resumo(r, ctx) + '\n\nConfirma? Responda SIM para lançar.';
  }

  // ----------------------------------------------------------
  // o que fazer com quem ainda não conectou
  // ----------------------------------------------------------
  /** Resposta igual para todo número desconhecido, com ou sem conta no app.
   * Dizer "esta conta não tem WhatsApp ligado" confirmaria, para quem
   * adivinhou um número, que existe conta ali. */
  private async semVinculo(m: MensagemRecebida): Promise<string> {
    const ligou = await this.whatsapp.vincularPorCodigo(m.de, m.texto || '');
    if (ligou) {
      return (
        'Pronto. Este número agora lança na sua conta do saldonline.\n\n' +
        'Experimente: "gastei 40 no mercado pelo débito".'
      );
    }
    return (
      'Não reconheço este número. Para conectar, abra o app, vá em Perfil → WhatsApp ' +
      'e mande daqui o código que aparecer lá.'
    );
  }

  // ----------------------------------------------------------
  // gravar, depois do sim
  // ----------------------------------------------------------
  private async gravar(userId: string, rascunho: Rascunho): Promise<string> {
    this.rascunhos.delete(userId);
    const r = rascunho.lancamento;
    try {
      await this.transactions.create({
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
        clientKey: 'wa-' + userId.slice(0, 8) + '-' + Math.round(rascunho.criadoEm / 1000),
      });
    } catch (e: any) {
      this.log.error('falha ao lançar pelo WhatsApp: ' + (e?.message || e));
      return 'Não consegui lançar agora. Tente de novo em instantes, ou lance pelo app.';
    }
    return 'Lançado. ' + this.linhaCurta(r);
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
      this.prisma.category.findMany({ where: { OR: [{ userId }, { userId: null }] } }),
      this.prisma.categoryRule.findMany({ where: { userId } }),
    ]);

    return {
      contas: contas.map((c: any) => ({ id: c.id, nome: c.name, isActive: c.isActive })),
      cartoes: cartoes.map((k: any) => ({ id: k.id, nome: k.name, contaId: k.bankAccountId })),
      categorias: categorias.map((c: any) => ({
        id: c.id,
        nome: c.name,
        tipo: c.type,
        paiId: c.parentId || null,
      })),
      regras: regras.map((r: any) => ({ lojista: r.merchant, categoriaId: r.categoryId })),
      // O dia é o de quem falou, não o do servidor: "ontem" tem de ser ontem
      // para a pessoa.
      hoje: new Date(),
    };
  }

  // ----------------------------------------------------------
  // o texto da resposta
  // ----------------------------------------------------------
  private resumo(r: any, ctx: any): string {
    const linhas = [
      r.tipo === 'INCOME' ? '↓ Receita' : '↑ Despesa',
      'Valor: ' + this.brl(r.valor),
      'Descrição: ' + (r.desc || '—'),
    ];
    const cartao = ctx.cartoes.find((k: any) => k.id === r.cartaoId);
    const conta = ctx.contas.find((c: any) => c.id === r.contaId);
    linhas.push((cartao ? 'Cartão: ' : 'Conta: ') + (cartao?.nome || conta?.nome || '—'));
    const cat = ctx.categorias.find((c: any) => c.id === r.categoriaId);
    linhas.push(
      'Categoria: ' + (cat?.nome || '—') + (r.categoriaDoLojista ? ' (do lojista)' : ''),
    );
    if (r.cartaoId && r.faturaMes) linhas.push('Fatura: ' + r.faturaMes);
    linhas.push('Data: ' + this.dataBR(r.data));
    linhas.push('Situação: ' + (r.confirmada ? 'confirmado' : 'previsto'));
    return linhas.join('\n');
  }

  private linhaCurta(r: any): string {
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
    return 'R$ ' + Number(valor).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
