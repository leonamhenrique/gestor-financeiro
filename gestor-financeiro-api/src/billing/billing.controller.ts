// ============================================================
// billing.controller.ts
// ============================================================
// O webhook fica FORA do JwtAuthGuard de propósito: quem chama é o gateway,
// não um usuário logado. A autenticação dele é a assinatura criptográfica do
// corpo, verificada pelo adaptador do provedor — por isso a rota precisa do
// corpo BRUTO (ver `rawBody: true` no main.ts). Um body já parseado e
// re-serializado não bate com a assinatura.
// ============================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';
import { PAYMENT_PROVIDER, PaymentProviderPort } from './payment-provider.port';
import { Inject } from '@nestjs/common';

interface RequisicaoAutenticada extends Request {
  user: { id?: string; sub?: string };
}

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProviderPort,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  async minhaAssinatura(@Req() req: RequisicaoAutenticada) {
    const userId = req.user.id ?? req.user.sub!;
    const assinatura = await this.billing.obterAssinatura(userId);
    return {
      assinatura,
      podeCriarRegistros: await this.billing.podeCriarRegistros(userId),
    };
  }

  /**
   * `paymentToken` vem do SDK do gateway rodando no navegador. O número do
   * cartão não passa por aqui — se algum dia esse corpo aceitar PAN, a API
   * inteira entra no escopo pesado do PCI-DSS.
   */
  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  async assinar(
    @Req() req: RequisicaoAutenticada,
    @Body() body: { planCode: string; paymentToken: string },
  ) {
    const userId = req.user.id ?? req.user.sub!;
    return this.billing.assinar(userId, body.planCode, body.paymentToken);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('subscription')
  async cancelar(
    @Req() req: RequisicaoAutenticada,
    @Query('imediato') imediato?: string,
  ) {
    const userId = req.user.id ?? req.user.sub!;
    return this.billing.cancelar(userId, imediato !== 'true');
  }

  @Post('webhook')
  async webhook(
    @Req() req: { rawBody?: Buffer },
    @Headers('x-webhook-signature') assinatura: string,
  ) {
    if (!req.rawBody) {
      throw new Error('Corpo bruto ausente: habilite `rawBody: true` em NestFactory.create.');
    }
    const evento = this.gateway.lerWebhook(req.rawBody, assinatura);
    const resultado = await this.billing.aplicarEvento(evento);
    return { recebido: true, resultado };
  }
}
