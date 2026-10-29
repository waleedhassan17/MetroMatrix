import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-food.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminFoodRemoveBannerView {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

export class AdminFoodRemoveCuisineView {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

export class AdminFoodCuisinesView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  icon!: string;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: 'integer' })
  vendors!: number;
}

export class AdminFoodOrdersViewPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminFoodOrdersView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  statusLabel!: string;
  @ApiProperty({ type: String })
  fulfilment!: string;
  @ApiProperty({ type: String, nullable: true })
  scheduledFor!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  acceptBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  promisedAt!: string;
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: () => AdminFoodOrdersViewPayment })
  payment!: AdminFoodOrdersViewPayment;
  @ApiProperty({ type: 'integer' })
  itemCount!: number;
  @ApiProperty({ type: String })
  itemsSummary!: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ type: String, nullable: true })
  riderId!: string | null;
  @ApiProperty({ type: Boolean })
  handedToExternal!: boolean;
  @ApiProperty({ type: String })
  vendorId!: string;
}

export class AdminFoodOrderViewVendorLocation {
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String })
  area!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
}

export class AdminFoodOrderViewVendor {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  logoUrl!: string;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: () => AdminFoodOrderViewVendorLocation })
  location!: AdminFoodOrderViewVendorLocation;
}

export class AdminFoodOrderViewItemsItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  itemId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String, nullable: true })
  variant!: string | null;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  options!: unknown[];
  @ApiProperty({ type: 'integer' })
  quantity!: number;
  @ApiProperty({ type: 'integer' })
  unitPrice!: number;
  @ApiProperty({ type: 'integer' })
  lineTotal!: number;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}

export class AdminFoodOrderViewTotals {
  @ApiProperty({ type: 'integer' })
  subtotal!: number;
  @ApiProperty({ type: 'integer' })
  discount!: number;
  @ApiProperty({ type: 'integer' })
  deliveryFee!: number;
  @ApiProperty({ type: 'integer' })
  total!: number;
}

export class AdminFoodOrderViewPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, nullable: true })
  payBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  accounts!: string | null;
  @ApiProperty({ type: String, nullable: true })
  reference!: string | null;
  @ApiProperty({ type: String, nullable: true })
  proofUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  rejectedReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  instructions!: string | null;
}

export class AdminFoodOrderViewAddress {
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
  @ApiProperty({ type: String })
  area!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, nullable: true })
  floor!: string | null;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: String })
  line1!: string;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String, nullable: true })
  building!: string | null;
  @ApiProperty({ type: String })
  fullName!: string;
  @ApiProperty({ type: String, nullable: true })
  landmark!: string | null;
  @ApiProperty({ type: String, nullable: true })
  riderInstructions!: string | null;
}

export class AdminFoodOrderViewEta {
  @ApiProperty({ type: 'integer' })
  minutes!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  promisedAt!: string;
}

export class AdminFoodOrderViewTimestamps {
  @ApiProperty({ type: String, format: 'date-time' })
  acceptedAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  preparingAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  readyAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  pickedUpAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  deliveredAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}

export class AdminFoodOrderViewEventsItem {
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String, nullable: true })
  from!: string | null;
  @ApiProperty({ type: String })
  to!: string;
  @ApiProperty({ type: String })
  actorRole!: string;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  at!: string;
}

export class AdminFoodOrderViewCustomer {
  @ApiProperty({ type: String })
  userId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  email!: string;
  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

export class AdminFoodOrderView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  statusLabel!: string;
  @ApiProperty({ type: String })
  fulfilment!: string;
  @ApiProperty({ type: String, nullable: true })
  scheduledFor!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  acceptBy!: string | null;
  @ApiProperty({ type: () => AdminFoodOrderViewVendor })
  vendor!: AdminFoodOrderViewVendor;
  @ApiProperty({ type: () => [AdminFoodOrderViewItemsItem] })
  items!: AdminFoodOrderViewItemsItem[];
  @ApiProperty({ type: () => AdminFoodOrderViewTotals })
  totals!: AdminFoodOrderViewTotals;
  @ApiProperty({ type: String, nullable: true })
  deal!: string | null;
  @ApiProperty({ type: () => AdminFoodOrderViewPayment })
  payment!: AdminFoodOrderViewPayment;
  @ApiProperty({ type: () => AdminFoodOrderViewAddress })
  address!: AdminFoodOrderViewAddress;
  @ApiProperty({ type: 'integer' })
  distanceKm!: number;
  @ApiProperty({ type: Boolean })
  cutlery!: boolean;
  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
  @ApiProperty({ type: () => AdminFoodOrderViewEta })
  eta!: AdminFoodOrderViewEta;
  @ApiProperty({ type: String, nullable: true })
  rider!: string | null;
  @ApiProperty({ type: String, nullable: true })
  packingPhotoUrl!: string | null;
  @ApiProperty({ type: Boolean })
  handedToExternal!: boolean;
  @ApiProperty({ type: 'integer' })
  codCollected!: number;
  @ApiProperty({ type: String, nullable: true })
  cancelledBy!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;
  @ApiProperty({ type: () => AdminFoodOrderViewTimestamps })
  timestamps!: AdminFoodOrderViewTimestamps;
  @ApiProperty({ type: () => [AdminFoodOrderViewEventsItem] })
  events!: AdminFoodOrderViewEventsItem[];
  @ApiProperty({ type: Boolean })
  canCancel!: boolean;
  @ApiProperty({ type: Boolean })
  canReview!: boolean;
  @ApiProperty({ type: Boolean })
  canReorder!: boolean;
  @ApiProperty({ type: () => AdminFoodOrderViewCustomer })
  customer!: AdminFoodOrderViewCustomer;
}

export class AdminFoodOverviewViewActiveVendors {
  @ApiProperty({ type: 'integer' })
  restaurant!: number;
  @ApiProperty({ type: 'integer' })
  cloud_kitchen!: number;
  @ApiProperty({ type: 'integer' })
  home_kitchen!: number;
  @ApiProperty({ type: 'integer' })
  total!: number;
}

export class AdminFoodOverviewViewTopCuisinesItem {
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: 'integer' })
  orders!: number;
}

export class AdminFoodOverviewViewWaiting {
  @ApiProperty({ type: 'integer' })
  approvals!: number;
  @ApiProperty({ type: 'integer' })
  foodSafetyChecks!: number;
}

export class AdminFoodOverviewView {
  @ApiProperty({ type: String })
  date!: string;
  @ApiProperty({ type: () => AdminFoodOverviewViewActiveVendors })
  activeVendors!: AdminFoodOverviewViewActiveVendors;
  @ApiProperty({ type: 'integer' })
  ordersToday!: number;
  @ApiProperty({ type: 'integer' })
  activeOrders!: number;
  @ApiProperty({ type: Number, nullable: true })
  acceptanceRateToday!: number | null;
  @ApiProperty({ type: 'integer' })
  autoRejectsToday!: number;
  @ApiProperty({ type: () => [AdminFoodOverviewViewTopCuisinesItem] })
  topCuisines!: AdminFoodOverviewViewTopCuisinesItem[];
  @ApiProperty({ type: () => AdminFoodOverviewViewWaiting })
  waiting!: AdminFoodOverviewViewWaiting;
}

export class AdminFoodReviewListView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  author!: string;
  @ApiProperty({ type: 'integer' })
  foodRating!: number;
  @ApiProperty({ type: String, nullable: true })
  deliveryRating!: string | null;
  @ApiProperty({ type: [String] })
  tags!: string[];
  @ApiProperty({ type: String, nullable: true })
  text!: string | null;
  @ApiProperty({ type: [String] })
  photos!: string[];
  @ApiProperty({ type: String, nullable: true })
  vendorReply!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  repliedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String })
  vendorId!: string;
  @ApiProperty({ type: String })
  orderCode!: string;
  @ApiProperty({ type: Boolean })
  isHidden!: boolean;
  @ApiProperty({ type: String, nullable: true })
  hiddenReason!: string | null;
}

export class AdminFoodVendorsView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  subType!: string;
  @ApiProperty({ type: String })
  subTypeLabel!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String })
  businessStatus!: string;
  @ApiProperty({ type: String })
  branchStatus!: string;
  @ApiProperty({ type: Boolean })
  isPaused!: boolean;
  @ApiProperty({ type: Boolean })
  isFeatured!: boolean;
  @ApiProperty({ type: 'integer' })
  ratingAvg!: number;
  @ApiProperty({ type: 'integer' })
  ratingCount!: number;
  @ApiProperty({ type: 'integer' })
  orders30d!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  wentLiveAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  foodSafetyCheckedAt!: string | null;
  @ApiProperty({ type: String })
  ownerEmail!: string;
  @ApiProperty({ type: String })
  planKey!: string;
}

export class AdminFoodVendorViewProfileCuisinesItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  icon!: string;
}

export class AdminFoodVendorViewProfileBranchOpenState {
  @ApiProperty({ type: Boolean })
  open!: boolean;
  @ApiProperty({ type: Boolean })
  paused!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  closesAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  opensAt!: string | null;
  @ApiProperty({ type: String })
  label!: string;
}

export class AdminFoodVendorViewProfileBranch {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: Boolean })
  isLive!: boolean;
  @ApiProperty({ type: String, format: 'date-time' })
  wentLiveAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  foodSafetyCheckedAt!: string | null;
  @ApiProperty({ type: Boolean })
  isPaused!: boolean;
  @ApiProperty({ type: String, nullable: true })
  pauseMessage!: string | null;
  @ApiProperty({ type: String, nullable: true })
  pauseReason!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  autoResumeAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  busy!: string | null;
  @ApiProperty({ type: () => AdminFoodVendorViewProfileBranchOpenState })
  openState!: AdminFoodVendorViewProfileBranchOpenState;
}

export class AdminFoodVendorViewProfile {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  subType!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  tagline!: string | null;
  @ApiProperty({ type: String })
  logoUrl!: string;
  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;
  @ApiProperty({ type: String })
  brandColor!: string;
  @ApiProperty({ type: String })
  onBrandColor!: string;
  @ApiProperty({ type: () => [AdminFoodVendorViewProfileCuisinesItem] })
  cuisines!: AdminFoodVendorViewProfileCuisinesItem[];
  @ApiProperty({ type: 'integer' })
  priceLevel!: number;
  @ApiProperty({ type: Boolean })
  isHomeKitchen!: boolean;
  @ApiProperty({ type: 'integer' })
  ratingAvg!: number;
  @ApiProperty({ type: 'integer' })
  ratingCount!: number;
  @ApiProperty({ type: () => AdminFoodVendorViewProfileBranch })
  branch!: AdminFoodVendorViewProfileBranch;
}

export class AdminFoodVendorViewSettingsLocation {
  @ApiProperty({ type: String })
  addressLine!: string;
  @ApiProperty({ type: String })
  area!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: Number })
  lat!: number;
  @ApiProperty({ type: Number })
  lng!: number;
  @ApiProperty({ type: String })
  phone!: string;
  @ApiProperty({ type: String })
  timezone!: string;
}

export class AdminFoodVendorViewSettings {
  @ApiProperty({ type: Boolean })
  acceptsDelivery!: boolean;
  @ApiProperty({ type: Boolean })
  acceptsPickup!: boolean;
  @ApiProperty({ type: Boolean })
  acceptsCod!: boolean;
  @ApiProperty({ type: 'integer' })
  codLimit!: number;
  @ApiProperty({ type: Boolean })
  transferConfirmBeforePrep!: boolean;
  @ApiProperty({ type: 'integer' })
  autoRejectMinutes!: number;
  @ApiProperty({ type: 'integer' })
  prepMinutes!: number;
  @ApiProperty({ type: 'integer' })
  maxRadiusKm!: number;
  @ApiProperty({ type: String, nullable: true })
  freeDeliveryOver!: string | null;
  @ApiProperty({ type: Boolean })
  preorderOnly!: boolean;
  @ApiProperty({ type: () => AdminFoodVendorViewSettingsLocation })
  location!: AdminFoodVendorViewSettingsLocation;
}

export class AdminFoodVendorViewHoursItem {
  @ApiProperty({ type: 'integer' })
  weekday!: number;
  @ApiProperty({ type: String })
  opensAt!: string;
  @ApiProperty({ type: String })
  closesAt!: string;
  @ApiProperty({ type: Boolean })
  overnight!: boolean;
}

export class AdminFoodVendorViewFeeBandsItem {
  @ApiProperty({ type: 'integer' })
  fromKm!: number;
  @ApiProperty({ type: 'integer' })
  toKm!: number;
  @ApiProperty({ type: 'integer' })
  fee!: number;
  @ApiProperty({ type: 'integer' })
  minOrder!: number;
}

export class AdminFoodVendorViewSetupItemsItem {
  @ApiProperty({ type: String })
  key!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: Boolean })
  required!: boolean;
  @ApiProperty({ type: Boolean })
  done!: boolean;
}

export class AdminFoodVendorViewSetup {
  @ApiProperty({ type: String })
  subType!: string;
  @ApiProperty({ type: () => [AdminFoodVendorViewSetupItemsItem] })
  items!: AdminFoodVendorViewSetupItemsItem[];
  @ApiProperty({ type: 'integer' })
  percent!: number;
  @ApiProperty({ type: [String] })
  missing!: string[];
  @ApiProperty({ type: Boolean })
  ready!: boolean;
  @ApiProperty({ type: Boolean })
  isLive!: boolean;
}

export class AdminFoodVendorViewPlanLimits {
  @ApiProperty({ type: 'integer' })
  brands!: number;
  @ApiProperty({ type: 'integer' })
  branches!: number;
  @ApiProperty({ type: 'integer' })
  riders!: number;
  @ApiProperty({ type: 'integer' })
  menu_items!: number;
  @ApiProperty({ type: 'integer' })
  promotions_active!: number;
  @ApiProperty({ type: 'integer' })
  ai_actions_month!: number;
  @ApiProperty({ type: 'integer' })
  voice_minutes_month!: number;
}

export class AdminFoodVendorViewPlanUsage {
  @ApiProperty({ type: 'integer' })
  brands!: number;
  @ApiProperty({ type: 'integer' })
  branches!: number;
  @ApiProperty({ type: 'integer' })
  riders!: number;
  @ApiProperty({ type: 'integer' })
  menu_items!: number;
  @ApiProperty({ type: 'integer' })
  promotions_active!: number;
  @ApiProperty({ type: 'integer' })
  ai_actions_month!: number;
  @ApiProperty({ type: 'integer' })
  voice_minutes_month!: number;
}

export class AdminFoodVendorViewPlanEntitlements {
  @ApiProperty({ type: Boolean })
  riders!: boolean;
  @ApiProperty({ type: Boolean })
  promotions!: boolean;
  @ApiProperty({ type: Boolean })
  insights!: boolean;
  @ApiProperty({ type: Boolean })
  preorders!: boolean;
}

export class AdminFoodVendorViewPlanOverrides {}

export class AdminFoodVendorViewPlan {
  @ApiProperty({ type: String })
  planKey!: string;
  @ApiProperty({ type: String })
  label!: string;
  @ApiProperty({ type: 'integer' })
  priceMinorUnits!: number;
  @ApiProperty({ type: String })
  currency!: string;
  @ApiProperty({ type: () => AdminFoodVendorViewPlanLimits })
  limits!: AdminFoodVendorViewPlanLimits;
  @ApiProperty({ type: () => AdminFoodVendorViewPlanUsage })
  usage!: AdminFoodVendorViewPlanUsage;
  @ApiProperty({ type: () => AdminFoodVendorViewPlanEntitlements })
  entitlements!: AdminFoodVendorViewPlanEntitlements;
  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
  @ApiProperty({ type: () => AdminFoodVendorViewPlanOverrides })
  overrides!: AdminFoodVendorViewPlanOverrides;
}

export class AdminFoodVendorViewMenuItemItemsItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: 'integer' })
  basePrice!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminFoodVendorViewMenuItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: () => [AdminFoodVendorViewMenuItemItemsItem] })
  items!: AdminFoodVendorViewMenuItemItemsItem[];
}

export class AdminFoodVendorViewRecentOrdersItemPayment {
  @ApiProperty({ type: String })
  method!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminFoodVendorViewRecentOrdersItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  statusLabel!: string;
  @ApiProperty({ type: String })
  fulfilment!: string;
  @ApiProperty({ type: String, nullable: true })
  scheduledFor!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
  @ApiProperty({ type: String, nullable: true })
  acceptBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  promisedAt!: string;
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: () => AdminFoodVendorViewRecentOrdersItemPayment })
  payment!: AdminFoodVendorViewRecentOrdersItemPayment;
  @ApiProperty({ type: 'integer' })
  itemCount!: number;
  @ApiProperty({ type: String })
  itemsSummary!: string;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ type: String, nullable: true })
  riderId!: string | null;
  @ApiProperty({ type: Boolean })
  handedToExternal!: boolean;
}

export class AdminFoodVendorViewRatings {
  @ApiProperty({ type: 'integer' })
  ratingAvg!: number;
  @ApiProperty({ type: 'integer' })
  ratingCount!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  distribution!: Record<string, unknown>;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  topTags!: unknown[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  recent!: unknown[];
}

export class AdminFoodVendorView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessId!: string;
  @ApiProperty({ type: String })
  subType!: string;
  @ApiProperty({ type: String })
  subTypeLabel!: string;
  @ApiProperty({ type: String })
  businessStatus!: string;
  @ApiProperty({ type: String, nullable: true })
  suspensionReason!: string | null;
  @ApiProperty({ type: String })
  ownerEmail!: string;
  @ApiProperty({ type: () => AdminFoodVendorViewProfile })
  profile!: AdminFoodVendorViewProfile;
  @ApiProperty({ type: () => AdminFoodVendorViewSettings })
  settings!: AdminFoodVendorViewSettings;
  @ApiProperty({ type: () => [AdminFoodVendorViewHoursItem] })
  hours!: AdminFoodVendorViewHoursItem[];
  @ApiProperty({ type: () => [AdminFoodVendorViewFeeBandsItem] })
  feeBands!: AdminFoodVendorViewFeeBandsItem[];
  @ApiProperty({ type: () => AdminFoodVendorViewSetup })
  setup!: AdminFoodVendorViewSetup;
  @ApiProperty({ type: () => AdminFoodVendorViewPlan })
  plan!: AdminFoodVendorViewPlan;
  @ApiProperty({ type: () => [AdminFoodVendorViewMenuItem] })
  menu!: AdminFoodVendorViewMenuItem[];
  @ApiProperty({ type: () => [AdminFoodVendorViewRecentOrdersItem] })
  recentOrders!: AdminFoodVendorViewRecentOrdersItem[];
  @ApiProperty({ type: () => AdminFoodVendorViewRatings })
  ratings!: AdminFoodVendorViewRatings;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  complaints!: unknown[];
}

export class AdminFoodUpdateBannerView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  imageUrl!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;
  @ApiProperty({ type: String })
  targetType!: string;
  @ApiProperty({ type: String })
  targetId!: string;
  @ApiProperty({ type: String, nullable: true })
  targetQuery!: string | null;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminFoodUpdateCuisineView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  icon!: string;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminFoodCreateBannerView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  imageUrl!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;
  @ApiProperty({ type: String })
  targetType!: string;
  @ApiProperty({ type: String, nullable: true })
  targetId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  targetQuery!: string | null;
  @ApiProperty({ type: String, nullable: true })
  city!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminFoodCreateCuisineView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String })
  icon!: string;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminFoodHideView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isHidden!: boolean;
  @ApiProperty({ type: String })
  hiddenReason!: string;
}

export class AdminFoodUnhideView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isHidden!: boolean;
  @ApiProperty({ type: String, nullable: true })
  hiddenReason!: string | null;
}

export class AdminFoodFeatureView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isFeatured!: boolean;
}

export class AdminFoodReinstateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessStatus!: string;
  @ApiProperty({ type: String, nullable: true })
  suspensionReason!: string | null;
}

export class AdminFoodSuspendView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  businessStatus!: string;
  @ApiProperty({ type: String })
  suspensionReason!: string;
}

export class AdminFoodUnfeatureView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isFeatured!: boolean;
}
