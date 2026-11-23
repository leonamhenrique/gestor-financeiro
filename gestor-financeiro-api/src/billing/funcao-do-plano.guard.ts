// ============================================================
// funcao-do-plano.guard.ts — a função que o plano não tem
// ============================================================
// Irmão do `LimitesService`, para o outro tipo de trava. Lá a pergunta é
// "cabe mais um?"; aqui é "este plano TEM isto?".
//
// Guard e não chamada dentro do serviço, ao contrário dos limites de
// cadastro: estas são telas inteiras, e a borda é onde elas começam. O
// limite de cadastro mora no serviço porque o WhatsApp cria conta pela mesma
// função; aqui não há segunda porta.
//
// O erro carrega `code: 'PLAN_FEATURE'` e o nome da função, para a tela
// oferecer o plano certo em vez de repetir "acesso negado".
//
// LER CONTINUA LIBERADO onde o dado é da pessoa. Este guard vai nas rotas da
// FUNÇÃO (o fluxo de caixa, as despesas compartilhadas), não em cima de
// exportar ou apagar o que já é dela.
// ============================================================

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingService } from './billing.service';
import { Direitos } from './entitlements';

/** As chaves de `Direitos` que são sim ou não. */
export type FuncaoDoPlano = {
  [K in keyof Direitos]: Direitos[K] extends boolean ? K : never;
}[keyof Direitos];

export const FUNCAO_DO_PLANO = 'funcaoDoPlano';

/** Marca a rota (ou o controller inteiro) como função de plano. */
export const Funcao = (funcao: FuncaoDoPlano) => SetMetadata(FUNCAO_DO_PLANO, funcao);

/** O que dizer de cada uma, quando falta. */
const FRASE: Record<FuncaoDoPlano, string> = {
  fluxoDeCaixa: 'O fluxo de caixa do ano é do Pro.',
  compartilhadas: 'Dividir despesa com outras pessoas é do Pro.',
  avisos: 'Os avisos de lançamento esperando são do Pro.',
  compartilharPorLink: 'O link de leitura é do Pro.',
  planejamentoCompleto: 'Planejar outros meses é do Pro.',
};

@Injectable()
export class FuncaoDoPlanoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly billing: BillingService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const funcao = this.reflector.getAllAndOverride<FuncaoDoPlano>(FUNCAO_DO_PLANO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    /* Rota sem marca não é assunto deste guard. Ele é registrado por
     * controller, e nem toda rota de um controller marcado precisa cair
     * aqui. */
    if (!funcao) return true;

    const req = contexto.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id ?? req.user?.sub;
    if (!userId) return true; // sem usuário, quem barra é o JwtAuthGuard

    const direitos = await this.billing.direitos(userId);
    if (direitos[funcao]) return true;

    throw new ForbiddenException({
      code: 'PLAN_FEATURE',
      funcao,
      message: FRASE[funcao],
    });
  }
}
