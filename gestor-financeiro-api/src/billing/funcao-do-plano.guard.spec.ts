// ============================================================
// funcao-do-plano.guard.spec.ts
// ============================================================
// O guard que barra tela inteira. O que importa aqui:
//
// 1. rota sem marca não é assunto dele — ele é registrado por controller, e
//    nem toda rota do controller é função de plano;
// 2. o 403 carrega `code` e o NOME da função, para a tela oferecer o plano
//    certo em vez de repetir "acesso negado";
// 3. sem usuário ele não decide nada: quem barra é o JwtAuthGuard.
// ============================================================

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FuncaoDoPlanoGuard } from './funcao-do-plano.guard';

describe('FuncaoDoPlanoGuard', () => {
  const contexto = (user: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    }) as any;

  function montar(marca: string | undefined, direitos: any) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(marca) } as unknown as Reflector;
    const billing = { direitos: jest.fn().mockResolvedValue(direitos) } as any;
    return { guard: new FuncaoDoPlanoGuard(reflector, billing), billing };
  }

  it('rota sem marca passa, e nem pergunta o plano', async () => {
    const { guard, billing } = montar(undefined, {});
    await expect(guard.canActivate(contexto({ id: 'u1' }))).resolves.toBe(true);
    expect(billing.direitos).not.toHaveBeenCalled();
  });

  it('com a função no plano, passa', async () => {
    const { guard } = montar('fluxoDeCaixa', { fluxoDeCaixa: true });
    await expect(guard.canActivate(contexto({ id: 'u1' }))).resolves.toBe(true);
  });

  it('sem a função, 403 com o código e o nome dela', async () => {
    const { guard } = montar('fluxoDeCaixa', { fluxoDeCaixa: false });
    try {
      await guard.canActivate(contexto({ id: 'u1' }));
      fail('devia ter barrado');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.getResponse()).toMatchObject({ code: 'PLAN_FEATURE', funcao: 'fluxoDeCaixa' });
      expect(e.getResponse().message).toContain('Pro');
    }
  });

  it('cada função tem a sua frase', async () => {
    const { guard } = montar('compartilhadas', { compartilhadas: false });
    try {
      await guard.canActivate(contexto({ id: 'u1' }));
      fail('devia ter barrado');
    } catch (e: any) {
      expect(e.getResponse().message).toContain('Dividir despesa');
    }
  });

  /* Sem usuário o guard não é quem decide: deixar passar aqui entrega a
   * decisão para o JwtAuthGuard, que é quem sabe falar de sessão. */
  it('sem usuário, não decide nada', async () => {
    const { guard, billing } = montar('fluxoDeCaixa', { fluxoDeCaixa: false });
    await expect(guard.canActivate(contexto(undefined))).resolves.toBe(true);
    expect(billing.direitos).not.toHaveBeenCalled();
  });
});
