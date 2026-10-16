import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';
import { SharedExpensesController } from './shared-expenses.controller';
import { SharedExpensesService } from './shared-expenses.service';
import { SettlementsService } from './settlements.service';
import { SharedSummaryService } from './shared-summary.service';
import { ShareLinksService } from './share-links.service';
import { PublicSharedController } from './public-shared.controller';

@Module({
  // TransactionsService entra para o gasto e a divisão nascerem juntos,
  // numa transação de banco só.
  imports: [TransactionsModule],
  controllers: [PeopleController, SharedExpensesController, PublicSharedController],
  providers: [PeopleService, SharedExpensesService, SettlementsService, SharedSummaryService, ShareLinksService],
})
export class SharedExpensesModule {}
