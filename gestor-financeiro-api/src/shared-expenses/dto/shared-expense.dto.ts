// ============================================================
// dto/shared-expense.dto.ts
// ============================================================

import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ArrayNotEmpty,
  ValidateNested,
  MaxLength,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { SettlementDirection } from '@prisma/client';

export class ParticipanteDto {
  @IsString()
  @IsNotEmpty()
  personId: string;

  /** Só no modo VALOR. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  /** Só no modo PERCENTUAL. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  percent?: number;
}

export class CreateSharedExpenseDto {
  // ---- quem pagou ----
  /** Ausente = eu paguei. Presente = a despesa é dela e não há lançamento
   * nenhum na minha conta: é a linha "fora da conta" do extrato. */
  @IsOptional()
  @IsString()
  paidByPersonId?: string;

  /** Dividir um lançamento que JÁ existe, em vez de criar um novo. */
  @IsOptional()
  @IsString()
  transactionId?: string;

  // ---- o gasto ----
  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  date?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  // ---- onde saiu o dinheiro (só quando eu paguei e o lançamento é novo) ----
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  creditCardId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'O mês da fatura deve estar no formato AAAA-MM.' })
  invoiceMonth?: string;

  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;

  // ---- a divisão ----
  @IsEnum(['IGUAL', 'VALOR', 'PERCENTUAL'])
  mode: 'IGUAL' | 'VALOR' | 'PERCENTUAL';

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ParticipanteDto)
  participants: ParticipanteDto[];

  @IsOptional()
  @IsString()
  clientKey?: string;
}

export class CreateSettlementDto {
  @IsString()
  @IsNotEmpty()
  personId: string;

  @IsEnum(SettlementDirection)
  direction: SettlementDirection;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  settledAt: string;

  /** Nulo quando o acerto foi em dinheiro vivo e não passou por conta. */
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @IsOptional()
  @IsString()
  clientKey?: string;

  /** Com categoria, o acerto vira um LANCAMENTO no extrato -- e e ele que
   * mexe no saldo e entra nos relatorios. Sem ela, o acerto so abate a
   * divida, como antes. */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** So faz sentido com categoria: o lancamento pode nascer previsto. */
  @IsOptional()
  @IsBoolean()
  isConfirmed?: boolean;
}

export class ListSharedQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class CreateShareLinkDto {
  /** Opcional: sem data, o link vale até ser revogado. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  expiresAt?: string;
}

/** Editar uma despesa dividida. O valor e o rateio vêm juntos de propósito:
 * mudar um sem o outro é exatamente o que o módulo existe para impedir. */
export class UpdateSharedExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  date?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsEnum(['IGUAL', 'VALOR', 'PERCENTUAL'])
  mode: 'IGUAL' | 'VALOR' | 'PERCENTUAL';

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ParticipanteDto)
  participants: ParticipanteDto[];
}
