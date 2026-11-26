// ============================================================
// fim-do-teste.scheduler.ts — o teste acaba, e ninguém é pego de surpresa
// ============================================================
// Duas coisas acontecem no fim do teste de 30 dias, e as duas moram aqui
// porque caem na mesma manhã e no mesmo aparelho:
//
//   1. O BANCO É DESLIGADO ANTES DA VIRADA DO MÊS. Cada consentimento é
//      cobrado na nossa conta do provedor, e um que atravessa o dia 1º pode
//      ser cobrado de novo. Conta que nunca pagou não gera custo recorrente.
//      A data sai de `janela-do-banco.ts`, e a pessoa a viu na hora de
//      conectar — não é letra miúda.
//
//   2. OS AVISOS DE QUE O TESTE ACABA, sete e três dias antes. O segundo é
//      o que traz a oferta: assinar agora, com o primeiro débito só no dia
//      em que o teste acabaria. Quem já decidiu não precisa esperar perder
//      o acesso para pagar.
//
// UM AVISO POR PESSOA POR DIA
// Os dois assuntos podem cair juntos. Em vez de mandar dois pushes e deixar
// o teto diário do `PushService` escolher um ao acaso, eles são juntados
// aqui: o título é o do assunto mais pesado, e o texto leva os dois.
//
// POR QUE ELE RODA MESMO COM O OPEN FINANCE DESLIGADO
// A flag esconde a FUNÇÃO; ela não cancela consentimento nenhum. Desligar a
// flag com conexão viva e parar de revogar seria continuar pagando por ela
// todo mês, em silêncio. Se a revogação falhar — provedor fora, credencial
// ausente —, o log grita e amanhã tenta de novo.
//
// E QUEM PAGA NÃO PERDE NADA
// A pergunta é feita conexão por conexão, no dia: quem assinou no meio do
// teste tem a conexão poupada sem que nada precise ser desfeito.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { comUsuario } from '../prisma/contexto';
import { FUSO_DO_APP, hojeNoFuso } from '../credit-cards/invoice-statement';
import { BillingService } from '../billing/billing.service';
import { AVISOS_DO_FIM_DO_TESTE, diasDeTeste, noTeste } from '../billing/entitlements';
import { OpenFinanceService } from './openfinance.service';
import { PushService } from '../push/push.service';
import { diaDoAvisoDeDesligamento, diaDoDesligamento } from './janela-do-banco';

/** Um assunto do dia, para uma pessoa. O maior `peso` dá o título. */
interface Recado {
  peso: number;
  titulo: string;
  texto: string;
}

/** 'AAAA-MM-DD' vira '31/12', que é como a frase lê melhor. */
export function emDiaEMes(dia: string): string {
  const partes = dia.split('-');
  return partes[2] + '/' + partes[1];
}

@Injectable()
export class FimDoTesteScheduler {
  private readonly logger = new Logger(FimDoTesteScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly openFinance: OpenFinanceService,
    private readonly push: PushService,
  ) {}

  /* Às 6h, junto do outro trabalho do módulo. O aviso do fim do teste leva a
   * vaga do dia no aparelho, e a contagem de pendentes volta amanhã; desligar
   * o banco primeiro também evita contar pendentes de conexão que morre em
   * seguida. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { timeZone: FUSO_DO_APP })
  async cuidarDoFimDoTeste() {
    const hoje = hojeNoFuso();
    const recados = new Map<string, Recado[]>();
    const juntar = (userId: string, r: Recado) => {
      const lista = recados.get(userId) ?? [];
      lista.push(r);
      recados.set(userId, lista);
    };

    const desligados = await this.cuidarDosBancos(hoje, juntar);
    const noPrazo = await this.cuidarDosTestes(juntar);

    for (const [userId, lista] of recados) {
      lista.sort((a, b) => b.peso - a.peso);
      const texto = lista.map((r) => r.texto).join(' ');
      await comUsuario(userId, () =>
        this.push.avisarTexto(userId, lista[0].titulo, texto),
      ).catch(() => {});
    }

    if (desligados || noPrazo || recados.size) {
      this.logger.log(
        desligados +
          ' banco(s) desligado(s), ' +
          noPrazo +
          ' teste(s) no prazo de aviso, ' +
          recados.size +
          ' pessoa(s) avisada(s).',
      );
    }
  }

  /** Desliga o banco de quem não paga, e avisa três dias antes. */
  private async cuidarDosBancos(
    hoje: string,
    juntar: (userId: string, r: Recado) => void,
  ): Promise<number> {
    const conexoes = await this.prisma.openFinanceConnection.findMany({
      where: { revokedAt: null, authorizedAt: { not: null } },
      select: { id: true, userId: true, authorizedAt: true, institutionName: true },
    });
    /* A resposta por pessoa é lembrada: quem conectou cinco bancos no Pro
     * não vira cinco consultas de plano. */
    const paga = new Map<string, boolean>();
    let desligados = 0;

    for (const c of conexoes) {
      try {
        if (!paga.has(c.userId)) paga.set(c.userId, await this.billing.estaPagando(c.userId));
        if (paga.get(c.userId)) continue;

        const banco = c.institutionName || 'O banco conectado';
        /* O dia da AUTORIZAÇÃO, no fuso do app: é quando o provedor passa a
         * cobrar, e não quando a pessoa clicou em conectar. */
        const desde = hojeNoFuso(c.authorizedAt as Date);
        const desliga = diaDoDesligamento(desde);

        if (hoje >= desliga) {
          await comUsuario(c.userId, () => this.openFinance.desconectar(c.userId, c.id));
          desligados++;
          juntar(c.userId, {
            peso: 3,
            titulo: 'O banco foi desconectado',
            texto: banco + ' parou de lançar sozinho. O que já entrou continua aqui.',
          });
        } else if (hoje === diaDoAvisoDeDesligamento(desde)) {
          juntar(c.userId, {
            peso: 2,
            titulo: 'O banco se desconecta em 3 dias',
            texto:
              banco +
              ' para de lançar sozinho em ' +
              emDiaEMes(desliga) +
              '. No Pro ele continua conectado.',
          });
        }
      } catch (e: any) {
        /* Sem id de pessoa e sem nome de banco no log: isto roda para todo
         * mundo. Falhar aqui é caro — significa um consentimento vivo na
         * virada do mês —, então é `error` e não `warn`. */
        this.logger.error(
          'não consegui tratar uma conexão no fim do teste: ' + (e?.message || 'erro'),
        );
      }
    }
    return desligados;
  }

  /** Avisa quem está a 7 e a 3 dias do fim do teste. */
  private async cuidarDosTestes(
    juntar: (userId: string, r: Recado) => void,
  ): Promise<number> {
    const candidatos = await this.prisma.user.findMany({
      where: { trialEndsAt: { gt: new Date() } },
      select: { id: true },
    });
    let noPrazo = 0;

    for (const u of candidatos) {
      try {
        /* `noTeste` e não a data crua: quem assinou no meio do teste ainda
         * tem `trial_ends_at` no futuro, e avisá-lo de um fim que não o
         * atinge seria assustar justamente quem já pagou. */
        const estado = await this.billing.estadoDoPlano(u.id);
        if (!noTeste(estado)) continue;
        const faltam = diasDeTeste(estado);
        if (!AVISOS_DO_FIM_DO_TESTE.includes(faltam)) continue;

        noPrazo++;
        const ultimo = faltam <= 3;
        juntar(u.id, {
          peso: ultimo ? 2 : 1,
          titulo: 'Seu teste acaba em ' + faltam + (faltam === 1 ? ' dia' : ' dias'),
          texto: ultimo
            ? 'Assinando agora, o primeiro débito é só no dia em que o teste acabaria.'
            : 'Depois disso a conta volta ao grátis, com 1 conta e 1 cartão.',
        });
      } catch (e: any) {
        this.logger.warn('não consegui conferir um teste: ' + (e?.message || 'erro'));
      }
    }
    return noPrazo;
  }
}
