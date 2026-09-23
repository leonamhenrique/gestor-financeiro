// ============================================================
// dto/credit-card.dto.ts
// ============================================================

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  IsDateString,
} from 'class-validator';

// ------------------------------------------------------------
// Pagamento de fatura
// ------------------------------------------------------------
export class PayInvoiceDto {
  @IsUUID()
  bankAccountId: string; // conta de onde o dinheiro sai

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor do pagamento deve ser maior que zero.' })
  amount: number;

  // Dia do pagamento (AAAA-MM-DD). Omitido = hoje.
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class UpdateInvoicePaymentDto {
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor do pagamento deve ser maior que zero.' })
  amount?: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class CreateCreditCardDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string; // "Nubank Roxinho", "Itaú Click"

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  limitAmount: number;

  @IsInt()
  @Min(1)
  @Max(31)
  closingDay: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay: number;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string; // conta de onde a fatura será debitada (opcional)

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #8A05BE' })
  color?: string;
}

// `closingDay` e `dueDay` deliberadamente ausentes aqui — ver regra de
// negócio no service: mudar o dia de fechamento depois que já existem
// faturas geradas invalidaria os períodos já calculados no histórico.
export class UpdateCreditCardDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  limitAmount?: number;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @Matches(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, { message: 'Cor deve ser um hex válido, ex: #8A05BE' })
  color?: string;
}

// Único caminho seguro para mudar closingDay/dueDay — só permitido
// enquanto o cartão ainda não tem nenhuma fatura gerada.
export class UpdateBillingCycleDto {
  @IsInt()
  @Min(1)
  @Max(31)
  closingDay: number;

  @IsInt()
  @Min(1)
  @Max(31)
  dueDay: number;
}
