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

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LimitesService } from '../billing/limites.service';
import { cortarPorHistorico } from './historico';
import { PolpClient, LancamentoDoProvedor, ConflitoDeConsentimento } from './polp.client';
import { CreditCardsService } from '../credit-cards/credit-cards.service';
import { hojeNoFuso } from '../credit-cards/invoice-statement';
import { diaDoDesligamento } from './janela-do-banco';

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
  /** Meses que o banco mandou e o PLANO não deixa importar. Zero quando o
   * plano alcança tudo o que veio. */
  mesesForaDoPlano: number;
}

/**
 * O apelido como ele é gravado: aparado, ou NULO.
 *
 * Vazio vira nulo de propósito — "" e `null` contariam a mesma coisa de dois
 * jeitos, e a tela teria de testar os dois para decidir se mostra o nome do
 * banco. Nulo é a ausência, e é só ela que existe aqui.
 *
 * O limite de 40 é o que cabe na linha da lista sem empurrar os botões; o
 * corte acontece aqui, e não só no validador, porque o serviço também é
 * chamado pelo teste e pelo próprio app.
 */
export function limparApelido(apelido?: string | null): string | null {
  const limpo = (apelido ?? '').trim().slice(0, 40);
  return limpo || null;
}

@Injectable()
export class OpenFinanceService {
  private readonly logger = new Logger('OpenFinance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly polp: PolpClient,
    private readonly cartoes: CreditCardsService,
    private readonly limites: LimitesService,
  ) {}


  /**
   * Alinha o ciclo do cartão com o que o BANCO reporta.
   *
   * Até aqui os dias do banco eram lidos a cada conferência, mostrados numa
   * tela e jogados fora. Fora da importação, ninguém sabia o que o banco
   * tinha dito — e a única fonte dos dias passava a ser quem digitou o
   * cadastro. Medido num cartão real: o banco reportou fechamento 30 e
   * vencimento 7 em 15 faturas seguidas, e o cadastro dizia 1 e 7.
   *
   * POR QUE APLICAR SOZINHO
   * A integração propõe e não decide — mas só onde existe decisão humana
   * para respeitar. Num cartão que veio do Open Finance e cujo ciclo
   * ninguém nunca escolheu, não existe: há um palpite de cadastro de um
   * lado e as faturas do banco do outro. Depois que alguém grava dias que
   * discordam do banco, `cycleEditedByUser` fica verdadeiro e isto para de
   * agir — passa a ser proposta na tela.
   *
   * POR QUE É SEGURO
   * A correção preserva o NOME de cada fatura e não move lançamento nenhum:
   * ela renumera as referências por baixo. O que muda são as datas de
   * fechamento e vencimento das faturas e onde cai a compra NOVA. Sem essa
   * garantia isto não poderia rodar sem alguém olhando.
   *
   * Falhar aqui não pode estragar a conferência: ela é o que a pessoa está
   * esperando na tela, e o alinhamento é um extra.
   */
  private async alinharCicloComOBanco(
    userId: string,
    creditCardId: string,
    fechamento: number | null,
    vencimento: number | null,
    sempreOsMesmos: boolean,
  ): Promise<void> {
    if (!fechamento || !vencimento) return;

    await this.prisma.creditCard.update({
      where: { id: creditCardId },
      data: { bankClosingDay: fechamento, bankDueDay: vencimento },
    });

    const card = await this.prisma.creditCard.findUnique({
      where: { id: creditCardId },
      select: { closingDay: true, dueDay: true, cycleEditedByUser: true, cycles: true },
    });
    if (!card) return;

    const diasBatem = card.closingDay === fechamento && card.dueDay === vencimento;
    const umCicloSo = (card.cycles?.length ?? 0) <= 1;
    if (diasBatem && umCicloSo) return;

    /* PILHA DE PERÍODOS NÃO É ESCOLHA DE NINGUÉM.
     *
     * Este é o segundo critério, e ele nasceu de um caso real: o cartão
     * tinha três períodos, os dias de hoje batiam com o banco, e o
     * alinhamento se recusou a agir porque `cycleEditedByUser` estava
     * marcado — marcado por edições que criaram a pilha, não por alguém
     * querer aquela pilha.
     *
     * A diferença entre um histórico legítimo e um artefato quem responde é
     * o banco: `sempreOsMesmos` olha TODAS as faturas dele. Se elas sempre
     * tiveram as mesmas datas, o cartão nunca mudou de ciclo, e qualquer
     * período extra aqui é sujeira. Achatá-la não contraria decisão nenhuma
     * — os dias continuam os que estão, e são os do banco.
     *
     * O que continua respeitado: dias que DISCORDAM do banco. Aí pode ser o
     * banco atrasado, e a escolha da pessoa vale. */
    const sujeiraDeHistorico = card.cycleEditedByUser && diasBatem && !umCicloSo && sempreOsMesmos;
    if (card.cycleEditedByUser && !sujeiraDeHistorico) return;

    try {
      await this.cartoes.corrigirCiclo(userId, creditCardId, fechamento, vencimento);
      this.logger.log('ciclo do cartão alinhado com o banco');
    } catch (e: any) {
      /* Recusa esperada: há réguas em que um mês do histórico não existiria,
       * e a correção prefere parar a mover lançamento em silêncio. Fica para
       * a pessoa resolver na tela, com os dois números à vista. */
      this.logger.warn('não consegui alinhar o ciclo com o banco: ' + (e?.message || 'erro'));
    }
  }

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
  async conectar(userId: string, dados: { institutionId: string; cpf: string; apelido?: string | null }) {
    const cpf = (dados.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');

    /* O limite do plano vem ANTES de falar com o provedor: criar
     * consentimento queima a cota mensal do CPF naquela instituição e é
     * cobrado na nossa conta. Recusar depois de criar custaria dinheiro por
     * um "não" que a gente já sabia dar. */
    await this.limites.conferirBanco(userId);

    const instituicao = (await this.polp.instituicoes()).find((i) => i.id === dados.institutionId);
    if (!instituicao) throw new NotFoundException('Instituição não encontrada.');

    let criado;
    try {
      criado = await this.polp.criarConsentimento({
        institutionId: dados.institutionId,
        cpf,
        clienteUserId: userId,
      });
    } catch (e) {
      if (e instanceof ConflitoDeConsentimento) {
        return await this.resolverConflito(userId, instituicao, e);
      }
      throw e;
    }

    const conexao = await this.guardarConexao(
      userId, instituicao, criado.consentId, criado.status, dados.apelido,
    );

    return {
      id: conexao.id,
      instituicao: instituicao.nome,
      status: criado.status,
      jaConectado: false,
      /* Uso ÚNICO e validade curta: reabrir o mesmo link dá uma página de
       * "link não disponível", o que se disfarça de "o banco recusou". Quem
       * errar o clique precisa de um link novo, não de insistir no mesmo.
       * Pré-visualização de mensageiro NÃO consome o link — mandar por
       * WhatsApp é seguro; antivírus de e-mail pode consumir. */
      urlParaAutorizar: criado.urlParaAutorizar,
      urlExpiraEm: criado.urlExpiraEm,
      reaproveitado: criado.reaproveitado,
      /* Até quando este banco fica ligado, para a tela dizer AGORA e não
       * numa manhã em que os lançamentos simplesmente param.
       *
       * Calculada sobre HOJE, e não sobre a autorização, que ainda não
       * aconteceu. Se a pessoa deixar para autorizar no dia seguinte, a
       * data real é a que `listar` devolve — e esta era uma previsão certa
       * em todo caso que não atravessa a fronteira dos 10 dias. */
      conectadaAte: (await this.limites.estaPagando(userId))
        ? null
        : diaDoDesligamento(hojeNoFuso()),
    };
  }

  /**
   * O 409 da v3, que é resposta e não erro.
   *
   * O caso que mais importa é o primeiro: o provedor diz "este CPF já tem
   * consentimento valendo neste banco, e o id é este". Aí o certo é ADOTAR
   * — criar outro queimaria de novo a cota mensal do CPF na instituição, que
   * é finita e não se recupera até a virada do mês.
   */
  private async resolverConflito(
    userId: string,
    instituicao: { id: string; nome: string },
    conflito: ConflitoDeConsentimento,
  ) {
    if (conflito.motivo === 'CONSENT_ALREADY_AUTHORISED' && conflito.consentId) {
      const conexao = await this.guardarConexao(
        userId,
        instituicao,
        conflito.consentId,
        'AUTHORISED',
      );
      return {
        id: conexao.id,
        instituicao: instituicao.nome,
        status: 'AUTHORISED',
        /* Sem link: não há o que autorizar. A tela diz "já conectado" e
         * segue direto para buscar os lançamentos. */
        jaConectado: true,
        urlParaAutorizar: null,
        urlExpiraEm: null,
        reaproveitado: true,
      };
    }

    if (conflito.motivo === 'AUTHORIZATION_LINK_ACTIVE') {
      throw new BadRequestException(
        'Já existe um link de autorização válido para este banco, e ele ainda não foi aberto. ' +
          'Use o que você recebeu' +
          (conflito.disponivelEm ? ' — outro só pode ser gerado depois de ' + conflito.disponivelEm : '') +
          '.',
      );
    }

    if (conflito.motivo === 'CONSENT_CREATION_IN_PROGRESS') {
      throw new BadRequestException('Já há uma conexão sendo criada. Tente de novo em instantes.');
    }

    throw new BadRequestException('O provedor recusou: ' + conflito.motivo + '.');
  }

  /**
   * A conexão daqui que aponta para o consentimento de lá.
   *
   * `upsert` porque a v3 REAPROVEITA o mesmo consentimento: tentar de novo
   * devolve o id que já está guardado, e um `create` cego esbarraria no
   * índice único com um erro que não diz nada a ninguém.
   */
  private async guardarConexao(
    userId: string,
    instituicao: { id: string; nome: string },
    consentId: string,
    status: string,
    apelido?: string | null,
  ) {
    /* O índice único é por (provider, consentId), sem o dono. Se a linha
     * existe e é de OUTRA pessoa, isto não pode virar um "upsert" silencioso
     * que troca o dono de um consentimento. */
    const existente = await this.prisma.openFinanceConnection.findFirst({
      where: { provider: 'POLP', consentId },
    });
    if (existente && existente.userId !== userId) {
      throw new BadRequestException('Este consentimento já pertence a outra conta.');
    }

    return this.prisma.openFinanceConnection.upsert({
      where: { provider_consentId: { provider: 'POLP', consentId } },
      create: {
        userId,
        provider: 'POLP',
        consentId,
        institutionId: instituicao.id,
        institutionName: instituicao.nome,
        nickname: limparApelido(apelido),
        status,
        products: ['ACCOUNT', 'CREDIT_CARD_ACCOUNT'],
      },
      update: {
        status,
        institutionName: instituicao.nome,
        /* Reaproveitar um consentimento revogado o traz de volta à vida: a
         * marca de encerrado precisa sair junto, ou ele continuaria fora de
         * toda listagem. */
        revokedAt: null,
        ...(status === 'AUTHORISED' ? { authorizedAt: new Date() } : {}),
      },
    });
  }

  // ------------------------------------------------------------- listar
  async listar(userId: string) {
    const conexoes = await this.prisma.openFinanceConnection.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    /* Quem está esperando autorização tem o status conferido agora.
     *
     * Sem isto, quem autorizou no banco voltava ao app e via "aguardando a
     * sua autorização" — porque o app mostra o último status que GUARDOU, e
     * o banco não nos avisa por iniciativa própria. A pessoa tinha de tocar
     * em "Já autorizei" para o app descobrir o que já era verdade. São
     * poucas conexões por pessoa, e só as pendentes custam uma chamada. */
    const frescas = await Promise.all(
      conexoes.map(async (c) => {
        if (c.status === 'AUTHORISED') return c;
        try {
          const la = await this.polp.consentimento(c.consentId);
          if (la.status === c.status) return c;
          return await this.prisma.openFinanceConnection.update({
            where: { id: c.id },
            data: {
              status: la.status,
              ...(la.status === 'AUTHORISED' && !c.authorizedAt
                ? { authorizedAt: new Date() }
                : {}),
            },
          });
        } catch {
          /* Provedor fora não pode apagar a lista: o que se sabia continua
           * valendo, e a próxima abertura tenta de novo. */
          return c;
        }
      }),
    );

    /* A VALIDADE DA CONEXÃO NÃO É LETRA MIÚDA.
     *
     * Quem não paga tem o banco desligado antes de o mês virar — cada
     * consentimento é cobrado na nossa conta do provedor, e um que
     * atravessa o dia 1º pode ser cobrado de novo. A data vai na lista
     * para a tela poder dizê-la, em vez de a pessoa descobrir numa manhã
     * que os lançamentos pararam.
     *
     * Uma pergunta de plano por listagem, não uma por conexão. */
    const paga = await this.limites.estaPagando(userId);

    return frescas.map((c) => ({
      id: c.id,
      instituicao: c.institutionName,
      apelido: c.nickname,
      status: c.status,
      autorizadaEm: c.authorizedAt,
      sincronizadaEm: c.lastSyncedAt,
      pendentes: c.pendingCount,
      conferidoEm: c.pendingCheckedAt,
      /* Nula para quem paga e para a que ainda espera autorização: antes do
       * "sim" do banco não há consentimento cobrado, e prometer uma data
       * para o que pode nem existir confunde. */
      conectadaAte: !paga && c.authorizedAt ? diaDoDesligamento(hojeNoFuso(c.authorizedAt)) : null,
    }));
  }

  /**
   * O apelido da conexão: como a PESSOA chama esta ligação com o banco.
   *
   * Renomear existe, e não só "nomear ao conectar", porque criar
   * consentimento QUEIMA COTA do CPF naquela instituição — obrigar a
   * reconectar para corrigir um nome cobraria caro por um erro de digitação.
   *
   * Nada aqui fala com o provedor: o apelido é nosso, não dele.
   */
  async renomear(userId: string, id: string, apelido?: string | null) {
    const conexao = await this.prisma.openFinanceConnection.findFirst({
      where: { id, userId, revokedAt: null },
    });
    if (!conexao) throw new NotFoundException('Conexão não encontrada.');

    const atualizada = await this.prisma.openFinanceConnection.update({
      where: { id: conexao.id },
      data: { nickname: limparApelido(apelido) },
    });
    return { id: atualizada.id, apelido: atualizada.nickname };
  }

  /**
   * Quantos lançamentos esperam — lido do banco, sem falar com o provedor.
   *
   * É o que a tela chama ao abrir o app. Perguntar ao provedor aqui custaria
   * centenas de transações baixadas a cada abertura para, na maioria das
   * vezes, não mostrar nada. Quem pergunta é o trabalho diário.
   */
  async pendentes(userId: string) {
    const conexoes = await this.prisma.openFinanceConnection.findMany({
      where: { userId, revokedAt: null, status: 'AUTHORISED' },
      select: {
        id: true,
        institutionName: true,
        pendingCount: true,
        pendingNewCount: true,
        pendingCheckedAt: true,
      },
    });
    return {
      total: conexoes.reduce((soma, c) => soma + (c.pendingCount ?? 0), 0),
      /* O que chegou depois de a pessoa ter visto. É este que acende o
       * aviso e o número do menu; o total continua para a tela que mostra
       * a lista inteira. */
      novos: conexoes.reduce((soma, c) => soma + (c.pendingNewCount ?? c.pendingCount ?? 0), 0),
      conexoes: conexoes.map((c) => ({
        id: c.id,
        instituicao: c.institutionName,
        /* Nulo continua nulo até a tela: "ainda não perguntei" não é zero, e
         * só o zero autoriza a tela a ficar calada. */
        pendentes: c.pendingCount,
        conferidoEm: c.pendingCheckedAt,
      })),
    };
  }

  /**
   * Pergunta ao provedor e guarda os dois números. Para o trabalho diário.
   *
   * Devolve quantos chegaram DEPOIS de a pessoa ter visto a lista — que é o
   * número do aviso. O total continua guardado, porque é ele que a tela de
   * Importar mostra.
   *
   * A diferença nasceu de um caso real: o provedor importa doze meses de
   * uma vez, e o primeiro aviso falou em 487 lançamentos. Quem decide não
   * importar o histórico fica com esse número para sempre — e número que
   * não desce para de ser lido.
   *
   * Erro de uma conexão não pode derrubar as outras: quem chama trata uma
   * a uma.
   */
  async recontarPendentes(userId: string, conexaoId: string): Promise<number> {
    const conexao = await this.prisma.openFinanceConnection.findFirst({
      where: { id: conexaoId, userId },
      select: { pendingSeenAt: true },
    });
    const proposta = await this.paraImportar(userId, conexaoId);
    const todos = [
      ...proposta.contas.flatMap((c) => c.lancamentos),
      ...proposta.cartoes.flatMap((k) => k.lancamentos),
    ];
    const total = todos.length;

    /* Nunca olhou: TUDO é novidade, e é verdade — ela ainda não viu nada.
     * O primeiro aviso é o único que fala do histórico inteiro, e é o
     * único em que isso é informação. */
    const visto = conexao?.pendingSeenAt;
    const novos = !visto
      ? total
      : todos.filter((t) => t.recebidoEm && new Date(t.recebidoEm) > visto).length;

    await this.prisma.openFinanceConnection.update({
      where: { id: conexaoId },
      data: { pendingCount: total, pendingNewCount: novos, pendingCheckedAt: new Date() },
    });
    return novos;
  }

  /**
   * "Eu já vi esta lista."
   *
   * Marcado pela TELA, quando ela pinta a lista — e não pelo servidor
   * quando alguém pede a proposta: pedir não é ver. O trabalho diário pede
   * a proposta toda manhã, e se isso contasse como visto, nada seria
   * novidade nunca.
   */
  async marcarVisto(userId: string) {
    const agora = new Date();
    await this.prisma.openFinanceConnection.updateMany({
      where: { userId, revokedAt: null },
      data: { pendingSeenAt: agora, pendingNewCount: 0 },
    });
    return { visto: agora.toISOString() };
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
      const daqui = await this.reencontrarDestino('bankAccount', userId, conexao.id, c.providerAccountId);
      contas.push({ ...c, bankAccountId: daqui, lancamentos });
    }

    for (const k of cartoesLá) {
      const [lancamentos, dias] = await Promise.all([
        this.polp.transacoesDoCartao(k.providerAccountId),
        this.polp.diasDoCartao(k.providerAccountId),
      ]);
      todos.push(...lancamentos);
      const daqui = await this.reencontrarDestino('creditCard', userId, conexao.id, k.providerAccountId);
      /* O banco acabou de dizer os dias: grava, e alinha o ciclo quando não
       * há escolha de ninguém para respeitar. */
      if (daqui) {
        await this.alinharCicloComOBanco(
          userId, daqui, dias.fechamento, dias.vencimento, dias.sempreOsMesmos,
        );
      }

      cartoes.push({
        providerAccountId: k.providerAccountId,
        nome: k.nome,
        creditCardId: daqui,
        fechamento: dias.fechamento,
        vencimento: dias.vencimento,
        lancamentos,
      });
    }

    /* Uma consulta só para todos os ids: a segunda sincronização relê as
     * mesmas transações, e sem este corte a lista de conferência viria
     * cheia do que a pessoa já importou ontem. */
    const ids = todos.map((t) => t.providerTxId).filter(Boolean);
    const [existentes, recusados, viraramTransferencia] = await Promise.all([
      ids.length
        ? this.prisma.transaction.findMany({
            where: { userId, providerTxId: { in: ids } },
            select: { providerTxId: true },
          })
        : Promise.resolve([]),
      /* O que a pessoa desfez não volta a ser oferecido. Fica fora da
       * proposta inteira, e não só da entrada automática: uma lista que
       * oferece todo dia o que já foi dispensado uma vez ensina a pessoa a
       * parar de ler a lista. */
      ids.length
        ? this.prisma.openFinanceRefusal.findMany({
            where: { userId, providerTxId: { in: ids } },
            select: { providerTxId: true },
          })
        : Promise.resolve([]),
      /* Linha que a pessoa marcou como TRANSFERÊNCIA não virou lançamento —
       * virou outra coisa, noutra tabela. Olhar só os lançamentos faria o
       * mesmo Pix voltar amanhã como novidade, e a pessoa teria de dizer
       * "isto é transferência" todo dia, para sempre. */
      ids.length
        ? this.prisma.transfer.findMany({
            where: { userId, providerTxId: { in: ids } },
            select: { providerTxId: true },
          })
        : Promise.resolve([]),
    ]);
    const jaTenho = new Set([
      ...existentes.map((t) => t.providerTxId),
      ...recusados.map((r) => r.providerTxId),
      ...viraramTransferencia.map((t) => t.providerTxId),
    ]);

    const limpar = (lista: LancamentoDoProvedor[]) =>
      lista.filter((t) => !jaTenho.has(t.providerTxId));

    for (const c of contas) c.lancamentos = limpar(c.lancamentos);
    for (const k of cartoes) k.lancamentos = limpar(k.lancamentos);

    /* O teto de histórico do plano. Corta DEPOIS de tirar o que já entrou:
     * senão um mês inteiro já importado gastaria uma das vagas e esconderia
     * um mês que a pessoa ainda não viu.
     *
     * Os meses cortados são contados distintos no conjunto todo: dois
     * cartões sem o mesmo setembro são um setembro só na frase que a tela
     * mostra. */
    const { mesesDeHistorico } = await this.limites.direitosPara(userId);
    const cortados = new Set<string>();
    for (const c of contas) {
      const r = cortarPorHistorico(c.lancamentos, mesesDeHistorico, false);
      c.lancamentos = r.ficaram;
      r.mesesCortados.forEach((m) => cortados.add(m));
    }
    for (const k of cartoes) {
      const r = cortarPorHistorico(k.lancamentos, mesesDeHistorico, true);
      k.lancamentos = r.ficaram;
      r.mesesCortados.forEach((m) => cortados.add(m));
    }

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
      mesesForaDoPlano: cortados.size,
    };
  }

  // ------------------------------------------------------------- recusar
  /**
   * "Estes eu não quero" — dito desfazendo um lote.
   *
   * Guarda só o id no provedor. Para lembrar que alguém não quis, basta
   * saber qual era; valor, data e descrição não acrescentam nada e seriam
   * mais dado financeiro guardado sem necessidade.
   */
  async recusar(userId: string, providerTxIds: string[]) {
    const limpos = [...new Set((providerTxIds || []).filter(Boolean))];
    if (!limpos.length) return { recusados: 0 };

    await this.prisma.openFinanceRefusal.createMany({
      data: limpos.map((providerTxId) => ({ userId, providerTxId })),
      /* Recusar duas vezes é a mesma recusa: o índice único recusaria o
       * segundo, e o desfazer morreria por causa de um registro que já
       * existia. */
      skipDuplicates: true,
    });
    return { recusados: limpos.length };
  }

  // ------------------------------------------------------------ vincular
  /**
   * Diz qual conta/cartão DAQUI corresponde ao de lá.
   *
   * Sem isso a coluna da migração fica morta e toda sincronização pergunta
   * de novo o destino. Quem responde é a própria importação: a pessoa
   * escolheu "GOLD do Inter vai para o meu cartão X", e o app guarda.
   *
   * É opcional e reversível: desvincular é mandar `destinoId` nulo, e a conta
   * volta a ser comum, com o histórico inteiro.
   */
  /**
   * "Este lançamento que eu já tinha É o que o banco mandou."
   *
   * Grava no lançamento da pessoa o id da transação no provedor, e nada
   * mais. Valor, data, categoria, destino e DESCRIÇÃO continuam os dela —
   * copiar o texto do banco por cima desfaria uma edição que ela fez de
   * propósito.
   *
   * Isto existe para cercar a duplicata. Sem ele, quem reconhece o próprio
   * gasto na lista só tem duas saídas: deixar de fora (e a linha volta
   * amanhã) ou importar (e ficar com dois lançamentos do mesmo dinheiro).
   * Com o id gravado, a linha some da proposta para sempre — pelo mesmo
   * filtro que já impede o que foi importado de voltar.
   *
   * Quem decide é sempre a pessoa: o app NUNCA vincula sozinho.
   */
  async vincularLancamento(userId: string, transactionId: string, providerTxId: string) {
    const meu = await this.prisma.transaction.findFirst({
      where: { id: transactionId, userId },
      select: { id: true, providerTxId: true },
    });
    if (!meu) throw new NotFoundException('Lançamento não encontrado.');

    /* Já tem OUTRO id do banco: são duas transações diferentes do provedor
     * apontando para o mesmo lançamento daqui, e uma delas está errada. */
    if (meu.providerTxId && meu.providerTxId !== providerTxId) {
      throw new BadRequestException('Este lançamento já está ligado a outra transação do banco.');
    }

    /* E o id do banco não pode pertencer a dois lançamentos: seria o mesmo
     * dinheiro contado duas vezes, que é justamente o que isto evita. */
    const jaDeOutro = await this.prisma.transaction.findFirst({
      where: { userId, providerTxId, NOT: { id: transactionId } },
      select: { id: true },
    });
    if (jaDeOutro) {
      throw new BadRequestException('Esta transação do banco já está em outro lançamento.');
    }

    await this.prisma.transaction.update({
      where: { id: meu.id },
      data: { providerTxId, syncedAt: new Date() },
    });
    return { vinculado: true };
  }

  async vincular(
    userId: string,
    id: string,
    dados: { providerAccountId: string; destino: 'CONTA' | 'CARTAO'; destinoId: string | null },
  ) {
    const conexao = await this.minha(userId, id);

    if (dados.destino === 'CARTAO') {
      /* Primeiro solta quem estava vinculado a este recurso de lá: um cartão
       * de lá corresponde a UM daqui, e o índice único recusaria o segundo. */
      await this.prisma.creditCard.updateMany({
        where: { userId, connectionId: conexao.id, providerAccountId: dados.providerAccountId },
        data: { connectionId: null, providerAccountId: null },
      });
      if (!dados.destinoId) return { vinculado: false };
      const cartao = await this.prisma.creditCard.findFirst({
        where: { id: dados.destinoId, userId },
        select: { id: true },
      });
      if (!cartao) throw new NotFoundException('Cartão não encontrado.');
      await this.prisma.creditCard.update({
        where: { id: cartao.id },
        data: { connectionId: conexao.id, providerAccountId: dados.providerAccountId },
      });
      return { vinculado: true };
    }

    await this.prisma.bankAccount.updateMany({
      where: { userId, connectionId: conexao.id, providerAccountId: dados.providerAccountId },
      data: { connectionId: null, providerAccountId: null },
    });
    if (!dados.destinoId) return { vinculado: false };
    const conta = await this.prisma.bankAccount.findFirst({
      where: { id: dados.destinoId, userId },
      select: { id: true },
    });
    if (!conta) throw new NotFoundException('Conta não encontrada.');
    await this.prisma.bankAccount.update({
      where: { id: conta.id },
      data: { connectionId: conexao.id, providerAccountId: dados.providerAccountId },
    });
    return { vinculado: true };
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

  /**
   * Para onde esta conta (ou cartão) do banco vai, no app.
   *
   * Primeiro pelo par (conexão, conta no provedor), que é o vínculo normal.
   * Não achou, procura só pelo id da conta NO PROVEDOR, em qualquer conexão
   * da pessoa — e, achando, traz o vínculo para a conexão de agora.
   *
   * POR QUE A SEGUNDA BUSCA EXISTE: desconectar e conectar de novo cria um
   * consentimento novo, com outro id. Sem isto, o app perguntava outra vez
   * para onde vai cada conta e cada cartão, como se nunca tivesse visto
   * aquele banco — e quem reconecta já respondeu isso uma vez.
   *
   * O id da conta no provedor é o que amarra: ele é o mesmo banco, a mesma
   * agência e a mesma conta do outro lado. Se o provedor emitir um id novo a
   * cada consentimento, a segunda busca não acha nada e a tela volta a
   * perguntar — que é o comportamento de antes, e não um erro novo.
   */
  private async reencontrarDestino(
    tabela: 'bankAccount' | 'creditCard',
    userId: string,
    connectionId: string,
    providerAccountId: string,
  ): Promise<string | null> {
    const repo: any = this.prisma[tabela];
    const atual = await repo.findFirst({
      where: { userId, connectionId, providerAccountId },
      select: { id: true },
    });
    if (atual) return atual.id;

    const antigo = await repo.findFirst({
      where: { userId, providerAccountId },
      select: { id: true },
    });
    if (!antigo) return null;

    /* Reaponta para a conexão de agora: sem isto a busca de amanhã cairia de
     * novo no caminho longo, e o vínculo ficaria preso a um consentimento
     * revogado para sempre. */
    await repo.update({ where: { id: antigo.id }, data: { connectionId } });
    this.logger.log('reencontrei o destino de ' + providerAccountId + ' por reconexão');
    return antigo.id;
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
