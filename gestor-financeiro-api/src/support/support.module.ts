import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/* `AuthModule` entra pelo MAILER, que é dele: quem escolhe o serviço de
 * e-mail é a fábrica de lá, e declarar outra aqui leria o ambiente duas
 * vezes. `BillingModule` entra só para o plano ir no contexto. */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
