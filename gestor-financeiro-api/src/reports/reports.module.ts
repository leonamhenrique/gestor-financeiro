import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PrismaModule } from '../prisma/prisma.module';
import { InsightsService } from './insights.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BillingModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, InsightsService],
})
export class ReportsModule {}
