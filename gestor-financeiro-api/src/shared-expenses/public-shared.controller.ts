// ============================================================
// public-shared.controller.ts
// ============================================================
// A página que o amigo abre, sem login.
//
// É a única rota do sistema que serve dado financeiro sem token de sessão, e
// por isso cada decisão aqui é sobre o que NÃO sai:
//
//   não sai  nome de conta nem de cartão (o extrato privado mostra "Cartão
//            Nubank"; aqui é só "Cartão"), e-mail, id interno de lançamento,
//            categoria, saldo de conta, e QUALQUER outra pessoa com quem eu
//            divida gasto.
//   sai      o nome de quem está devendo, os gastos que envolvem ELA, a
//            parte dela e o saldo entre nós dois. Nada além.
//
// 404 igual para token inexistente, revogado e vencido: a diferença entre
// eles é informação para quem está chutando token.
// ============================================================

import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { comUsuario } from '../prisma/contexto';
import { ShareLinksService } from './share-links.service';
import { SharedSummaryService } from './shared-summary.service';

// O limitador vale SÓ neste controlador, e não na API inteira: as rotas
// autenticadas já têm o token como porta, e pôr um guard global mudaria o
// comportamento de tudo que hoje funciona.
@UseGuards(ThrottlerGuard)
@Controller('public/shared')
export class PublicSharedController {
  constructor(
    private readonly links: ShareLinksService,
    private readonly resumos: SharedSummaryService,
  ) {}

  @Public()
  // Mais apertado que o resto da API: esta rota é a única porta aberta, e
  // adivinhar token é exatamente o ataque que ela convida. 20 por minuto dá
  // para a pessoa abrir e recarregar à vontade e não dá para varrer nada —
  // são 2^256 tokens possíveis.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token')
  async ver(@Param('token') token: string, @Query('month') month?: string) {
    const link = await this.links.resolver(token);
    // Um 404 só, para os três casos.
    if (!link) throw new NotFoundException('Link não encontrado');

    // Daqui para a frente tudo roda com o dono no contexto, e portanto sob o
    // RLS normal — a rota é pública, a consulta não é.
    const extrato = await comUsuario(link.userId, () =>
      this.resumos.extratoDaPessoa(link.userId, link.personId, month),
    );

    // O `.catch()` fica AQUI, e não só dentro do método: `void promessa` não
    // captura rejeição nenhuma, e uma promessa rejeitada sem dono derruba o
    // processo inteiro do Node. A página não pode cair por causa de um
    // carimbo de visita.
    this.links.registrarVisita(link.id).catch(() => undefined);

    return this.sóOQuePodeSair(extrato);
  }

  /**
   * A peneira. É uma lista do que SAI, nunca do que fica de fora: assim um
   * campo novo no extrato nasce invisível aqui, em vez de vazar por
   * esquecimento.
   */
  private sóOQuePodeSair(e: any) {
    return {
      person: { name: e.person.name, pixKey: e.person.pixKey },
      mes: e.mes,
      saldoAnterior: e.saldoAnterior,
      movimentoDoMes: e.movimentoDoMes,
      // Positivo: ela me deve. Negativo: eu devo a ela.
      saldo: e.saldoFinal,
      totalDoMes: e.totalDoMes,
      lancamentos: e.lancamentos.map((l: any) => ({
        date: l.date,
        description: l.description,
        total: l.total,
        parteDela: l.parteDela,
        percent: l.percent,
        // "Cartão" e "Conta", sem dizer QUAL: o banco em que eu tenho conta
        // não é da conta de quem me deve.
        forma: l.euPaguei ? (l.formaEhCartao ? 'Cartão' : 'Conta') : 'Pago por ela',
        pagoPorMim: l.euPaguei,
      })),
      acertos: e.acertos.map((a: any) => ({
        date: a.settledAt,
        direction: a.direction,
        amount: Number(a.amount),
        description: a.description ?? null,
      })),
    };
  }
}
