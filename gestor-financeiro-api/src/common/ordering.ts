// ============================================================
// ordering.ts
// ============================================================
// Ordem escolhida pelo usuário (arrastar na lista). Mesma regra do app:
// os ids enviados vão para a frente, na ordem enviada, e os que ficaram de
// fora mantêm a ordem relativa atrás deles. Assim o cliente pode mandar só a
// lista que está vendo (ex: as contas ativas) sem embaralhar as arquivadas.
// ============================================================

import { BadRequestException, NotFoundException } from '@nestjs/common';

/** `atuais` já na ordem atual. Devolve os ids na ordem final. */
export function novaOrdem(ids: string[], atuais: { id: string }[]): string[] {
  if (new Set(ids).size !== ids.length) throw new BadRequestException('A lista tem itens repetidos.');
  const existentes = new Set(atuais.map((a) => a.id));
  if (ids.some((id) => !existentes.has(id))) throw new NotFoundException('Item não encontrado nesta lista.');
  const enviados = new Set(ids);
  return [...ids, ...atuais.map((a) => a.id).filter((id) => !enviados.has(id))];
}

/** Grava `sortOrder` = posição, só onde mudou. */
export async function gravarOrdem(
  final: string[],
  atuais: { id: string; sortOrder: number }[],
  gravar: (id: string, sortOrder: number) => Promise<unknown>,
) {
  const antes = new Map(atuais.map((a) => [a.id, a.sortOrder]));
  for (let i = 0; i < final.length; i++) {
    if (antes.get(final[i]) !== i) await gravar(final[i], i);
  }
}

export const ORDEM_DA_LISTA = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];
