import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-kitchen.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminKitchenRemoveAliasView {
  @ApiProperty({ type: Boolean })
  removed!: boolean;
}

export class AdminKitchenListAliasesView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  alias!: string;
  @ApiProperty({ type: String })
  canonical!: string;
  @ApiProperty({ type: String })
  lang!: string;
}

export class AdminKitchenCreateAliasView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  alias!: string;
  @ApiProperty({ type: String })
  canonical!: string;
  @ApiProperty({ type: String })
  lang!: string;
}

export class AdminKitchenImportViewErrorsItem {
  @ApiProperty({ type: 'integer' })
  line!: number;
  @ApiProperty({ type: String })
  error!: string;
}

export class AdminKitchenImportView {
  @ApiProperty({ type: 'integer' })
  items!: number;
  @ApiProperty({ type: 'integer' })
  prices!: number;
  @ApiProperty({ type: [String] })
  cities!: string[];
  @ApiProperty({ type: [String] })
  weeks!: string[];
  @ApiProperty({ type: 'integer' })
  rejected!: number;
  @ApiProperty({ type: () => [AdminKitchenImportViewErrorsItem] })
  errors!: AdminKitchenImportViewErrorsItem[];
}

export class AdminKitchenReferenceItemView {
  @ApiProperty({ type: String }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String }) baseUnit!: string;
  @ApiProperty({ type: String, nullable: true }) canonical!: string | null;
  @ApiProperty({ type: 'integer', description: 'Cities with prices.' })
  cities!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Latest week ending (date).',
  })
  latestWeek!: string | null;
}
