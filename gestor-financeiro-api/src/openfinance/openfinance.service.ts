// ============================================================
// openfinance.service.ts — conectar, conferir, propor, desconectar
// ============================================================
// AS DUAS FORMAS, QUE É A REGRA ACIMA DE TODAS
// Quem não conectar banco nenhum usa o app exatamente como sempre usou.
// Nada aqui muda o caminho de quem lança à mão: a conexão é por CONTA e por
// CARTÃO, não um modo do usuário, e dá para conectar um banco e continuar
// digitando o cartão da loja. Quem nunca conectar não tem linha nenhuma em
// `open_finance_connections`, e nada no sistema se comporta diferente.
//
// ESTE SERVIÇO NÃO GRAVA LANÇAMENTO NENHUM — de propósito.
// Ele devolve uma PROPOSTA, e quem decide é a mesma tela de importação que
// já existe, com a pessoa olhando. O pior caso de um erro aqui é uma linha
// a mais numa lista de conferência; se ele gravasse, seria dinheiro errado
// no saldo de alguém.
//
// DUAS "NÃO DUPLICAÇÕES", QUE SÃO PROBLEMAS DIFERENTES
//
// 1. A MESMA transação vindo DE NOVO do banco, numa segunda sincronização.
//    Resolve-se aqui, com `providerTxId`: o que já existe não é proposto.
//    É exata, não tem tolerância, não depende de texto.
//
// 2. A transação que o usuário JÁ TINHA lançado à mão, ou que o app
//    projetou como parcela. Essa não tem `providerTxId` nenhum — o banco
//    não sabe que ela existe. Quem resolve é o casamento da tela, com as
//    regras que o importador de OFX já usa.
//
// Confundir as duas seria fatal nos dois sentidos: a primeira, resolvida por
// texto e data, erraria; a segunda, resolvida por id, nunca casaria.
// ============================================================

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolpClient, LancamentoDoProvedor } from './polp.client';

/** Está ligada? Sem a variável, o app se comporta exatamente como antes. */
export const openFinanceLigado = (): boolean => process.env.OPENFINANCE_ENABLED === 'true';

export interface PropostaDeImportacao {
  connectionId: string;
  instituicao: string | null;
  sincronizadoEm: string;
  contas: Array<{
    providerAccountId: string;
    nome: string;
    bankAccountId: string | null;
    lancamentos: LancamentoDoProvedor[];
  }>;
  cartoes: Array<{
    providerAccountId: string;
    nome: string;
    creditCardId: string | null;
    fechamento: number | null;
    vencimento: number | null;
    lancamentos: LancamentoDoProvedor[];
  }>;
  /** Quantas o provedor mandou e o app já tinha pelo id. Ver nota 1. */
  jaSincronizados: number;
}

@Injectable()
export class OpenFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly polp: PolpClient,
  ) {}

  // ---------------------------------------------------------------- bancos
  async instituicoes(busca?: string) {
    const todas = await this.polp.instituicoes();
    const pessoais = todas.filter((i) => i.tipo === 'PERSONAL' || i.tipo === 'BOTH');
    if (!busca) return pessoais.filter((i) => i.disponivel);
    const alvo = busca.toLowerCase();
    return pessoais.filter((i) => i.nome.toLowerCase().includes(alvo));
  }

  // ----------------------------------------------------------- conectar
  /**
   * Cria o consentimento e devolve o link de autorização.
   *
   * A autorização acontece NO BANCO, com o login do dono da conta — o app
   * nunca vê senha, e nunca deve pedir uma. E o CPF não é guardado: ele
   * atravessa até o provedor e some. Ver a nota em `criarConsentimento`.
   */
  async conectar(userId: string, dados: { institutionId: string; cpf: string }) {
    const cpf = (dados.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');

    const instituicao = (await this.polp.instituicoes()).find((i) => i.id === dados.institutionId);
    if (!instituicao) throw new NotFoundException('Instituição não encontrada.');

    const criado = await this.polp.criarConsentimento({
      institutionId: dados.institutionId,
      cpf,
      clienteUserId: userId,
    });

    const conexao = await this.prisma.openFinanceConnection.create({
      data: {
        userId,
        provider: 'POLP',
        consentId: criado.consentId,
        institutionId: dados.institutionId,
        institutionName: instituicao.nome,
        status: criado.status,
        products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
      },
    });

    return {
      id: conexao.id,
      instituicao: instituicao.nome,
      status: criado.status,
      /* Uso ÚNICO e validade curta: reabrir o mesmo link responde
       * `invalid_request_uri`, o que se disfarça de "o banco recusou". Quem
       * errar o clique precisa de um link novo, não de insistir no mesmo. */
      urlParaAutorizar: criado.urlParaAutorizar,
      urlExpiraEm: criado.urlExpiraEm,
    };
  }

  // ------------------------------------------------------------- listar
  async listar(userId: string) {
    const conexoes = await this.prisma.openFinanceConnection.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return conexoes.map((c) => ({
      id: c.id,
      instituicao: c.institutionName,
      status: c.status,
      autorizadaEm: c.authorizedAt,
      sincronizadaEm: c.lastSyncedAt,
    }));
  }

  /** Releva o status no provedor e guarda o que mudou. */
  async situacao(userId: string, id: string) {
    const conexao = await this.minha(userId, id);
    const lá = await this.polp.consentimento(conexao.consentId);

    const autorizou = lá.status === 'AUTHORISED' && !conexao.authorizedAt;
    const atualizada = await this.prisma.openFinanceConnection.update({
      where: { id: conexao.id },
      data: {
        status: lá.status,
        /* A cobrança do provedor começa na autorização, e é por isso que a
         * data fica gravada: é a resposta de "desde quando isto custa". */
        ...(autorizou ? { authorizedAt: new Date() } : {}),
      },
    });

    return {
      id: atualizada.id,
      instituicao: atualizada.institutionName,
      status: atualizada.status,
      execucao: lá.execucao,
      autorizadaEm: atualizada.authorizedAt,
      pronta: lá.status === 'AUTHORISED',
    };
  }

  // -------------------------------------------------------------- propor
  /**
   * O que o banco tem e o app ainda não — para a tela conferir e decidir.
   *
   * Nada é gravado. O filtro daqui é o do id do provedor (a nota 1 lá em
   * cima); o casamento com o que a pessoa digitou é da tela, com as regras
   * que o importador já usa.
   */
  async paraImportar(userId: string, id: string): Promise<PropostaDeImportacao> {
    const conexao = await this.minha(userId, id);
    if (conexao.status !== 'AUTHORISED') {
      throw new BadRequestException('Esta conexão ainda não foi autorizada no banco.');
    }

    const [contasLá, cartoesLá] = await Promise.all([
      this.polp.contas(conexao.consentId),
      this.polp.cartoes(conexao.consentId),
    ]);

    const contas: PropostaDeImportacao['contas'] = [];
    const cartoes: PropostaDeImportacao['cartoes'] = [];
    const todos: LancamentoDoProvedor[] = [];

    for (const c of contasLá) {
      const lancamentos = await this.polp.transacoesDaConta(c.providerAccountId);
      todos.push(...lancamentos);
      const daqui = await this.prisma.bankAccount.findFirst({
        where: { userId, connectionId: conexao.id, providerAccountId: c.providerAccountId },
        select: { id: true },
      });
      contas.push({ ...c, bankAccountId: daqui?.id ?? null, lancamentos });
    }

    for (const k of cartoesLá) {
      const [lancamentos, dias] = await Promise.all([
        this.polp.transacoesDoCartao(k.providerAccountId),
        this.polp.diasDoCartao(k.providerAccountId),
      ]);
      todos.push(...lancamentos);
      const daqui = await this.prisma.creditCard.findFirst({
        where: { userId, connectionId: conexao.id, providerAccountId: k.providerAccountId },
        select: { id: true },
      });
      cartoes.push({
        providerAccountId: k.providerAccountId,
        nome: k.nome,
        creditCardId: daqui?.id ?? null,
        fechamento: dias.fechamento,
        vencimento: dias.vencimento,
        lancamentos,
      });
    }

    /* Uma consulta só para todos os ids: a segunda sincronização relê as
     * mesmas transações, e sem este corte a lista de conferência viria
     * cheia do que a pessoa já importou ontem. */
    const ids = todos.map((t) => t.providerTxId).filter(Boolean);
    const existentes = ids.length
      ? await this.prisma.transaction.findMany({
          where: { userId, providerTxId: { in: ids } },
          select: { providerTxId: true },
        })
      : [];
    const jaTenho = new Set(existentes.map((t) => t.providerTxId));

    const limpar = (lista: LancamentoDoProvedor[]) =>
      lista.filter((t) => !jaTenho.has(t.providerTxId));

    for (const c of contas) c.lancamentos = limpar(c.lancamentos);
    for (const k of cartoes) k.lancamentos = limpar(k.lancamentos);

    await this.prisma.openFinanceConnection.update({
      where: { id: conexao.id },
      data: { lastSyncedAt: new Date() },
    });

    return {
      connectionId: conexao.id,
      instituicao: conexao.institutionName,
      sincronizadoEm: new Date().toISOString(),
      contas,
      cartoes,
      jaSincronizados: jaTenho.size,
    };
  }

  // --------------------------------------------------------- desconectar
  /**
   * Revoga no provedor e marca a conexão como encerrada.
   *
   * O que ENTROU por ela continua existindo: desistir da integração não
   * apaga o dinheiro de ninguém, e conta conectada que se desconecta vira
   * conta comum, com o histórico inteiro. É a mesma ideia do `ON DELETE SET
   * NULL` da migração — a diferença entre "desconectei o banco" e "perdi os
   * meus dados".
   *
   * A revogação no provedor é o que PARA A COBRANÇA, então ela vem antes; se
   * ela falhar, a conexão não é marcada, e tentar de novo é seguro.
   */
  async desconectar(userId: string, id: string) {
    const conexao = await this.minha(userId, id);
    await this.polp.revogar(conexao.consentId);
    await this.prisma.openFinanceConnection.update({
      where: { id: conexao.id },
      data: { revokedAt: new Date(), status: 'REVOKED' },
    });
    return { id: conexao.id, desconectada: true };
  }

  // ------------------------------------------------------------ privado
  /** A conexão, se for mesmo desta pessoa. */
  private async minha(userId: string, id: string) {
    const conexao = await this.prisma.openFinanceConnection.findFirst({
      where: { id, userId, revokedAt: null },
    });
    if (!conexao) throw new NotFoundException('Conexão não encontrada.');
    return conexao;
  }
}
