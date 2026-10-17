import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessPlan } from './entities/business-plan.entity';
import { PlanService } from './plans.service';

/** Partner plans (ported from FinMatrix). Food registers its usage counters and seat reconcile. */
@Module({
  imports: [TypeOrmModule.forFeature([BusinessPlan])],
  providers: [PlanService],
  exports: [PlanService],
})
export class PlansModule {}
