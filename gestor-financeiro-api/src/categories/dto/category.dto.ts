// ============================================================
// dto/category.dto.ts
// ============================================================

import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength, Matches, IsUUID, ValidateIf } from 'class-validator';
import { TransactionType } from '@prisma/client';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @IsEnum(TransactionType)
  type: TransactionType; // categoria é ou de receita, ou de despesa — nunca as duas

  @IsOptional()
  @IsString()
  icon?: string; // nome do ícone (ex: "shopping-cart"), resolvido no frontend

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #22C55E' })
  color?: string;

  // Categoria pai (raiz, do mesmo tipo). Omitido = raiz.
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCategoryDto {
  // Outra pai, ou null para voltar a ser raiz. Categoria com filhas não
  // vira filha (ver service).
  @IsOptional()
  @ValidateIf((o) => o.parentId !== null)
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #22C55E' })
  color?: string;

  // Deliberadamente sem `type` aqui — ver regra de negócio no service:
  // mudar o tipo de uma categoria que já tem transações lançadas
  // tornaria o histórico incoerente (uma "compra" virando categoria
  // de receita, por exemplo).
}

export class ListCategoriesQueryDto {
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;
}
