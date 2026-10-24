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

describe('TransactionsService — importar extrato', () => {
  let service: TransactionsService;
  let prisma: any;
  let transacoes: Map<string, any>;
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
    service = new TransactionsService(prisma);
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
    expect(await service.desfazerImportacao('user-1', 'imp-abc123')).toEqual({ removed: 3 });
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
});
