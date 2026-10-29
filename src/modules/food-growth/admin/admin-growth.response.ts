import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shapes for admin-growth.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminGrowthRemoveEventView {
  @ApiProperty({ type: Boolean })
  removed!: boolean;
}

export class AdminGrowthEventsView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  startsOn!: string;
  @ApiProperty({ type: String })
  endsOn!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminGrowthDemandMapViewFilters {
  @ApiProperty({ type: String, nullable: true })
  cuisineId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  hour!: string | null;
}

export class AdminGrowthDemandMapViewCellsItemCenter {
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
}

export class AdminGrowthDemandMapViewCellsItemBounds {
  @ApiProperty({ type: Number })
  south!: number;
  @ApiProperty({ type: Number })
  west!: number;
  @ApiProperty({ type: Number })
  north!: number;
  @ApiProperty({ type: Number })
  east!: number;
}

export class AdminGrowthDemandMapViewCellsItem {
  @ApiProperty({ type: String })
  geohash6!: string;
  @ApiProperty({ type: () => AdminGrowthDemandMapViewCellsItemCenter })
  center!: AdminGrowthDemandMapViewCellsItemCenter;
  @ApiProperty({ type: () => AdminGrowthDemandMapViewCellsItemBounds })
  bounds!: AdminGrowthDemandMapViewCellsItemBounds;
  @ApiProperty({ type: 'integer' })
  searches!: number;
  @ApiProperty({ type: 'integer' })
  zeroResultShare!: number;
  @ApiProperty({ type: 'integer' })
  closedShare!: number;
  @ApiProperty({ type: 'integer' })
  unmetSearches!: number;
  @ApiProperty({ type: 'integer' })
  orders!: number;
}

export class AdminGrowthDemandMapViewTopQueriesItem {
  @ApiProperty({ type: String })
  query!: string;
  @ApiProperty({ type: 'integer' })
  searches!: number;
  @ApiProperty({ type: 'integer' })
  zeroResultShare!: number;
  @ApiProperty({ type: 'integer' })
  closedShare!: number;
}

export class AdminGrowthDemandMapView {
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  week!: string;
  @ApiProperty({ type: [String] })
  weeks!: string[];
  @ApiProperty({ type: 'integer' })
  k!: number;
  @ApiProperty({ type: () => AdminGrowthDemandMapViewFilters })
  filters!: AdminGrowthDemandMapViewFilters;
  @ApiProperty({ type: () => [AdminGrowthDemandMapViewCellsItem] })
  cells!: AdminGrowthDemandMapViewCellsItem[];
  @ApiProperty({ type: 'integer' })
  hidden!: number;
  @ApiProperty({ type: () => [AdminGrowthDemandMapViewTopQueriesItem] })
  topQueries!: AdminGrowthDemandMapViewTopQueriesItem[];
}

export class AdminGrowthDemandCitiesViewItemsItem {
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  latestWeek!: string;
  @ApiProperty({ type: 'integer' })
  searches!: number;
}

export class AdminGrowthDemandCitiesView {
  @ApiProperty({ type: () => [AdminGrowthDemandCitiesViewItemsItem] })
  items!: AdminGrowthDemandCitiesViewItemsItem[];
}

export class AdminGrowthHygieneViewChecklist {
  @ApiProperty({ type: Boolean })
  gloves!: boolean;
  @ApiProperty({ type: Boolean })
  hairnet!: boolean;
  @ApiProperty({ type: Boolean })
  cleanWater!: boolean;
  @ApiProperty({ type: Boolean })
  fridgeTempLog!: boolean;
  @ApiProperty({ type: String })
  pestControlOn!: string;
  @ApiProperty({ type: Boolean })
  separateBoards!: boolean;
}

export class AdminGrowthHygieneView {
  @ApiProperty({ type: String })
  brandId!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  cookName!: string;
  @ApiProperty({ type: () => AdminGrowthHygieneViewChecklist })
  checklist!: AdminGrowthHygieneViewChecklist;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  declaredAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  verifiedMethod!: string | null;
  @ApiProperty({ type: String, nullable: true })
  verifiedNote!: string | null;
  @ApiProperty({ type: [String] })
  photos!: string[];
  @ApiProperty({ type: String, nullable: true })
  videoUrl!: string | null;
}

export class AdminGrowthLookupView {
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  id!: string;
  @ApiPropertyOptional({ type: String })
  code?: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiPropertyOptional({ type: String })
  source?: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  campaign?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String })
  payment_method?: string;
  @ApiPropertyOptional({ type: String })
  payment_status?: string;
  @ApiPropertyOptional({ type: 'integer' })
  total?: number;
  @ApiPropertyOptional({ type: 'integer' })
  prepaid_amount?: number;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  scheduled_for?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  created_at?: string;
  @ApiProperty({ type: String })
  brand_id!: string;
  @ApiProperty({ type: String })
  vendor!: string;
  @ApiProperty({ type: String })
  customer!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  catering_code?: Record<string, unknown> | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  tiffin_subscription_id?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String })
  event_date?: string;
  @ApiPropertyOptional({ type: 'integer' })
  guests?: number;
  @ApiPropertyOptional({ type: String })
  event_type?: string;
  @ApiPropertyOptional({ type: String })
  fulfilment?: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  accepted_version?: Record<string, unknown> | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  food_order_id?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String })
  customer_email?: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  quotes?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String })
  period_payment_status?: string;
  @ApiPropertyOptional({ type: String })
  starts_on?: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  period_start?: Record<string, unknown> | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  period_end?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String })
  plan?: string;
  @ApiPropertyOptional({ type: 'integer' })
  deliveries?: number;
  @ApiPropertyOptional({ type: 'integer' })
  missed?: number;
}

export class AdminGrowthSignaturesView {
  @ApiProperty({ type: String })
  recipeCardId!: string;
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ type: String, nullable: true })
  variantId!: string | null;
  @ApiProperty({ type: String })
  item!: string;
  @ApiProperty({ type: String, nullable: true })
  variant!: string | null;
  @ApiProperty({ type: String })
  brandId!: string;
  @ApiProperty({ type: String })
  brand!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  by!: string;
  @ApiProperty({ type: String })
  since!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  removedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  removedReason!: string | null;
}

export class AdminGrowthUpdateEventView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  startsOn!: string;
  @ApiProperty({ type: String })
  endsOn!: string;
  @ApiProperty({ type: String, nullable: true })
  city!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminGrowthCreateEventView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  startsOn!: string;
  @ApiProperty({ type: String })
  endsOn!: string;
  @ApiProperty({ type: String, nullable: true })
  city!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class AdminGrowthRevokeViewChecklist {
  @ApiProperty({ type: Boolean })
  gloves!: boolean;
  @ApiProperty({ type: Boolean })
  hairnet!: boolean;
  @ApiProperty({ type: Boolean })
  cleanWater!: boolean;
  @ApiProperty({ type: Boolean })
  fridgeTempLog!: boolean;
  @ApiProperty({ type: String })
  pestControlOn!: string;
  @ApiProperty({ type: Boolean })
  separateBoards!: boolean;
}

export class AdminGrowthRevokeView {
  @ApiProperty({ type: String })
  brandId!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: () => AdminGrowthRevokeViewChecklist })
  checklist!: AdminGrowthRevokeViewChecklist;
  @ApiProperty({ type: String, format: 'date-time' })
  declaredAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  verifiedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  verifiedMethod!: string | null;
  @ApiProperty({ type: String })
  verifiedNote!: string;
}

export class AdminGrowthVerifyViewChecklist {
  @ApiProperty({ type: Boolean })
  gloves!: boolean;
  @ApiProperty({ type: Boolean })
  hairnet!: boolean;
  @ApiProperty({ type: Boolean })
  cleanWater!: boolean;
  @ApiProperty({ type: Boolean })
  fridgeTempLog!: boolean;
  @ApiProperty({ type: String })
  pestControlOn!: string;
  @ApiProperty({ type: Boolean })
  separateBoards!: boolean;
}

export class AdminGrowthVerifyView {
  @ApiProperty({ type: String })
  brandId!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: () => AdminGrowthVerifyViewChecklist })
  checklist!: AdminGrowthVerifyViewChecklist;
  @ApiProperty({ type: String, format: 'date-time' })
  declaredAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  verifiedAt!: string;
  @ApiProperty({ type: String })
  verifiedMethod!: string;
  @ApiProperty({ type: String, nullable: true })
  verifiedNote!: string | null;
}

export class AdminGrowthRemoveSignatureView {
  @ApiProperty({ type: String })
  recipeCardId!: string;
  @ApiProperty({ type: Boolean })
  isSignature!: boolean;
  @ApiProperty({ type: String })
  removedReason!: string;
}
