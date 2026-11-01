import { Module } from '@nestjs/common';
import { PreferenciasController } from './preferencias.controller';
import { RelatorioService } from './relatorio.service';

/** A conta do mês, para quem pergunta de fora da tela: hoje, o WhatsApp.
 * O controller aqui é só da preferência de regime — o número em si o app
 * desenha com o recorte que mora nele. */
@Module({
  controllers: [PreferenciasController],
  providers: [RelatorioService],
  exports: [RelatorioService],
})
export class RelatorioModule {}
