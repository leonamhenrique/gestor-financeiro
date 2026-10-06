// ============================================================
// dto/transfer.dto.ts
// ============================================================
import { IsUUID, IsNumber, IsPositive, IsOptional, IsString, IsDateString, IsBoolean, Length, Max } from 'class-validator';
import { Transform } from 'class-transformer';

/** Teto por transferência. O mesmo do lançamento: não é limite de produto,
 * é barreira contra dedo escorregado e contra payload absurdo. */
const TETO = 99999999.99;

export class CreateTransferDto {
  /** Chave de idempotência do aparelho. Mandar a mesma duas vezes devolve a
   * transferência que já existe — sem ela, um reenvio da fila offline move o
   * mesmo dinheiro de novo. */
  @IsOptional()
  @IsString()
  @Length(8, 100)
  clientKey?: string;

  @IsUUID()
  fromAccountId: string;

  @IsUUID()
  toAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @IsPositive({ message: 'O valor precisa ser maior que zero.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  amount: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  transferDate: string;

  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}

export class UpdateTransferDto {
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo duas casas decimais.' })
  @IsPositive({ message: 'O valor precisa ser maior que zero.' })
  @Max(TETO, { message: 'Valor acima do limite.' })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  amount?: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  transferDate?: string;

  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}

export class ListTransfersQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Use a data no formato AAAA-MM-DD.' })
  to?: string;
}
