import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for ai-admin.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AiAdminListPromptsViewItemsItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: 'integer' })
  version!: number;
  @ApiProperty({ type: String })
  feature!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: 'integer' })
  length!: number;
  @ApiProperty({ type: 'integer' })
  calls30d!: number;
  @ApiProperty({ type: 'integer' })
  ok30d!: number;
  @ApiProperty({ type: 'integer' })
  olderVersionCalls30d!: number;
}

export class AiAdminListPromptsView {
  @ApiProperty({ type: () => [AiAdminListPromptsViewItemsItem] })
  items!: AiAdminListPromptsViewItemsItem[];
}

export class AiAdminSettingsViewView {
  @ApiProperty({ type: Boolean })
  enabled!: boolean;
  @ApiProperty({ type: String })
  features!: string;
  @ApiProperty({ type: 'integer' })
  timeoutMs!: number;
  @ApiProperty({ type: String })
  model!: string;
  @ApiProperty({ type: Boolean })
  providerConfigured!: boolean;
  @ApiProperty({ type: String })
  sttProvider!: string;
  @ApiProperty({ type: String })
  ttsProvider!: string;
}

export class AiAdminUsageViewTotals {
  @ApiProperty({ type: 'integer' })
  calls!: number;
  @ApiProperty({ type: 'integer' })
  ok!: number;
  @ApiProperty({ type: 'integer' })
  cached!: number;
  @ApiProperty({ type: 'integer' })
  failures!: number;
  @ApiProperty({ type: 'integer' })
  tokensIn!: number;
  @ApiProperty({ type: 'integer' })
  tokensOut!: number;
  @ApiProperty({ type: 'integer' })
  audioSeconds!: number;
}

export class AiAdminUsageViewByFeatureItem {
  @ApiProperty({ type: String })
  feature!: string;
  @ApiProperty({ type: 'integer' })
  calls!: number;
  @ApiProperty({ type: 'integer' })
  ok!: number;
  @ApiProperty({ type: 'integer' })
  cached!: number;
  @ApiProperty({ type: 'integer' })
  invalid!: number;
  @ApiProperty({ type: 'integer' })
  timeout!: number;
  @ApiProperty({ type: 'integer' })
  quota!: number;
  @ApiProperty({ type: 'integer' })
  error!: number;
  @ApiProperty({ type: 'integer' })
  p50Ms!: number;
  @ApiProperty({ type: 'integer' })
  p95Ms!: number;
  @ApiProperty({ type: 'integer' })
  tokens!: number;
}

export class AiAdminUsageViewByBusinessItem {
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: 'integer' })
  calls!: number;
  @ApiProperty({ type: 'integer' })
  failures!: number;
}

export class AiAdminUsageViewFailuresItem {
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
  @ApiProperty({ type: String })
  feature!: string;
  @ApiProperty({ type: String })
  promptId!: string;
  @ApiProperty({ type: 'integer' })
  promptVersion!: number;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: 'integer' })
  latencyMs!: number;
  @ApiProperty({ type: String })
  businessId!: string;
}

export class AiAdminUsageView {
  @ApiProperty({ type: 'integer' })
  days!: number;
  @ApiProperty({ type: () => AiAdminUsageViewTotals })
  totals!: AiAdminUsageViewTotals;
  @ApiProperty({ type: () => [AiAdminUsageViewByFeatureItem] })
  byFeature!: AiAdminUsageViewByFeatureItem[];
  @ApiProperty({ type: () => [AiAdminUsageViewByBusinessItem] })
  byBusiness!: AiAdminUsageViewByBusinessItem[];
  @ApiProperty({ type: () => [AiAdminUsageViewFailuresItem] })
  failures!: AiAdminUsageViewFailuresItem[];
}
