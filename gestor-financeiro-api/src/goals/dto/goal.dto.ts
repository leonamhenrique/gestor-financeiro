// ============================================================
// dto/goal.dto.ts
// ============================================================
import {
  IsUUID,
  IsNumber,
  IsPositive,
  IsOptional,
  IsString,
  IsDateString,
  IsBoolean,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** Teto por valor. O mesmo do lançamento: não é limite de produto, é barreira
 * contra dedo escorregado e contra payload absurdo. */
const TETO = 99999999.99;

const numero = () => Transform(({ value }) => (typeof value === 'string' ? Number(value) : value));

export class CreateGoalDto {
  @IsString()
  @Length(1, 80)
  name: string;

  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  startDate: string;

  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  targetDate: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @IsPositive({ message: 'O valor do objetivo precisa ser maior que zero.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  targetAmount: number;

  /** Dinheiro que o usuário já tem guardado fora das contas do app. Pode ser
   * zero; não pode ser negativo. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @Min(0, { message: 'O saldo inicial não pode ser negativo.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  initialBalance?: number;

  /** Conta sugerida ao aplicar e ao resgatar. `null` desvincula. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  accountId?: string | null;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  startDate?: string;

  /** Postergar é mandar só este campo. */
  @IsOptional()
  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  targetDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @IsPositive({ message: 'O valor do objetivo precisa ser maior que zero.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  targetAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @Min(0, { message: 'O saldo inicial não pode ser negativo.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  initialBalance?: number;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  accountId?: string | null;

  /** Concluir é `true`; reabrir é `false`. */
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;
}

/** Aplicar e resgatar pedem a mesma coisa: de/para qual conta, quanto e quando. */
export class GoalMovementDto {
  /** Chave de idempotência do aparelho. Mandar a mesma duas vezes devolve o
   * movimento que já existe — sem ela, um reenvio da fila offline move o
   * mesmo dinheiro de novo. */
  @IsOptional()
  @IsString()
  @Length(8, 100)
  clientKey?: string;

  @IsUUID()
  bankAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @IsPositive({ message: 'O valor precisa ser maior que zero.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @numero()
  amount: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  movementDate: string;
}
