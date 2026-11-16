// ============================================================
// transactions.import.spec.ts
// ============================================================
// Gravar um extrato inteiro, e desfazê-lo.
//
// O que precisa ser provado: que o lote é TUDO OU NADA (uma linha ruim no
// meio não pode deixar meio mês lançado), que reenviar o mesmo lote não
// lança o dinheiro duas vezes, e que desfazer devolve o saldo.
// ============================================================

import { TransactionType } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

const utc = (s: string) => new Date(s + 'T00:00:00.000Z');

/* O lote pode trazer transferencia junto. Nestes testes nao traz, e o
 * dublê existe só para o serviço poder ser construído — se algum dia
 * for chamado sem que o teste espere, o jest.fn() denuncia. */
const transferencias = {
  criarEm: jest.fn(),
  desfazerDoLote: jest.fn(async () => []),
};

describe('TransactionsService — importar extrato', () => {
  let service: TransactionsService;
  let prisma: any;
  let transacoes: Map<string, any>;
  let series: any[];
  let saldo: number;
  let seq: number;
  let abortou: boolean;

  function casa(t: any, where: any = {}) {
    if (where.id && t.id !== where.id) return false;
    if (where.userId && t.userId !== where.userId) return false;
    if ('importBatchId' in where && t.importBatchId !== where.importBatchId) return false;
    if (where.clientKey && t.clientKey !== where.clientKey) return false;
    return true;
  }

  beforeEach(() => {
    transacoes = new Map();
    series = [];
    saldo = 1000;
    seq = 0;
    abortou = false;

    prisma = {
      // A transação de banco é de verdade no que importa aqui: se o callback
      // estourar, nada do que ele escreveu fica.
      $transaction: jest.fn(async (cb: any) => {
        const antes = new Map([...transacoes].map(([k, v]) => [k, { ...v }]));
        const saldoAntes = saldo;
        try {
          return await cb(prisma);
        } catch (e) {
          transacoes = antes;
          saldo = saldoAntes;
          abortou = true;
          throw e;
        }
      }),
      transactionSeries: {
        create: jest.fn(async ({ data }: any) => {
          const sr = { id: 's' + ++seq, ...data };
          series.push(sr);
          return { ...sr };
        }),
      },
      transaction: {
        create: jest.fn(async ({ data }: any) => {
          const t = { id: 't' + ++seq, invoiceMonthOverride: null, ...data };
          transacoes.set(t.id, t);
          return { ...t };
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const t = [...transacoes.values()].find((x) => casa(x, where));
          return t ? { ...t } : null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          [...transacoes.values()].filter((x) => casa(x, where)).map((x) => ({ ...x })),
        ),
        delete: jest.fn(async ({ where }: any) => {
          const t = transacoes.get(where.id);
          transacoes.delete(where.id);
          return t;
        }),
      },
      bankAccount: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 'acc-1' && where.userId === 'user-1' ? { id: 'acc-1' } : null,
        ),
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'acc-1' ? { id: 'acc-1' } : null,
        ),
        update: jest.fn(async ({ data }: any) => {
          saldo += Number(data.currentBalance.increment ?? 0) - Number(data.currentBalance.decrement ?? 0);
        }),
      },
      creditCard: { findFirst: jest.fn(async () => null) },
      category: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 'cat-1' ? { id: 'cat-1', name: 'Alimentação' } : null,
        ),
        count: jest.fn(async () => 0),
      },
    };
    service = new TransactionsService(prisma, transferencias as any);
  });

  const linha = (amount: number, extra: any = {}) => ({
    categoryId: 'cat-1',
    type: TransactionType.EXPENSE,
    amount,
    description: 'Compra',
    transactionDate: utc('2025-06-10'),
    bankAccountId: 'acc-1',
    isConfirmed: true,
    ...extra,
  });

  it('grava o extrato inteiro', async () => {
    const r = await service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20), linha(30)]);
    expect(r).toHaveLength(3);
    expect(transacoes.size).toBe(3);
  });

  it('o saldo cai pela soma do extrato', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20), linha(30)]);
    expect(saldo).toBe(940);
  });

  it('todas as linhas levam o carimbo do lote', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20)]);
    const todas = [...transacoes.values()];
    expect(todas.every((t) => t.importBatchId === 'imp-abc123')).toBe(true);
    expect(todas.every((t) => t.importedAt instanceof Date)).toBe(true);
  });

  /* A linha que veio do Open Finance guarda o id dela NO PROVEDOR. E o que
   * faz a proxima sincronizacao reencontrar o que ja entrou: o provedor
   * reenvia tudo a cada leitura, e sem esta coluna a lista de conferencia
   * viria cheia do que a pessoa importou ontem. Tambem e o que diz o que
   * apagar se a conexao cair -- com ele veio do banco, sem ele e do usuario. */
  it('a linha do Open Finance leva o id do provedor', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [
      linha(10, { providerTxId: 'tx-do-banco-1' }),
      linha(20),
    ]);
    const todas = [...transacoes.values()];
    const deLa = todas.filter((t) => t.providerTxId);
    expect(deLa).toHaveLength(1);
    expect(deLa[0].providerTxId).toBe('tx-do-banco-1');
    expect(deLa[0].syncedAt instanceof Date).toBe(true);

    // A de arquivo continua sem nada: nulo nao colide com nulo no indice.
    const daMao = todas.filter((t) => !t.providerTxId)[0];
    expect(daMao.providerTxId).toBeNull();
    expect(daMao.syncedAt).toBeNull();
  });

  /* Quem desfaz um lote que entrou sozinho precisa poder dizer "estes eu nao
   * quero" -- e para isso o desfazer tem de contar o que tirou. Sem esta
   * lista, o desfazer durava ate a proxima abertura da tela: o lancamento
   * some, volta a parecer novo, e entra de novo. */
  it('desfazer diz quais vieram do Open Finance', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [
      linha(10, { providerTxId: 'tx-do-banco-1' }),
      linha(20),
      linha(30, { providerTxId: 'tx-do-banco-2' }),
    ]);

    const r: any = await service.desfazerImportacao('user-1', 'imp-abc123');

    expect(r.removed).toBe(3);
    // So os que vieram de la: o lancamento de arquivo nao tem o que recusar.
    expect(r.providerTxIds.sort()).toEqual(['tx-do-banco-1', 'tx-do-banco-2']);
  });

  // ------------------------------------------------------- transferencia
  /* Um Pix que entrou numa conta e saiu de outra do mesmo dono nao e
   * receita: e dinheiro mudando de lugar. Ele entra no MESMO lote dos
   * lancamentos porque o botao Desfazer e um so -- e um desfazer que
   * devolvesse os lancamentos e deixasse o dinheiro mexido entre as duas
   * contas seria pior que nao ter botao. */
  it('a linha marcada como transferencia nao vira lancamento', async () => {
    await service.criarEmLote(
      'user-1',
      'imp-abc123',
      [linha(10)],
      [{ fromAccountId: 'acc-outra', toAccountId: 'acc-1', amount: 250, transferDate: '2026-08-26' }],
    );

    // Um lancamento, nao dois: a transferencia nao passou por aqui.
    expect(transacoes.size).toBe(1);
    expect((transferencias.criarEm as jest.Mock).mock.calls.at(-1)![1]).toMatchObject({
      amount: 250,
      fromAccountId: 'acc-outra',
      toAccountId: 'acc-1',
    });
  });

  it('a transferencia carrega o lote e a hora, para o desfazer alcancar', async () => {
    await service.criarEmLote(
      'user-1',
      'imp-abc123',
      [linha(10)],
      [{ fromAccountId: 'acc-outra', toAccountId: 'acc-1', amount: 250, transferDate: '2026-08-26',
         providerTxId: 'tx-pix-1' }],
    );

    // A ULTIMA chamada: o dublê é de módulo e guarda as dos testes anteriores.
    const [, pedido] = (transferencias.criarEm as jest.Mock).mock.calls.at(-1)!;
    expect(pedido).toMatchObject({
      userId: 'user-1',
      importBatchId: 'imp-abc123',
      providerTxId: 'tx-pix-1',
      isConfirmed: true,
    });
    expect(pedido.importedAt).toBeInstanceOf(Date);
    // Mesma chave de idempotencia dos lancamentos, com prefixo proprio para
    // nao colidir com a deles.
    expect(pedido.clientKey).toBe('imp-abc123:tr:0');
  });

  /* Um lote pode ser SO de transferencia -- todas as linhas marcadas. Antes
   * disto, desfazer esse lote respondia "importacao nao encontrada" porque a
   * busca so olhava lancamento: 404 com o dinheiro ja mexido. */
  it('lote so de transferencia tambem se desfaz', async () => {
    (transferencias.desfazerDoLote as jest.Mock).mockResolvedValueOnce([
      { providerTxId: 'tx-pix-1' },
      { providerTxId: null },
    ]);

    const r: any = await service.desfazerImportacao('user-1', 'imp-so-tr');

    expect(r.removed).toBe(2);
    expect(r.providerTxIds).toEqual(['tx-pix-1']);
  });

  it('lote que nao existe em lado nenhum continua sendo 404', async () => {
    await expect(service.desfazerImportacao('user-1', 'imp-nada')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('o carimbo de hora e o MESMO em todas', async () => {
    // Uma hora por linha faria "importações recentes" listar 74 lotes de uma
    // linha cada, em vez de um lote de 74.
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20), linha(30)]);
    const horas = new Set([...transacoes.values()].map((t) => t.importedAt.getTime()));
    expect(horas.size).toBe(1);
  });

  it('uma linha ruim no meio nao deixa meio extrato lancado', async () => {
    // É o ponto do lote. Sem isto, falhar na terceira de cinco deixaria duas
    // lançadas e ninguém sabendo onde parou.
    await expect(
      service.criarEmLote('user-1', 'imp-abc123', [
        linha(10),
        linha(20),
        linha(30, { categoryId: 'cat-que-nao-existe' }),
        linha(40),
      ]),
    ).rejects.toThrow(NotFoundException);
    expect(abortou).toBe(true);
    expect(transacoes.size).toBe(0);
    expect(saldo).toBe(1000);
  });

  it('conta de outro usuario derruba o lote', async () => {
    await expect(
      service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20, { bankAccountId: 'acc-alheia' })]),
    ).rejects.toThrow(NotFoundException);
    expect(transacoes.size).toBe(0);
    expect(saldo).toBe(1000);
  });

  it('reenviar o mesmo lote nao lanca o dinheiro de novo', async () => {
    // A resposta pode se perder no caminho e o app reenviar. Cada linha leva
    // a chave `lote:posicao`, e a segunda vez devolve o que ja esta gravado.
    const itens = [linha(10), linha(20)];
    await service.criarEmLote('user-1', 'imp-abc123', itens);
    await service.criarEmLote('user-1', 'imp-abc123', itens);
    expect(transacoes.size).toBe(2);
    expect(saldo).toBe(970);
  });

  it('lotes diferentes com o mesmo valor convivem', async () => {
    await service.criarEmLote('user-1', 'imp-aaa111', [linha(10)]);
    await service.criarEmLote('user-1', 'imp-bbb222', [linha(10)]);
    expect(transacoes.size).toBe(2);
    expect(saldo).toBe(980);
  });

  it('previsto nao mexe no saldo', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10, { isConfirmed: false })]);
    expect(transacoes.size).toBe(1);
    expect(saldo).toBe(1000);
  });

  it('desfazer apaga o lote e devolve o saldo', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10), linha(20), linha(30)]);
    expect(await service.desfazerImportacao('user-1', 'imp-abc123')).toEqual({ removed: 3, providerTxIds: [] });
    expect(transacoes.size).toBe(0);
    expect(saldo).toBe(1000);
  });

  it('desfazer nao encosta noutro lote', async () => {
    await service.criarEmLote('user-1', 'imp-aaa111', [linha(10)]);
    await service.criarEmLote('user-1', 'imp-bbb222', [linha(20)]);
    await service.desfazerImportacao('user-1', 'imp-aaa111');
    expect([...transacoes.values()].map((t) => t.importBatchId)).toEqual(['imp-bbb222']);
    expect(saldo).toBe(980);
  });

  it('desfazer lote de outro usuario nao apaga nada', async () => {
    await service.criarEmLote('user-1', 'imp-abc123', [linha(10)]);
    await expect(service.desfazerImportacao('outro', 'imp-abc123')).rejects.toThrow(NotFoundException);
    expect(transacoes.size).toBe(1);
  });

  it('desfazer lote inexistente da 404', async () => {
    await expect(service.desfazerImportacao('user-1', 'imp-nao-existe')).rejects.toThrow(NotFoundException);
  });

  describe('parcelas viram serie', () => {
    const parcela = (ref: string, i: number, total: number, amount = 34.36) =>
      ({ ...linha(amount), seriesRef: ref, seriesIndex: i, seriesCount: total });

    it('as parcelas da mesma compra entram na MESMA serie', async () => {
      // Sem isto o extrato produzia linhas independentes, e "excluir todos",
      // editar em serie e antecipar nao tinham como existir: tudo isso olha
      // seriesId, nada olha descricao.
      await service.criarEmLote('user-1', 'imp-abc123', [
        parcela('ml|34.36|EXPENSE', 5, 12),
        parcela('ml|34.36|EXPENSE', 6, 12),
      ]);
      expect(series).toHaveLength(1);
      const ids = [...transacoes.values()].map((t) => t.seriesId);
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).toBe(series[0].id);
    });

    it('compras diferentes ganham series diferentes', async () => {
      await service.criarEmLote('user-1', 'imp-abc123', [
        parcela('ml|34.36|EXPENSE', 0, 3),
        parcela('outra|99.90|EXPENSE', 0, 6, 99.9),
      ]);
      expect(series).toHaveLength(2);
    });

    it('a serie guarda o total da COMPRA, nao o numero de linhas', async () => {
      // O extrato traz so parte das parcelas. E o "12" de "6/12" que faz a
      // etiqueta ler certo, nao a contagem do que veio no arquivo.
      await service.criarEmLote('user-1', 'imp-abc123', [
        parcela('ml|34.36|EXPENSE', 5, 12),
        parcela('ml|34.36|EXPENSE', 6, 12),
      ]);
      expect(series[0].count).toBe(12);
      expect(transacoes.size).toBe(2);
    });

    it('a posicao de cada parcela e preservada', async () => {
      await service.criarEmLote('user-1', 'imp-abc123', [
        parcela('ml|34.36|EXPENSE', 5, 12),
        parcela('ml|34.36|EXPENSE', 6, 12),
      ]);
      expect([...transacoes.values()].map((t) => t.seriesIndex).sort()).toEqual([5, 6]);
    });

    it('linha sem serie continua solta', async () => {
      await service.criarEmLote('user-1', 'imp-abc123', [linha(10), parcela('ml|34.36|EXPENSE', 0, 2)]);
      expect(series).toHaveLength(1);
      const soltas = [...transacoes.values()].filter((t) => !t.seriesId);
      expect(soltas).toHaveLength(1);
    });
  });
});
