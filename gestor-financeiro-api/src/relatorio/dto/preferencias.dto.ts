// ============================================================
// preferencias.dto.ts
// ============================================================

import { IsIn } from 'class-validator';

/** O regime dos relatórios, no vocabulário do usuário — "compra" ou
 * "fatura", as mesmas duas palavras dos botões em Configurações. O enum do
 * banco é detalhe do banco, e não vocabulário de API. */
export class PreferenciasDto {
  @IsIn(['compra', 'fatura'], {
    message: 'reportRegime deve ser "compra" ou "fatura".',
  })
  reportRegime!: 'compra' | 'fatura';
}
