// ============================================================
// subscription-active.guard.ts
// ============================================================
// Aplica o bloqueio parcial nas rotas que CRIAM registro. Deliberadamente não
// é global: registrar este guard em todo o app bloquearia leitura e edição
// junto, que é exatamente o que não se quer — quem está inadimplente precisa
// continuar enxergando os próprios dados para decidir se paga, e precisa poder
// exportar ou apagar o que é dele.
//
// Uso: @UseGuards(JwtAuthGuard, SubscriptionActiveGuard) no @Post().
// ============================================================

import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { BillingService } from './billing.service';

@Injectable()
export class SubscriptionActiveGuard implements CanActivate {
  constructor(private readonly billing: BillingService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id ?? req.user?.sub;
    if (!userId) return true; // sem usuário, quem barra é o JwtAuthGuard

    if (await this.billing.podeCriarRegistros(userId)) return true;

    throw new ForbiddenException({
      code: 'SUBSCRIPTION_PAST_DUE',
      message:
        'Assinatura com pagamento pendente. Criar novos registros fica bloqueado até a quitação; ' +
        'consultar e editar o que já existe continua liberado.',
    });
  }
}
