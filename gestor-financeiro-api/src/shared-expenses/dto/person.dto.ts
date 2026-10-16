// ============================================================
// dto/person.dto.ts
// ============================================================

import { IsString, IsNotEmpty, IsOptional, MaxLength, IsArray, ArrayNotEmpty } from 'class-validator';

export class CreatePersonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  // Só para a página pública mostrar "copiar chave Pix". É contato, não meio
  // de pagamento: o app não cobra ninguém e não movimenta dinheiro por aqui.
  @IsOptional()
  @IsString()
  @MaxLength(140)
  pixKey?: string;
}

export class UpdatePersonDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  pixKey?: string;
}

export class ReorderPeopleDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
