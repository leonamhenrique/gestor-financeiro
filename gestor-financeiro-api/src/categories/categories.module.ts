import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';
import { garantirCategoriasPadrao } from './default-categories';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule implements OnModuleInit {
  private readonly logger = new Logger(CategoriesModule.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sem as categorias padrão a conta nova nasce sem nada para lançar. Elas são
   * conferidas aqui, na subida, em vez de depender de alguém lembrar de rodar
   * o seed no deploy. Falhar aqui não derruba a API: melhor a API no ar sem as
   * padrão (o usuário cria as dele) do que fora do ar por causa disto. */
  async onModuleInit() {
    try {
      const criadas = await garantirCategoriasPadrao(this.prisma);
      if (criadas) this.logger.log(`Categorias padrão criadas: ${criadas}`);
    } catch (erro) {
      this.logger.error(`Não consegui garantir as categorias padrão: ${(erro as Error).message}`);
    }
  }
}
