import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { parallel } from '../../../common/db/parallel';
import {
  ItemSnapshot,
  fromPrice,
  groupsFor,
  inWindow,
  unavailableReason,
} from './item-pricing';
import { localMinutes } from '../../../common/time/time.util';

/** Show "6 left today" at or below this. */
export const LOW_PORTIONS = 10;

/**
 * The menu as customers (and the cart) see it: items with their variants,
 * option groups and today's branch overrides, loaded in a handful of queries.
 * Pricing and every availability rule live in item-pricing.ts.
 */
@Injectable()
export class MenuReadService {
  constructor(private readonly dataSource: DataSource) {}

  /** Snapshots for a branch's menu (all items, or `itemIds`). */
  async snapshots(
    branchId: string,
    itemIds: string[] | null = null,
    m: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, ItemSnapshot>> {
    const items = await m.query(
      `SELECT i.id, i.name, i.base_price, i.is_active, i.days_mask, i.photo_url,
              c.id AS c_id, c.name AS c_name, c.is_active AS c_active,
              c.available_from::text AS c_from, c.available_to::text AS c_to,
              o.is_available, o.unavailable_until, o.remaining_today
         FROM branches br
         JOIN menu_items i ON i.brand_id = br.brand_id
         JOIN menu_categories c ON c.id = i.category_id
         LEFT JOIN branch_item_overrides o ON o.branch_id = br.id AND o.item_id = i.id
        WHERE br.id = $1 AND ($2::uuid[] IS NULL OR i.id = ANY($2::uuid[]))`,
      [branchId, itemIds],
    );
    const out = new Map<string, ItemSnapshot>();
    if (!items.length) return out;
    const ids = items.map((i: any) => i.id);
    const [variants, groups, unavailable] = await parallel(m, [
      () =>
        m.query(
          `SELECT id, item_id, name, price FROM item_variants WHERE item_id = ANY($1::uuid[]) ORDER BY sort, price, id`,
          [ids],
        ),
      () =>
        m.query(
          `SELECT l.item_id, l.variant_id, l.sort, g.id, g.name, g.min_select, g.max_select,
                coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'priceDelta', o.price_delta,
                         'isActive', o.is_active, 'isDefault', o.is_default) ORDER BY o.sort, o.name)
                         FILTER (WHERE o.id IS NOT NULL), '[]') AS options
           FROM item_option_groups l JOIN option_groups g ON g.id = l.group_id
           LEFT JOIN options o ON o.group_id = g.id
          WHERE l.item_id = ANY($1::uuid[])
          GROUP BY l.item_id, l.variant_id, l.sort, g.id ORDER BY l.sort, g.name`,
          [ids],
        ),
      () =>
        m.query(
          `SELECT option_id FROM branch_option_overrides WHERE branch_id = $1 AND NOT is_available`,
          [branchId],
        ),
    ]);
    const off = unavailable.map((u: any) => u.option_id);
    for (const i of items) {
      out.set(i.id, {
        id: i.id,
        name: i.name,
        basePrice: i.base_price,
        isActive: i.is_active,
        daysMask: i.days_mask,
        photoUrl: i.photo_url,
        category: {
          id: i.c_id,
          name: i.c_name,
          isActive: i.c_active,
          availableFrom: i.c_from,
          availableTo: i.c_to,
        },
        variants: variants
          .filter((v: any) => v.item_id === i.id)
          .map((v: any) => ({ id: v.id, name: v.name, price: v.price })),
        groups: groups
          .filter((g: any) => g.item_id === i.id)
          .map((g: any) => ({
            id: g.id,
            name: g.name,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            variantId: g.variant_id,
            options: g.options,
          })),
        available: i.is_available ?? true,
        unavailableUntil: i.unavailable_until
          ? new Date(i.unavailable_until)
          : null,
        remainingToday: i.remaining_today ?? null,
        unavailableOptionIds: off,
      });
    }
    return out;
  }

  /**
   * The customer menu at `now`: categories in order (with their daily window
   * and whether it is open now), items ordered for display. 86'd items and
   * items not on today's weekly menu are left out; sold-out items stay,
   * marked. "6 left today" when ≤ 10 portions remain.
   */
  async customerMenu(
    brandId: string,
    branchId: string,
    tz: string,
    now = new Date(),
  ) {
    const [cats, rows, snaps] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name, available_from::text AS available_from, available_to::text AS available_to
           FROM menu_categories WHERE brand_id = $1 AND is_active ORDER BY sort, name`,
        [brandId],
      ),
      this.dataSource.query(
        `SELECT id, category_id, description, tags, is_deal, serves, sold_30d FROM menu_items
          WHERE brand_id = $1 AND is_active ORDER BY sort, name`,
        [brandId],
      ),
      this.snapshots(branchId),
    ]);
    const minute = localMinutes(now, tz);
    const card = (r: any) => {
      const s = snaps.get(r.id)!;
      const reason = unavailableReason(s, tz, now);
      if (
        reason === 'unavailable' ||
        reason === 'not_today' ||
        reason === 'not_on_menu'
      )
        return null;
      return {
        id: s.id,
        name: s.name,
        description: r.description,
        photoUrl: s.photoUrl,
        fromPrice: fromPrice(s),
        hasVariants: s.variants.length > 0,
        hasOptions: s.groups.length > 0,
        tags: r.tags,
        isDeal: r.is_deal,
        serves: r.serves,
        available: reason === null,
        unavailableReason: reason,
        soldOut: reason === 'sold_out',
        remainingToday: s.remainingToday,
        remainingLabel:
          s.remainingToday !== null &&
          s.remainingToday > 0 &&
          s.remainingToday <= LOW_PORTIONS
            ? `${s.remainingToday} left today`
            : null,
        sold30d: r.sold_30d,
      };
    };
    type Card = NonNullable<ReturnType<typeof card>>;
    const cards = new Map<string, { r: any; c: Card | null }>(
      rows.map((r: any) => [r.id, { r, c: card(r) }]),
    );
    const categories = cats
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        availableFrom: c.available_from?.slice(0, 5) ?? null,
        availableTo: c.available_to?.slice(0, 5) ?? null,
        availableNow: inWindow(c.available_from, c.available_to, minute),
        items: rows
          .filter((r: any) => r.category_id === c.id)
          .map((r: any) => cards.get(r.id)!.c)
          .filter(Boolean),
      }))
      .filter((c: any) => c.items.length);
    const popular = [...cards.values()]
      .filter(({ c, r }) => c !== null && c.available && r.sold_30d > 0)
      .sort((a, b) => b.r.sold_30d - a.r.sold_30d)
      .slice(0, 6)
      .map(({ c }) => c as Card);
    return { categories, popular };
  }

  /** The item sheet: variants and the option groups that apply to each. */
  async itemSheet(
    itemId: string,
    branchId: string,
    tz: string,
    now = new Date(),
  ) {
    const s = (await this.snapshots(branchId, [itemId])).get(itemId);
    if (!s) return null;
    const [row] = await this.dataSource.query(
      `SELECT description, tags, is_deal, serves FROM menu_items WHERE id = $1`,
      [itemId],
    );
    const reason = unavailableReason(s, tz, now);
    const groupView = (g: ItemSnapshot['groups'][number]) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: g.minSelect >= 1,
      variantId: g.variantId,
      options: g.options
        .filter((o) => o.isActive)
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: o.priceDelta,
          isDefault: o.isDefault,
          available: !s.unavailableOptionIds.includes(o.id),
        })),
    });
    return {
      id: s.id,
      name: s.name,
      description: row.description,
      photoUrl: s.photoUrl,
      tags: row.tags,
      isDeal: row.is_deal,
      serves: row.serves,
      basePrice: s.basePrice,
      fromPrice: fromPrice(s),
      category: { id: s.category.id, name: s.category.name },
      available: reason === null,
      unavailableReason: reason,
      remainingToday: s.remainingToday,
      variants: s.variants.map((v) => ({
        ...v,
        groupIds: groupsFor(s, v.id).map((g) => g.id),
      })),
      groups: s.groups.map(groupView),
    };
  }
}
