// ============================================================
// dto/budget.dto.ts
// ============================================================
import {
  IsUUID, IsNumber, IsOptional, IsBoolean, IsArray, ValidateNested, Min, Max, Matches, ArrayMaxSize,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Teto por valor. O mesmo do lançamento: não é limite de produto, é barreira
 * contra dedo escorregado e contra payload absurdo. */
const TETO = 99999999.99;

/** Quantas metas cabem num planejamento. É folga sobre qualquer árvore de
 * categorias real, e impede um corpo de milhares de itens virar milhares de
 * inserts numa transação só. */
const MAX_METAS = 300;

const numero = () => Transform(({ value }) => (typeof value === 'string' ? Number(value) : value));
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export class BudgetItemDto {
  @IsUUID()
  categoryId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'A meta tem no máximo duas casas decimais.' })
  @Min(0, { message: 'A meta não pode ser negativa.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  amount: number;

  @IsOptional()
  @IsBoolean()
  fromChildren?: boolean;
}

export class SaveBudgetDto {
  /** Receita esperada do mês. Não é a receita lançada — é a referência da
   * sugestão dos 80% e do que a tela compara. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'A receita tem no máximo duas casas decimais.' })
  @Min(0, { message: 'A receita não pode ser negativa.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  income?: number;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O planejamento tem no máximo duas casas decimais.' })
  @Min(0, { message: 'O planejamento não pode ser negativo.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  total: number;

  @IsArray()
  @ArrayMaxSize(MAX_METAS, { message: 'Metas demais num planejamento só.' })
  @ValidateNested({ each: true })
  @Type(() => BudgetItemDto)
  items: BudgetItemDto[];
}

export class CopyBudgetDto {
  @Matches(MES, { message: 'Use o mês no formato AAAA-MM.' })
  fromMonth: string;
}
