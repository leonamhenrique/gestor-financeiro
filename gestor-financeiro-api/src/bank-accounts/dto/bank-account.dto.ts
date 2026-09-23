// ============================================================
// dto/bank-account.dto.ts
// ============================================================

import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateBankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  institutionName: string; // "Itaú", "Nubank", "Bradesco"...

  @IsOptional()
  @IsUrl()
  institutionLogoUrl?: string;

  @IsEnum(AccountType)
  accountType: AccountType;

  // Saldo com que a conta "nasce" no sistema (ex: usuário já tinha
  // R$ 1.200 na conta antes de começar a usar o app).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  initialBalance?: number;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #8A05BE' })
  color?: string;
}

// Campos deliberadamente ausentes aqui: `initialBalance` e
// `currentBalance` não são editáveis por um PATCH genérico — ver a
// regra de negócio explicada no service (evita dessincronizar saldo
// de histórico de transações já lançado).
export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  institutionName?: string;

  @IsOptional()
  @IsUrl()
  institutionLogoUrl?: string;

  @IsOptional()
  @IsEnum(AccountType)
  accountType?: AccountType;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #8A05BE' })
  color?: string;

  // true = fora do saldo geral e dos lançamentos listados por padrão.
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;
}

// DTO específico e explícito para o único jeito seguro de "corrigir"
// um saldo depois que a conta já tem transações: um ajuste manual,
// que fica registrado como uma transação de ajuste (auditável), em
// vez de simplesmente sobrescrever o número.
export class AdjustBalanceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  newBalance: number;

  @IsOptional()
  @IsString()
  reason?: string; // ex: "Conciliação com extrato do banco"
}
