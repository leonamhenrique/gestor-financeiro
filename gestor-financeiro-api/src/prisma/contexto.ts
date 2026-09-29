import { AsyncLocalStorage } from 'async_hooks';

/** Quem está pedindo, durante uma requisição.
 *
 * É `AsyncLocalStorage` e não uma variável qualquer porque o Node atende
 * várias requisições ao mesmo tempo na mesma thread: uma variável global
 * guardaria o último que chegou, e a consulta de um usuário sairia com o dono
 * do outro. O ALS acompanha a cadeia de `await` de cada requisição
 * separadamente — é a única forma correta de fazer isto.
 *
 * `emTransacao` evita transação dentro de transação: quando o `$transaction`
 * já fixou o dono, as consultas de dentro não precisam (nem podem) abrir
 * outra para fixar de novo. */
export interface ContextoDaRequisicao {
  userId?: string;
  emTransacao?: boolean;
}

export const contextoDoPedido = new AsyncLocalStorage<ContextoDaRequisicao>();

/** Roda `fn` com este dono no contexto. Tudo que o Prisma fizer lá dentro
 * carrega `app.user_id` até o banco, e é isso que as políticas de RLS leem. */
export function comUsuario<T>(userId: string, fn: () => T): T {
  return contextoDoPedido.run({ userId }, fn);
}

export function usuarioDoContexto(): string | undefined {
  return contextoDoPedido.getStore()?.userId;
}
