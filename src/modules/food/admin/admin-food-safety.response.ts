import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-food-safety.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminFoodSafetyCheckViewSetupItemsItem {
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Boolean })
  required!: boolean;
  @ApiProperty({ type: Boolean })
  done!: boolean;
}

export class AdminFoodSafetyCheckViewSetup {
  @ApiProperty({ type: String })
  subType!: string;
  @ApiProperty({ type: () => [AdminFoodSafetyCheckViewSetupItemsItem] })
  items!: AdminFoodSafetyCheckViewSetupItemsItem[];
  @ApiProperty({ type: 'integer' })
  percent!: number;
  @ApiProperty({ type: [String] })
  missing!: string[];
  @ApiProperty({ type: Boolean })
  ready!: boolean;
  @ApiProperty({ type: Boolean })
  isLive!: boolean;
}

export class AdminFoodSafetyCheckView {
  @ApiProperty({ type: String })
  branchId!: string;
  @ApiProperty({ type: String })
  outcome!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  foodSafetyCheckedAt!: string | null;
  @ApiProperty({ type: () => AdminFoodSafetyCheckViewSetup })
  setup!: AdminFoodSafetyCheckViewSetup;
}
