import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC } from './public.decorator';

/** Guard de autenticação. Registrado como global em `AppModule`, então vale
 * para toda rota da API — inclusive as que ainda não foram escritas.
 *
 * A única saída é o `@Public()`, que é explícito e revisável. É a diferença
 * entre proteger por adesão e proteger por padrão: antes, um controlador novo
 * sem `@UseGuards` nascia aberto, e ninguém percebia até alguém procurar. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // `getAllAndOverride` olha o método e depois a classe: dá para abrir um
    // controlador inteiro ou só uma rota dele.
    const publica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (publica) return true;
    return super.canActivate(context);
  }
}
