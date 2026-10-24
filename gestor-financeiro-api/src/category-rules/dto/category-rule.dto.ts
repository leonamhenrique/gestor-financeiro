// ============================================================
// category-rule.dto.ts
// ============================================================

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** O limite de uma leva. Um extrato grande ensina poucos lojistas — 74 linhas
 * do arquivo medido davam 11 lojistas distintos. 200 é folga larga e, ao mesmo
 * tempo, teto para um pedido forjado não virar uma escrita sem fim. */
export const MAX_REGRAS_POR_LEVA = 200;

export class CategoryRuleItemDto {
  /** A chave do lojista, já normalizada pelo cliente: minúsculas, sem acento
   * e sem pontuação. A regra é conferida aqui também — chave com espaço ou
   * maiúscula nunca casaria com nada, e gravá-la seria gravar lixo. */
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+$/, {
    message: 'merchant deve vir normalizado: só letras minúsculas e números',
  })
  merchant!: string;

  @IsUUID()
  categoryId!: string;
}

export class UpsertCategoryRulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REGRAS_POR_LEVA)
  @ValidateNested({ each: true })
  @Type(() => CategoryRuleItemDto)
  rules!: CategoryRuleItemDto[];
}
