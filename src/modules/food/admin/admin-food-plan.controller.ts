import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlanService } from '../../plans/plans.service';
import { FoodVendorService } from '../vendor/food-vendor.service';
import { AdminPlanDto } from './dto/admin-plan.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import type { PlanOverrides } from '../../plans/plan-config';

@ApiTags('admin · food')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/food/vendors')
export class AdminFoodPlanController {
  constructor(
    private readonly plans: PlanService,
    private readonly vendors: FoodVendorService,
    private readonly audit: OperationalAuditService,
  ) {}

  @Get(':id/plan')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const v = await this.vendors.byBrandId(id);
    return this.plans.view(v.businessId);
  }

  @Patch(':id/plan')
  @ApiOperation({
    summary:
      '{ planKey?, overrides?: { limits?, entitlements? } | null } — takes effect at once; riders beyond a lowered limit become plan_locked (a rider mid-delivery keeps the seat). Audited.',
  })
  async patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPlanDto,
  ) {
    const v = await this.vendors.byBrandId(id);
    const view = await this.plans.change(v.businessId, {
      planKey: dto.planKey,
      overrides: dto.overrides as PlanOverrides | null | undefined,
    });
    await this.audit.record({
      action: 'food.vendor.plan',
      targetType: 'food_brand',
      targetId: id,
      details: { planKey: view.planKey, overrides: view.overrides },
    });
    return view;
  }
}
