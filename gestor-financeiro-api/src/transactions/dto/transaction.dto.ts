// ============================================================
// dto/create-transaction.dto.ts
// ============================================================
import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsPositive,
  IsOptional,
  IsString,
  IsDateString,
  IsBoolean,
  IsIn,
  IsInt,
  Matches,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TransactionType, TransactionSource, SeriesKind, SeriesFrequency } from '@prisma/client';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const MES_MSG = 'Use o mês no formato AAAA-MM.';

// Repetição fixa (conta mensal) ou parcelamento. Cada ocorrência vira um
// lançamento; só a primeira respeita isConfirmed e invoiceMonth.
export class RepeatDto {
  @IsEnum(SeriesKind)
  kind: SeriesKind;

  @IsEnum(SeriesFrequency)
  frequency: SeriesFrequency;

  @IsInt()
  @Min(2, { message: 'Uma série tem pelo menos 2 ocorrências.' })
  @Max(60, { message: 'Uma série tem no máximo 60 ocorrências.' })
  count: number;
}

export class CreateTransactionDto {
  // Fatura em que a compra entra, quando não é a da data (só cartão).
  @IsOptional()
  @Matches(MES, { message: MES_MSG })
  invoiceMonth?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  amount: number;

  @IsUUID()
  categoryId: string;

  @IsDateString()
  transactionDate: string; // ISO string, convertido para Date no service

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  // false = previsto: gravado, mas sem mexer no saldo nem na fatura até ser
  // confirmado. Omitido = confirmado (compatível com quem já usa a API).
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  @IsOptional()
  @IsEnum(TransactionSource)
  source?: TransactionSource;

  // Exatamente um dos dois deve ser informado.
  // A validação de XOR (não pode ter os dois nem nenhum) é feita
  // no service, pois class-validator não expressa XOR de forma limpa
  // entre dois campos opcionais.
  @ValidateIf((o) => !o.creditCardId)
  @IsUUID()
  bankAccountId?: string;

  @ValidateIf((o) => !o.bankAccountId)
  @IsUUID()
  creditCardId?: string;
}

// ============================================================
// dto/update-transaction.dto.ts
// ============================================================
export class UpdateTransactionDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  amount?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;

  // true confirma um previsto (aplica no saldo/fatura); false volta a previsto
  // (desfaz). Pode vir junto com valor e data na mesma edição.
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  // 'AAAA-MM' move a compra para outra fatura; null volta para a da data.
  @IsOptional()
  @ValidateIf((o) => o.invoiceMonth !== null)
  @Matches(MES, { message: MES_MSG })
  invoiceMonth?: string | null;
}

export class DeleteSeriesQueryDto {
  // ONLY = só esta; FOLLOWING = esta e as seguintes; ALL = a série toda.
  @IsIn(['ONLY', 'FOLLOWING', 'ALL'])
  scope: 'ONLY' | 'FOLLOWING' | 'ALL';
}

export class AnticipateDto {
  @Matches(MES, { message: MES_MSG })
  destinationMonth: string;

  @IsInt()
  @Min(1)
  @Max(60)
  quantity: number;

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

// ============================================================
// dto/list-transactions-query.dto.ts
// ============================================================
// Query params para filtro por data na listagem (requisito do MVP:
// "Transações filtráveis e organizáveis por data")
export class ListTransactionsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsUUID()
  creditCardId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  // CONFIRMED = só o que já afetou o saldo; PLANNED = só os previstos.
  @IsOptional()
  @IsIn(['CONFIRMED', 'PLANNED'])
  status?: 'CONFIRMED' | 'PLANNED';

  @IsOptional()
  @IsUUID()
  seriesId?: string;

  // Lançamentos de conta oculta ficam fora por padrão; true inclui.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeHidden?: boolean;
}
