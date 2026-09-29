import { SetMetadata } from '@nestjs/common';

/** Marca uma rota como aberta, sem token.
 *
 * Existe porque o guard de autenticação passou a ser global: rota nova nasce
 * protegida, e abrir uma virou um ato explícito, que aparece no diff e na
 * revisão. Antes era o contrário — um controlador novo nascia público se
 * alguém esquecesse o `@UseGuards`, e esquecimento não faz barulho.
 *
 * Só três famílias de rota podem usar isto, e todas por necessidade:
 * entrar/cadastrar (quem ainda não tem token), renovar/sair (que se
 * identificam pelo cookie de sessão, não pelo token de acesso) e o webhook
 * do provedor de pagamento, que é chamado por outro servidor. */
export const IS_PUBLIC = 'rota_publica';

export const Public = () => SetMetadata(IS_PUBLIC, true);
