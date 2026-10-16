// ============================================================
// shared-expenses.module.spec.ts
// ============================================================
// Sobe o módulo de verdade. O compilador não pega erro de injeção — um
// provider esquecido só aparece quando o Nest tenta montar o grafo, e sem
// este teste isso aconteceria na subida da API em produção.
// ============================================================

import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { SharedExpensesModule } from './shared-expenses.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleController } from './people.controller';
import { SharedExpensesController } from './shared-expenses.controller';
import { PublicSharedController } from './public-shared.controller';

describe('SharedExpensesModule', () => {
  it('monta com todos os controladores e serviços ligados', async () => {
    const mod = await Test.createTestingModule({
      // PrismaModule é @Global(): na API real quem o importa é o AppModule, e
      // a partir daí o PrismaService existe em todo lugar. Aqui ele entra
      // para o teste ter o mesmo mundo que a aplicação tem.
      imports: [
        PrismaModule,
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
        SharedExpensesModule,
      ],
    })
      // O Prisma de verdade abriria conexão; aqui só o grafo importa.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(mod.get(PeopleController)).toBeDefined();
    expect(mod.get(SharedExpensesController)).toBeDefined();
    expect(mod.get(PublicSharedController)).toBeDefined();
  });
});
