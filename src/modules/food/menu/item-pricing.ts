import { ErrorCode } from '../../../common/errors/codes';
import {
  localDate,
  localMinutes,
  weekdayOf,
} from '../../../common/time/time.util';

/** Everything needed to price and validate one line, loaded by MenuReadService. */
export interface ItemSnapshot {
  id: string;
  name: string;
  basePrice: number;
  isActive: boolean;
  daysMask: number;
  photoUrl: string | null;
  category: {
    id: string;
    name: string;
    isActive: boolean;
    availableFrom: string | null;
    availableTo: string | null;
  };
  variants: Array<{ id: string; name: string; price: number }>;
  groups: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    /** null = applies to every variant. */
    variantId: string | null;
    options: Array<{
      id: string;
      name: string;
      priceDelta: number;
      isActive: boolean;
      isDefault: boolean;
    }>;
  }>;
  /** Branch overrides. */
  available: boolean;
  unavailableUntil: Date | null;
  remainingToday: number | null;
  unavailableOptionIds: string[];
}

export interface LineChoice {
  variantId?: string | null;
  optionIds?: string[];
}

export interface PricedChoice {
  unitPrice: number;
  variant: { id: string; name: string } | null;
  options: Array<{
    id: string;
    name: string;
    group: string;
    priceDelta: number;
  }>;
}

export class LineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

const minutesOf = (t: string) => {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

/** Is the category's daily window open at local minute `m`? Windows may wrap midnight. */
export function inWindow(
  from: string | null,
  to: string | null,
  m: number,
): boolean {
  if (!from || !to) return true;
  const a = minutesOf(from);
  const b = minutesOf(to) || 1440;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

export const onDay = (daysMask: number, weekday: number) =>
  (daysMask & (1 << weekday)) !== 0;

export const maskOf = (days: number[]) =>
  days.reduce((m, d) => m | (1 << d), 0);
export const daysOf = (mask: number) =>
  [0, 1, 2, 3, 4, 5, 6].filter((d) => onDay(mask, d));

/**
 * Can the item be ordered for `at` (now, or a scheduled time)? Checks the
 * item, its category (and window), the weekday mask, branch overrides and
 * today's portions. Returns null when it can, else the reason.
 */
export function unavailableReason(
  item: ItemSnapshot,
  tz: string,
  at: Date,
  now: Date = at,
): string | null {
  if (!item.isActive || !item.category.isActive) return 'not_on_menu';
  if (!item.available) return 'unavailable';
  if (item.unavailableUntil && item.unavailableUntil > now)
    return 'unavailable';
  if (!onDay(item.daysMask, weekdayOf(localDate(at, tz)))) return 'not_today';
  if (
    !inWindow(
      item.category.availableFrom,
      item.category.availableTo,
      localMinutes(at, tz),
    )
  )
    return 'outside_hours';
  if (item.remainingToday !== null && item.remainingToday <= 0)
    return 'sold_out';
  return null;
}

/** The groups that apply to a variant (shared ones plus that variant's own). */
export const groupsFor = (item: ItemSnapshot, variantId: string | null) =>
  item.groups.filter((g) => g.variantId === null || g.variantId === variantId);

/**
 * Price one line: the variant's price (or the base price) plus option
 * deltas, after checking every rule. Throws LineError naming the item and,
 * for option problems, the group.
 */
export function priceChoice(
  item: ItemSnapshot,
  choice: LineChoice,
): PricedChoice {
  let variant: { id: string; name: string; price: number } | null = null;
  if (item.variants.length) {
    variant = item.variants.find((v) => v.id === choice.variantId) ?? null;
    if (!variant) {
      throw new LineError(
        ErrorCode.OPTION_REQUIRED,
        `Choose a size for ${item.name}.`,
        { item: item.name, itemId: item.id, group: 'Size' },
      );
    }
  } else if (choice.variantId) {
    throw new LineError(
      ErrorCode.OPTION_INVALID,
      `${item.name} has no sizes.`,
      {
        item: item.name,
        itemId: item.id,
        group: 'Size',
      },
    );
  }
  const groups = groupsFor(item, variant?.id ?? null);
  const chosen = [...new Set(choice.optionIds ?? [])];
  const picked: PricedChoice['options'] = [];
  for (const id of chosen) {
    const group = groups.find((g) => g.options.some((o) => o.id === id));
    const option = group?.options.find((o) => o.id === id);
    if (!group || !option || !option.isActive) {
      throw new LineError(
        ErrorCode.OPTION_INVALID,
        `That choice isn’t available for ${item.name}.`,
        {
          item: item.name,
          itemId: item.id,
          group: group?.name ?? null,
          optionId: id,
        },
      );
    }
    if (item.unavailableOptionIds.includes(id)) {
      throw new LineError(
        ErrorCode.OPTION_INVALID,
        `${option.name} has run out today.`,
        {
          item: item.name,
          itemId: item.id,
          group: group.name,
          optionId: id,
        },
      );
    }
    picked.push({
      id: option.id,
      name: option.name,
      group: group.name,
      priceDelta: option.priceDelta,
    });
  }
  for (const g of groups) {
    const n = picked.filter(
      (p) => p.group === g.name && g.options.some((o) => o.id === p.id),
    ).length;
    if (n < g.minSelect) {
      throw new LineError(
        ErrorCode.OPTION_REQUIRED,
        g.minSelect === 1
          ? `Choose ${g.name.toLowerCase()} for ${item.name}.`
          : `Choose at least ${g.minSelect} in “${g.name}” for ${item.name}.`,
        { item: item.name, itemId: item.id, group: g.name, min: g.minSelect },
      );
    }
    if (n > g.maxSelect) {
      throw new LineError(
        ErrorCode.OPTION_LIMIT,
        `Choose at most ${g.maxSelect} in “${g.name}” for ${item.name}.`,
        { item: item.name, itemId: item.id, group: g.name, max: g.maxSelect },
      );
    }
  }
  const unitPrice =
    (variant?.price ?? item.basePrice) +
    picked.reduce((s, p) => s + p.priceDelta, 0);
  return {
    unitPrice,
    variant: variant ? { id: variant.id, name: variant.name } : null,
    options: picked,
  };
}

/** "from" price on a menu card: the cheapest variant, or the base price. */
export const fromPrice = (
  item: Pick<ItemSnapshot, 'basePrice' | 'variants'>,
) =>
  item.variants.length
    ? Math.min(...item.variants.map((v) => v.price))
    : item.basePrice;
