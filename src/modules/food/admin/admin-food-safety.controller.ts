import { AdminFoodSafetyCheckView } from './admin-food-safety.response';
import { ApiEnvelopeOk } from '../../../common/swagger/api-envelope';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VendorSetupService } from '../vendor/vendor-setup.service';
import { FoodSafetyCheckDto } from '../vendor/dto/vendor.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';

@ApiTags('admin · food')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageFood')
@Controller('admin/food/branches')
export class AdminFoodSafetyController {
  constructor(private readonly setup: VendorSetupService) {}

  @Post(':id/food-safety-check')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '{ outcome: passed|failed, note } — home kitchens need a pass to go live. Audited.',
  })
  @ApiEnvelopeOk(AdminFoodSafetyCheckView)
  check(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FoodSafetyCheckDto,
  ) {
    return this.setup.foodSafetyCheck(me.id, id, dto.outcome, dto.note);
  }
}
