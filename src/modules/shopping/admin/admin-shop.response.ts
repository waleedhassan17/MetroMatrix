import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-shop.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminShopDeleteBannerView {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

export class AdminShopDeleteCategoryView {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

export class AdminShopCategoriesViewChildrenItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  parentId!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminShopCategoriesView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: () => [AdminShopCategoriesViewChildrenItem] })
  children!: AdminShopCategoriesViewChildrenItem[];
}

export class AdminShopOrdersViewStore {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
}

export class AdminShopOrdersView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  groupCode!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  paymentMethod!: string;
  @ApiProperty({ type: String })
  paymentStatus!: string;
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: () => AdminShopOrdersViewStore })
  store!: AdminShopOrdersViewStore;
  @ApiProperty({ type: String })
  customerName!: string;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelledBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
}

export class AdminShopOrderViewItemsItem {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  productName!: string;
  @ApiProperty({ type: String })
  variantLabel!: string;
  @ApiProperty({ type: 'integer' })
  unitPrice!: number;
  @ApiProperty({ type: 'integer' })
  quantity!: number;
  @ApiProperty({ type: 'integer' })
  lineTotal!: number;
  @ApiProperty({ type: 'integer' })
  returnedQty!: number;
}

export class AdminShopOrderViewEventsItem {
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

export class AdminShopOrderView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  storeId!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  paymentMethod!: string;
  @ApiProperty({ type: String })
  paymentStatus!: string;
  @ApiProperty({ type: 'integer' })
  subtotal!: number;
  @ApiProperty({ type: 'integer' })
  discount!: number;
  @ApiProperty({ type: 'integer' })
  shippingFee!: number;
  @ApiProperty({ type: 'integer' })
  total!: number;
  @ApiProperty({ type: String, nullable: true })
  paymentRef!: string | null;
  @ApiProperty({ type: String, nullable: true })
  paymentProofUrl!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cancelledBy!: string | null;
  @ApiProperty({ type: () => [AdminShopOrderViewItemsItem] })
  items!: AdminShopOrderViewItemsItem[];
  @ApiProperty({ type: () => [AdminShopOrderViewEventsItem] })
  events!: AdminShopOrderViewEventsItem[];
  @ApiProperty({ type: String, format: 'date-time' })
  placedAt!: string;
}

export class AdminShopReportsViewProduct {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminShopReportsViewStore {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  name!: string;
}

export class AdminShopReportsView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  reason!: string;
  @ApiProperty({ type: String, nullable: true })
  details!: string | null;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  resolutionNote!: string | null;
  @ApiProperty({ type: 'integer' })
  openReportsOnProduct!: number;
  @ApiProperty({ type: () => AdminShopReportsViewProduct })
  product!: AdminShopReportsViewProduct;
  @ApiProperty({ type: () => AdminShopReportsViewStore })
  store!: AdminShopReportsViewStore;
}

export class AdminShopUpdateBannerView {
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
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminShopUpdateCategoryView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  parentId!: string;
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

export class AdminShopCreateBannerView {
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
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminShopCreateCategoryView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: String })
  slug!: string;
  @ApiProperty({ type: String, nullable: true })
  icon!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminShopRemoveView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  status!: string;
  @ApiProperty({ type: String })
  removedReason!: string;
}

export class AdminShopRestoreView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminShopDismissView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  status!: string;
}

export class AdminShopHideReviewView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isHidden!: boolean;
  @ApiProperty({ type: String })
  hiddenReason!: string;
}

export class AdminShopUnhideReviewView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isHidden!: boolean;
}

export class AdminShopFeatureView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isFeatured!: boolean;
}

export class AdminShopUnfeatureView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: Boolean })
  isFeatured!: boolean;
}
