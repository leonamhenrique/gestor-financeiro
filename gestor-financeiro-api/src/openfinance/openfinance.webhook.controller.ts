// ============================================================
// openfinance.webhook.controller.ts — o provedor avisa, em vez de esperarmos
// ============================================================
// Até aqui o app perguntava: às 6h, e quando a pessoa abria a tela de
// Importar. Medido no cronograma do provedor, ele sincroniza as transações
// a cada 3 horas — então a novidade podia ficar meio dia parada esperando
// alguém abrir uma tela. Com isto ele nos chama.
//
// POR QUE EM CONTROLLER PRÓPRIO
// As outras rotas vivem atrás do `OpenFinanceAtivo`, que exige token do app
// e confere a lista de quem enxerga. Aqui não há pessoa logada: quem bate é
// o provedor. Pôr a rota naquele controller significaria afrouxar o guard
// que protege todas as outras — e guard afrouxado para um caso vira guard
// afrouxado para todos.
//
// O QUE ELE NÃO FAZ
// Não grava lançamento. Não cria, não casa, não classifica. Chamada vinda
// de fora não mexe no dinheiro de ninguém: ela só recontra o que espera
// conferência, que é o número no menu Importar. A regra das oito condições
// continua valendo, e continua rodando quando a pessoa abre a tela.
//
// O CORPO É DADO, NUNCA ORDEM
// O que chega aqui foi escrito por outro sistema. Dele se lê apenas um
// identificador, e esse identificador só serve para PROCURAR uma conexão
// nossa. Se não achar, acabou — nada é criado a partir do que o corpo diz.
// ============================================================

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { comUsuario } from '../prisma/contexto';
import { OpenFinanceService, openFinanceLigado } from './openfinance.service';
import { PushService } from '../push/push.service';
import {
  esquemaExigido,
  segredoDeAssinatura,
  varianteQueBate,
} from './assinatura-do-webhook';

/** O segredo combinado, que vai no painel do provedor e no nosso ambiente. */
export function segredoDoWebhook(): string {
  return (process.env.POLP_WEBHOOK_TOKEN || '').trim();
}

/** Comparação que não vaza o tamanho nem o prefixo do segredo pelo tempo. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

@Controller('openfinance')
export class OpenFinanceWebhookController {
  private readonly logger = new Logger('OpenFinanceWebhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly openFinance: OpenFinanceService,
    private readonly push: PushService,
  ) {}

  /**
   * POST /openfinance/webhook
   *
   * Responde 200 e SAI. A reconferência roda depois, solta: ela baixa o
   * extrato do provedor e leva segundos, e quem está do outro lado tem
   * tempo limite e repete o aviso quando ele estoura. Segurar a resposta
   * para fazer o trabalho transformaria um aviso em três.
   *
   * 204 sem corpo porque não há nada que o provedor precise ler de volta.
   */
  /* `@Public()` porque o app fecha TUDO por omissão: há um guard de JWT
   * global, e sem esta marca nem o provedor com o segredo certo entraria.
   * A marca é explícita e aparece na revisão de propósito — abrir uma porta
   * tem de custar uma linha que alguém lê. O que protege esta aqui é o
   * segredo combinado, conferido logo abaixo. */
  @Public()
  @Post('webhook')
  @HttpCode(204)
  receber(
    @Headers('x-saldonline-token') token: string | undefined,
    @Headers() cabecalhos: Record<string, string>,
    @Body() corpo: any,
    @Req() req: any,
  ): void {
    /* Desligado, esta rota não existe — como o resto do módulo. */
    if (!openFinanceLigado()) throw new NotFoundException();

    /* Sem segredo configurado NÃO se aceita nada. O contrário — "sem
     * segredo, aceita todo mundo" — é a falha que se instala sozinha: basta
     * alguém esquecer a variável no ambiente novo e a porta fica aberta,
     * em silêncio, funcionando. */
    const segredo = segredoDoWebhook();
    if (!segredo || !token || !iguais(token, segredo)) throw new NotFoundException();

    /* A assinatura, em duas fases.
     *
     * Enquanto `OPENFINANCE_SIGNATURE` estiver vazia não se sabe COMO o
     * provedor assina — a documentação pública não diz o que é assinado nem
     * em que codificação. Então aqui se calcula cada variante conhecida, se
     * descobre qual bate, e se registra o NOME dela. A porta segue
     * protegida pelo segredo do header, que já foi conferido acima.
     *
     * Com o nome na variável, a assinatura passa a ser EXIGIDA, e vira a
     * segunda tranca. Nunca se registra o valor de assinatura nenhuma. */
    this.conferirAssinatura(cabecalhos, req);

    const evento = typeof corpo?.event === 'string' ? corpo.event : '';
    const recurso = typeof corpo?.resource_id === 'string' ? corpo.resource_id : '';
    if (!recurso) return;

    /* Sem await de propósito: a resposta já foi. O `catch` é obrigatório —
     * promessa solta que rejeita derruba o processo no Node. */
    void this.conferir(evento, recurso).catch((e: any) =>
      this.logger.warn('não consegui conferir um aviso: ' + (e?.message || 'erro')),
    );
  }

  /**
   * Confere — ou aprende — a assinatura do provedor.
   *
   * Lança `NotFoundException` só quando já se SABE o esquema e ele não
   * bate: aí a entrega é mesmo suspeita. Enquanto não se sabe, nada é
   * recusado por causa disto — recusar pelo que ainda não se entende
   * perderia entregas boas em silêncio, que é o pior desfecho possível
   * para um aviso que não se repete para sempre.
   */
  private conferirAssinatura(cabecalhos: Record<string, string>, req: any): void {
    const segredo = segredoDeAssinatura();
    const header = (cabecalhos || {})['x-webhook-signature'] || '';
    const exigido = esquemaExigido();

    if (!segredo) {
      if (exigido) {
        /* Exigir um esquema sem ter o segredo é uma configuração que não
         * pode funcionar: melhor recusar alto do que aceitar achando que
         * está conferindo. */
        this.logger.warn('OPENFINANCE_SIGNATURE exigido sem POLP_WEBHOOK_SIGNING_SECRET');
        throw new NotFoundException();
      }
      return;
    }

    /* `rawBody` são os BYTES exatos que chegaram. Reserializar o corpo já
     * interpretado não serve: um espaço a mais e o HMAC não fecha. */
    const cru: Buffer | undefined = req?.rawBody;
    const carimbo = (cabecalhos || {})['x-webhook-timestamp'] || undefined;
    const bateu = cru ? varianteQueBate(header, segredo, cru, carimbo) : null;

    if (exigido) {
      if (bateu !== exigido) throw new NotFoundException();
      return;
    }

    /* Fase de descoberta. Só o nome vai para o log. */
    if (!header) {
      this.logger.log('entrega sem cabeçalho de assinatura');
    } else if (bateu) {
      this.logger.log('assinatura confere pelo esquema "' + bateu + '" — ponha-o em OPENFINANCE_SIGNATURE');
    } else {
      this.logger.log('assinatura presente, nenhuma variante conhecida bateu');
    }
  }

  /**
   * De qual conexão é este aviso?
   *
   * O provedor manda `resource_id` com dois significados, e a documentação
   * é clara sobre qual é qual: nos eventos de recurso (`accounts`,
   * `credit_cards`, `consents`) é o id do CONSENTIMENTO; nos de transação
   * (`*.transactions`) é o id da conta ou do cartão lá. Nós guardamos os
   * dois — `consentId` na conexão, `providerAccountId` na conta e no cartão
   * —, então os dois caminhos chegam à mesma conexão.
   *
   * Procurar pelos dois em vez de confiar no nome do evento é de propósito:
   * um evento novo no catálogo deles não pode nos fazer ignorar um aviso.
   */
  private async conferir(evento: string, recursoId: string): Promise<void> {
    const porConsentimento = await this.prisma.openFinanceConnection.findFirst({
      where: { consentId: recursoId, revokedAt: null },
      select: { id: true, userId: true },
    });

    const conexao = porConsentimento ?? (await this.porRecurso(recursoId));
    if (!conexao) {
      /* Aviso de algo que não é nosso: pode ser de outro ambiente usando as
       * mesmas chaves, ou de uma conexão já desconectada aqui. Não é erro, e
       * não se registra o id — ele identifica a conta de alguém. */
      this.logger.log('aviso "' + evento + '" sem conexão correspondente, ignorado');
      return;
    }

    /* `comUsuario` é obrigatório: fora de uma requisição autenticada não há
     * dono no contexto, e com RLS forçado a consulta não enxergaria
     * lançamento nenhum — o resultado seria "tudo novo", em silêncio. */
    const novos = await comUsuario(conexao.userId, () =>
      this.openFinance.recontarPendentes(conexao.userId, conexao.id),
    );

    /* E avisa na HORA, em vez de esperar as 6h da manhã.
     *
     * Isto só é seguro porque o limite de um aviso por dia mora no serviço
     * de push, e não em quem chama: o provedor sincroniza a cada 3 horas, e
     * sem esse limite aqui seriam oito avisos por dia. Com ele, o primeiro
     * do dia sai quando a novidade chega, e os outros sete não viram nada.
     *
     * Falhar em avisar não pode estragar a contagem, que é a parte que a
     * tela usa — ela já está gravada quando se chega aqui. */
    if (novos > 0) {
      await comUsuario(conexao.userId, () => this.push.avisar(conexao.userId, novos)).catch(
        (e: any) => this.logger.warn('não consegui avisar: ' + (e?.message || 'erro')),
      );
    }
  }

  /** A conexão de uma conta ou de um cartão, pelo id que o provedor usa. */
  private async porRecurso(recursoId: string) {
    const conta = await this.prisma.bankAccount.findFirst({
      where: { providerAccountId: recursoId, connectionId: { not: null } },
      select: { userId: true, connectionId: true },
    });
    if (conta?.connectionId) return { id: conta.connectionId, userId: conta.userId };

    const cartao = await this.prisma.creditCard.findFirst({
      where: { providerAccountId: recursoId, connectionId: { not: null } },
      select: { userId: true, connectionId: true },
    });
    if (cartao?.connectionId) return { id: cartao.connectionId, userId: cartao.userId };

    return null;
  }
}
