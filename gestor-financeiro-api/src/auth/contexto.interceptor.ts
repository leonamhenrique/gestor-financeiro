import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { contextoDoPedido } from '../prisma/contexto';

/** Põe o dono da requisição no contexto, para o Prisma levá-lo até o banco.
 *
 * É interceptor e não middleware por uma razão de ordem: middleware roda
 * ANTES do guard, quando `req.user` ainda não existe. O interceptor roda
 * depois, com o token já conferido — e o id que vai para o banco é o do
 * token, não algo que o cliente possa escolher.
 *
 * O `new Observable` em volta não é enfeite. `next.handle()` devolve um
 * observable FRIO: o handler só roda quando alguém assina, e a assinatura
 * acontece depois que o `run()` já terminou. Escrito do jeito direto —
 * `return contexto.run(..., () => next.handle())` — o contexto estaria vazio
 * na hora que importa, o `app.user_id` não seria definido e, com RLS ligado,
 * TODA consulta voltaria vazia. Assinando aqui dentro, o handler roda dentro
 * do contexto.
 *
 * Rota pública não tem usuário e não põe nada: as tabelas com RLS ficam
 * invisíveis para ela, que é o certo — entrar e cadastrar mexem em `users`
 * e nos tokens de sessão, que não têm RLS. */
@Injectable()
export class ContextoDoUsuarioInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const userId = req?.user?.id;
    if (!userId) return next.handle();

    return new Observable((assinante) =>
      contextoDoPedido.run({ userId }, () => next.handle().subscribe(assinante)),
    );
  }
}
