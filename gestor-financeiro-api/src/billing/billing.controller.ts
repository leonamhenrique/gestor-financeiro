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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
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

  @Get('plans')
  planos() {
    return this.billing.planos();
  }

  @Get('subscription')
  async minhaAssinatura(@Req() req: RequisicaoAutenticada) {
    const userId = req.user.id ?? req.user.sub!;
    const assinatura = await this.billing.obterAssinatura(userId);
    return {
      assinatura,
      podeCriarRegistros: await this.billing.podeCriarRegistros(userId),
      // Se existe gateway capaz de abrir tela de pagamento. Com o provedor
      // falso não existe, e a tela precisa saber disso ANTES de oferecer um
      // plano: oferecer e falhar no clique é pior do que não oferecer.
      checkoutDisponivel: typeof this.gateway.criarCheckout === 'function',
    };
  }

  /**
   * `paymentToken` vem do SDK do gateway rodando no navegador. O número do
   * cartão não passa por aqui — se algum dia esse corpo aceitar PAN, a API
   * inteira entra no escopo pesado do PCI-DSS.
   */
  @Post('subscribe')
  async assinar(
    @Req() req: RequisicaoAutenticada,
    @Body() body: { planCode: string; paymentToken: string },
  ) {
    const userId = req.user.id ?? req.user.sub!;
    return this.billing.assinar(userId, body.planCode, body.paymentToken);
  }

  @Delete('subscription')
  async cancelar(
    @Req() req: RequisicaoAutenticada,
    @Query('imediato') imediato?: string,
  ) {
    const userId = req.user.id ?? req.user.sub!;
    return this.billing.cancelar(userId, imediato !== 'true');
  }

  /**
   * Abre a tela de pagamento hospedada pelo gateway e devolve o endereço.
   *
   * Nenhum dado de pagamento passa por aqui — nem cartão, nem CPF. Quem pede
   * o CPF é a tela do gateway, direto ao pagador: o dado não entra no nosso
   * banco nem na declaração de Data Safety da Play.
   */
  @Post('checkout')
  async checkout(@Req() req: RequisicaoAutenticada, @Body() body: { planCode: string }) {
    const userId = req.user.id ?? req.user.sub!;
    return this.billing.iniciarCheckout(userId, body.planCode);
  }

  @Public()
  @Post('webhook')
  async webhook(@Req() req: { rawBody?: Buffer }, @Headers() cabecalhos: Record<string, string>) {
    if (!req.rawBody) {
      throw new Error('Corpo bruto ausente: habilite `rawBody: true` em NestFactory.create.');
    }
    // Qual cabeçalho carrega a credencial é coisa de cada gateway, e quem
    // sabe disso é o adaptador: o Stripe assina o corpo em
    // `x-webhook-signature`, o Asaas manda um token fixo em
    // `asaas-access-token`. Fixar um nome aqui prenderia o controlador a um
    // provedor — e, pior, calaria a autenticação do outro.
    const nome = this.gateway.cabecalhoDeAutenticacao.toLowerCase();
    const evento = this.gateway.lerWebhook(req.rawBody, cabecalhos[nome] ?? '');
    const resultado = await this.billing.aplicarEvento(evento);
    return { recebido: true, resultado };
  }
}
