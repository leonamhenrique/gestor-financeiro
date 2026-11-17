// ============================================================
// openfinance.scheduler.ts — quem pergunta ao banco, uma vez por dia
// ============================================================
// O trabalho que tira o "Buscar" do caminho da pessoa.
//
// POR QUE UM TRABALHO, E NÃO UMA CONSULTA AO ABRIR O APP
// Contar quantos lançamentos esperam custa baixar o extrato inteiro do
// provedor — centenas de transações, medido. Fazer isso a cada abertura do
// app seria pagar esse preço para, na maioria das vezes, não mostrar nada.
// Aqui é uma vez por dia, por conexão, e o número fica guardado.
//
// POR QUE ELE NÃO GRAVA LANÇAMENTO NENHUM
// Mesmo motivo de todo o resto deste módulo: a integração PROPÕE. Um
// trabalho que roda sozinho, de madrugada, sem ninguém olhando, é o último
// lugar do app onde seria aceitável gravar dinheiro sem confirmação.
//
// FALHA DE UMA CONEXÃO NÃO DERRUBA AS OUTRAS
// Provedor fora, consentimento expirado, banco em manutenção: cada conexão
// é tratada sozinha, e o que falha fica com o número de ontem — que a tela
// mostra com a data ao lado, para ninguém confundir com o de hoje.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { comUsuario } from '../prisma/contexto';
import { FUSO_DO_APP } from '../credit-cards/invoice-statement';
import { OpenFinanceService, openFinanceLigado } from './openfinance.service';
import { PushService } from '../push/push.service';

@Injectable()
export class OpenFinanceScheduler {
  private readonly logger = new Logger(OpenFinanceScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openFinance: OpenFinanceService,
    private readonly push: PushService,
  ) {}

  /* De manhã cedo, e não de madrugada: o banco publica a compra do dia
   * anterior ao longo da noite, e perguntar às 6h pega o movimento fechado
   * de ontem. Antes disso, a resposta viria pela metade. */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { timeZone: FUSO_DO_APP })
  async contarPendentesDoDia() {
    /* A flag desligada não é caso de erro: é o app de antes, em que este
     * trabalho não existia. */
    if (!openFinanceLigado()) return;

    const conexoes = await this.prisma.openFinanceConnection.findMany({
      where: { revokedAt: null, status: 'AUTHORISED' },
      select: { id: true, userId: true, institutionName: true },
    });
    if (!conexoes.length) return;

    let comNovidade = 0;
    for (const c of conexoes) {
      try {
        /* `comUsuario` é obrigatório: fora de uma requisição não há dono no
         * contexto, e com RLS forçado a consulta não enxergaria lançamento
         * nenhum — o resultado seria "tudo novo", todo dia, em silêncio. */
        const total = await comUsuario(c.userId, () =>
          this.openFinance.recontarPendentes(c.userId, c.id),
        );
        if (total > 0) {
          comNovidade++;
          /* O aviso sai DAQUI e de lugar nenhum mais: é aqui que se sabe
           * quantos esperam, e é uma vez por dia. O provedor sincroniza a
           * cada 3 horas, e avisar a cada sincronização seriam oito avisos
           * por dia — é assim que uma notificação útil vira uma que a
           * pessoa desliga.
           *
           * Falhar em avisar não pode estragar a contagem, que é a parte
           * que a tela usa: o número já está gravado quando se chega aqui. */
          await comUsuario(c.userId, () => this.push.avisar(c.userId, total)).catch(() => {});
        }
      } catch (e: any) {
        /* Sem id de usuário e sem nome de banco no log: isto roda para todo
         * mundo, e o log não é lugar de dizer quem banca com quem. */
        this.logger.warn(
          'não consegui contar os pendentes de uma conexão: ' + (e?.message || 'erro'),
        );
      }
    }

    this.logger.log(
      conexoes.length + ' conexão(ões) conferida(s), ' + comNovidade + ' com novidade.',
    );
  }
}
