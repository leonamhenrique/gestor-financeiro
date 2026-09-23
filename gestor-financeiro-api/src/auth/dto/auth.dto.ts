import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Mesma regra que o app confere antes de enviar: 8+ caracteres, com letra e
// número. O teto de 128 existe porque cada tentativa custa um scrypt — uma
// "senha" de 1 MB seria um jeito barato de gastar CPU do servidor.
const REGRA_SENHA = /^(?=.*[A-Za-z])(?=.*\d).+$/;
const MSG_SENHA = 'A senha precisa ter letras e números.';

const normalizarEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Informe seu nome.' })
  @MaxLength(60)
  name!: string;

  @Transform(normalizarEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(REGRA_SENHA, { message: MSG_SENHA })
  password!: string;
}

export class LoginDto {
  @Transform(normalizarEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;

  // No login não se repete a regra de força: uma senha antiga que não segue
  // a regra de hoje ainda precisa conseguir entrar.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshDto {
  // Opcional: no navegador o token chega pelo cookie httpOnly, não pelo corpo.
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @Transform(normalizarEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(REGRA_SENHA, { message: MSG_SENHA })
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  @MaxLength(128)
  @Matches(REGRA_SENHA, { message: MSG_SENHA })
  newPassword!: string;
}
