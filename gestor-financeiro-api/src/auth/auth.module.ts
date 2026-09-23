// ============================================================
// auth.module.ts
// ============================================================
// O segredo do JWT é lido na subida (ver jwt-secret.ts): em produção a API
// não sobe com segredo fraco. O envio de e-mail segue o padrão de porta do
// billing — trocar de provedor é um `case` aqui.
// ============================================================

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordHasher } from './password-hasher';
import { MAILER, MailerDesligado } from './mailer.port';
import { ResendMailer } from './resend-mailer';
import { ConsoleMailer } from './console-mailer';
import { segredoJwt } from './jwt-secret';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({ secret: segredoJwt() }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
    {
      provide: MAILER,
      useFactory: () => {
        switch (process.env.MAIL_PROVIDER) {
          case 'RESEND':
            return new ResendMailer();
          // case 'SES': return new SesMailer();
          case 'NONE':
            // Escolha explícita: sem e-mail, e a recuperação de senha recusa
            // com uma mensagem clara em vez de prometer um link que não vem.
            return new MailerDesligado();
          default:
            if (process.env.NODE_ENV === 'production') {
              throw new Error(
                'MAIL_PROVIDER não configurado. O mailer de console escreveria links de ' +
                  'redefinição de senha no log, o que permitiria tomar contas. ' +
                  'Configure um provedor ou use MAIL_PROVIDER=NONE para subir sem essa função.',
              );
            }
            return new ConsoleMailer();
        }
      },
    },
  ],
  exports: [JwtModule, PassportModule, JwtAuthGuard, AuthService],
})
export class AuthModule {}
