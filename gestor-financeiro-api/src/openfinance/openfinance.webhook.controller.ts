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
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { comUsuario } from '../prisma/contexto';
import { OpenFinanceService, openFinanceLigado } from './openfinance.service';

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
  ): void {
    /* Desligado, esta rota não existe — como o resto do módulo. */
    if (!openFinanceLigado()) throw new NotFoundException();

    /* Sem segredo configurado NÃO se aceita nada. O contrário — "sem
     * segredo, aceita todo mundo" — é a falha que se instala sozinha: basta
     * alguém esquecer a variável no ambiente novo e a porta fica aberta,
     * em silêncio, funcionando. */
    const segredo = segredoDoWebhook();
    if (!segredo || !token || !iguais(token, segredo)) throw new NotFoundException();

    /* Os NOMES dos cabeçalhos de assinatura, nunca os valores. O provedor
     * assina com HMAC-SHA256 em `X-Webhook-Signature`, mas a documentação
     * pública não diz o que exatamente é assinado nem em que codificação.
     * Implementar isso no escuro daria uma conferência que parece proteger
     * e não protege. Com o nome em mãos e a primeira entrega real, a
     * verificação entra por cima desta, como segunda tranca. */
    const assinaturas = Object.keys(cabecalhos || {}).filter((h) => /signature|hmac/i.test(h));
    if (assinaturas.length) this.logger.log('cabeçalhos de assinatura: ' + assinaturas.join(', '));

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
    await comUsuario(conexao.userId, () =>
      this.openFinance.recontarPendentes(conexao.userId, conexao.id),
    );
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
