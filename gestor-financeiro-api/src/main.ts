import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // `rawBody` é requisito do webhook de cobrança: a assinatura do gateway é
  // calculada sobre os bytes exatos que ele enviou. Um corpo parseado e
  // re-serializado não bate, e a verificação falharia sempre.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Só as origens listadas podem chamar a API a partir do navegador, e com
  // cookie (`credentials`). Lista explícita, nunca "*": com credenciais, o
  // curinga deixaria qualquer site agir em nome de quem está logado.
  const origens = (process.env.CORS_ORIGINS ?? 'http://localhost:4173,http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origens,
    credentials: true,
    // PUT entra por causa das rotas de ordem (/bank-accounts/order e irmãs):
    // fora desta lista, o navegador nem chega a enviar o pedido.
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client'],
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
