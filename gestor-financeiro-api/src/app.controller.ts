import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Sinal de vida do serviço: é o que o Render consulta e o que qualquer um
  // usa para saber se a API está de pé. Não devolve dado de ninguém.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
