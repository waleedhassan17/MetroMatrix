/**
 * The vocabulary of partner businesses. Enum values are stored as-is in
 * Postgres enums, so they are a contract: add, never rename.
 */

export const SERVICE_TYPES = ['shopping', 'healthcare', 'food'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SUB_TYPES = [
  'store',
  'doctor',
  'restaurant',
  'home_kitchen',
  'cloud_kitchen',
] as const;
export type SubType = (typeof SUB_TYPES)[number];

/** How the approval queue and apps name each kind of business. */
export const SUB_TYPE_LABELS: Record<SubType, string> = {
  store: 'Store',
  doctor: 'Doctor',
  restaurant: 'Restaurant',
  home_kitchen: 'Home kitchen',
  cloud_kitchen: 'Cloud kitchen',
};

/** Which service each sub-type belongs to. Mirrored by a CHECK constraint. */
export const SUBTYPE_SERVICE: Record<SubType, ServiceType> = {
  store: 'shopping',
  doctor: 'healthcare',
  restaurant: 'food',
  home_kitchen: 'food',
  cloud_kitchen: 'food',
};

export const BUSINESS_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'suspended',
] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

/** A partner may change their business only before review, or after a rejection. */
export const EDITABLE_STATUSES: readonly BusinessStatus[] = [
  'draft',
  'rejected',
];

export const DOCUMENT_KINDS = [
  'cnic_front',
  'cnic_back',
  'pmdc_certificate',
  'degree_certificate',
  'ntn_certificate',
  'shop_photo',
  'pfa_licence',
  'storefront_photo',
  'kitchen_photo',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Kinds a business may hold several of (up to MAX_PER_MULTI_KIND). */
export const MULTI_KINDS: readonly DocumentKind[] = [
  'kitchen_photo',
  'shop_photo',
];
export const MAX_PER_MULTI_KIND = 4;

export const DOCUMENT_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Human names, for emails and admin screens. */
export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  cnic_front: 'CNIC (front)',
  cnic_back: 'CNIC (back)',
  pmdc_certificate: 'PMDC certificate',
  degree_certificate: 'Degree certificate',
  ntn_certificate: 'NTN certificate',
  shop_photo: 'Shop photo',
  pfa_licence: 'PFA licence',
  storefront_photo: 'Storefront photo',
  kitchen_photo: 'Kitchen photo',
};
