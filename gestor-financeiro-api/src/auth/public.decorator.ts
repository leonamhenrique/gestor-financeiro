import { SetMetadata } from '@nestjs/common';

/** Marca uma rota como aberta, sem token.
 *
 * Existe porque o guard de autenticação passou a ser global: rota nova nasce
 * protegida, e abrir uma virou um ato explícito, que aparece no diff e na
 * revisão. Antes era o contrário — um controlador novo nascia público se
 * alguém esquecesse o `@UseGuards`, e esquecimento não faz barulho.
 *
 * Só cinco famílias de rota podem usar isto, e todas por necessidade:
 * entrar/cadastrar (quem ainda não tem token), renovar/sair (que se
 * identificam pelo cookie de sessão, não pelo token de acesso), o webhook
 * do provedor de pagamento, que é chamado por outro servidor, e a página de
 * despesa compartilhada, que é aberta por quem não tem conta no app — essa
 * se identifica pelo token do link, confere limite de requisições e devolve
 * 404 igual para token inválido, revogado e vencido, e o webhook do WhatsApp,
 * que é chamado pela Meta e se identifica pela assinatura HMAC do corpo
 * bruto, com limite de requisições e resposta 200 calada para todo mundo. */
export const IS_PUBLIC = 'rota_publica';

export const Public = () => SetMetadata(IS_PUBLIC, true);
