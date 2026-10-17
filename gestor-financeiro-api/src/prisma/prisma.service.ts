import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { contextoDoPedido } from './contexto';

/** O Prisma do app, com o dono da requisição amarrado em toda consulta.
 *
 * O banco tem Row Level Security: as tabelas de dado pessoal só devolvem
 * linha de quem está em `app.user_id`. Este serviço é quem põe esse valor lá,
 * e o ponto delicado é ONDE ele é posto.
 *
 * A API fala com o Neon por conexão em POOL, e conexão de pool é reaproveitada
 * entre requisições. Definir o dono na SESSÃO seria o erro clássico: o valor
 * do usuário A ficaria na conexão e a requisição do usuário B, caindo nela,
 * leria o dado de A. Vazaria tudo, que é o oposto do que o RLS existe para
 * fazer. Por isso `set_config(..., true)` — o `true` é "local", vale até o
 * fim da TRANSAÇÃO e some junto com ela.
 *
 * Duas portas, porque consulta acontece de dois jeitos:
 *
 *   fora de transação  a extensão junta `set_config` e a consulta num lote,
 *                      que o Prisma executa como uma transação só;
 *   dentro de uma      `$transaction` fixa o dono na primeira linha e marca
 *                      `emTransacao`, para a extensão não tentar abrir outra.
 *
 * Sem dono no contexto, nada é fixado e o banco não devolve nada. É de
 * propósito: falha fechada. Código de sistema que precisa varrer todo mundo
 * (a rotina noturna) roda de usuário em usuário, com o dono certo em cada um
 * — não existe atalho para ver tudo, nem para mim. */
/**
 * Erro de CONEXÃO MORTA, e não de pedido inválido.
 *
 * O Neon fecha conexão ociosa, e a instância do Render hiberna depois de 15
 * minutos. Quando ela acorda, o pool do Prisma ainda guarda sockets que o
 * banco já descartou — a primeira consulta a pegar um deles falha com
 * "Server has closed the connection" (P1017) ou "Can't reach database"
 * (P1001). Medido em produção: serviço no ar às 07:43, erro às 08:40, na
 * primeira consulta depois de quase uma hora parada.
 *
 * Nada disso é culpa do pedido: ele nunca chegou ao banco.
 */
export function conexaoMorreu(e: unknown): boolean {
  const codigo = (e as { code?: string })?.code;
  if (codigo === 'P1001' || codigo === 'P1017') return true;
  const msg = String((e as { message?: string })?.message ?? '');
  return /closed the connection|Connection reset|connection closed|ECONNRESET/i.test(msg);
}

/**
 * Tenta de novo UMA vez quando a conexão estava morta.
 *
 * Repetir é seguro aqui porque o pedido não chegou a ser executado: o erro
 * acontece ao escrever num socket que o banco já fechou. E é sempre uma
 * consulta só ou uma transação inteira — transação que falhou ao começar não
 * aplicou nada, então não existe meia gravação para duplicar.
 *
 * Uma vez, e não em laço: se a segunda também falhar, o banco está fora de
 * verdade, e insistir só transformaria uma falha rápida numa lenta.
 */
export async function comReconexao<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!conexaoMorreu(e)) throw e;
    return fn();
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super();

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let estendido: any;
    estendido = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }: any) {
            const ctx = contextoDoPedido.getStore();
            if (!ctx?.userId || ctx.emTransacao) {
              return comReconexao(() => query(args));
            }
            const lote = await comReconexao<any[]>(() =>
              estendido.$transaction([
                estendido.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`,
                query(args),
              ]),
            );
            return lote[1];
          },
        },
      },
    });

    // O Nest injeta esta classe, mas quem carrega a extensão é o cliente
    // estendido. O proxy manda os modelos (`transaction`, `bankAccount`…)
    // para ele e guarda aqui o que é do ciclo de vida e o `$transaction`
    // reescrito abaixo.
    return new Proxy(this, {
      get(alvo, prop, receptor) {
        if (prop === '$transaction' || prop === '$connect' || prop === '$disconnect') {
          return Reflect.get(alvo, prop, receptor);
        }
        const doEstendido = estendido[prop];
        if (typeof doEstendido === 'function') return doEstendido.bind(estendido);
        return doEstendido !== undefined ? doEstendido : Reflect.get(alvo, prop, receptor);
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  /** Transação interativa: fixa o dono antes de qualquer coisa rodar dentro. */
  $transaction(...args: any[]): any {
    const fn = args[0];
    if (typeof fn !== 'function') return super.$transaction(...(args as [any]));

    const ctx = contextoDoPedido.getStore();
    // Mesma reconexão das consultas soltas: a transação que não chegou a
    // abrir não aplicou nada, então repeti-la não duplica gravação nenhuma.
    return comReconexao(() =>
      super.$transaction(async (tx: any) => {
        if (ctx?.userId) {
          await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
        }
        return contextoDoPedido.run({ ...ctx, emTransacao: true }, () => fn(tx));
      }, args[1]),
    );
  }
}
