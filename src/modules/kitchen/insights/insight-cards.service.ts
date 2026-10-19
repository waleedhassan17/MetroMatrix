import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { CostingService } from '../costing/costing.service';
import { PriceWatchService } from '../costing/price-watch.service';
import { IngredientsService } from '../stock/ingredients.service';
import { display } from '../stock/units';

export interface InsightCard {
  kind:
    | 'expiring_stock'
    | 'food_cost_high'
    | 'food_cost_rising'
    | 'price_above_reference'
    | 'reference_rising'
    | 'sold_out_by_stock'
    | 'negative_stock'
    | 'waste_spike'
    | 'forecast_gap'
    | string;
  /** 1 (nice to know) … 5 (act today). */
  priority: number;
  title: string;
  body: string;
  /** Where the app should open: screen + params. */
  action: { label: string; screen: string; params?: Record<string, string> };
  data?: Record<string, unknown>;
}

export type CardProvider = (
  v: VendorRef,
  today: string,
) => Promise<InsightCard[]>;

/**
 * GET /insights/cards: a prioritised, deterministic list of what deserves
 * the vendor's attention, each with a deep link. Later sub-domains add
 * providers (forecast vs stock gaps, Bachat Box suggestions) with register().
 */
@Injectable()
export class InsightCardsService {
  private readonly providers: CardProvider[] = [];

  constructor(
    private readonly dataSource: DataSource,
    private readonly costing: CostingService,
    private readonly priceWatch: PriceWatchService,
    private readonly ingredients: IngredientsService,
  ) {
    this.providers.push(
      (v, d) => this.expiring(v, d),
      (v) => this.foodCost(v),
      (v) => this.prices(v),
      (v) => this.soldOut(v),
      (v) => this.negative(v),
      (v, d) => this.waste(v, d),
    );
  }

  register(p: CardProvider): void {
    this.providers.push(p);
  }

  async cards(v: VendorRef): Promise<InsightCard[]> {
    const today = await this.ingredients.today(
      this.dataSource.manager,
      v.branchId,
    );
    const out: InsightCard[] = [];
    for (const p of this.providers) out.push(...(await p(v, today)));
    return out.sort(
      (a, b) => b.priority - a.priority || a.title.localeCompare(b.title),
    );
  }

  private async expiring(v: VendorRef, today: string): Promise<InsightCard[]> {
    const rows = await this.dataSource.query(
      `SELECT ki.id, ki.name, ki.base_unit, sum(sb.qty_remaining) AS qty, min(sb.expires_on) AS first,
              round(sum(sb.qty_remaining * sb.unit_cost))::int AS value
         FROM stock_batches sb JOIN kitchen_ingredients ki ON ki.id = sb.ingredient_id
        WHERE ki.branch_id = $1 AND sb.qty_remaining > 0 AND sb.expires_on IS NOT NULL AND sb.expires_on <= $2::date + 3
        GROUP BY ki.id ORDER BY first`,
      [v.branchId, today],
    );
    return rows.map((r: any) => {
      const d = display(Number(r.qty), r.base_unit);
      const expired = r.first < today;
      const days = Math.round(
        (Date.parse(r.first) - Date.parse(today)) / 86_400_000,
      );
      return {
        kind: 'expiring_stock',
        priority: expired || days <= 1 ? 5 : 4,
        title: expired
          ? `${r.name} is past its date`
          : `${r.name} expires ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        body: `${d.qty} ${d.unit} (Rs ${r.value.toLocaleString('en-PK')}) on the shelf. Use it in today's specials, put it in a Bachat Box, or log it as waste.`,
        action: {
          label: 'See expiring stock',
          screen: 'kitchen.stock',
          params: { filter: 'expiring' },
        },
        data: { ingredientId: r.id, expiresOn: r.first },
      };
    });
  }

  private async foodCost(v: VendorRef): Promise<InsightCard[]> {
    const rows = await this.costing.rows(this.dataSource.manager, v);
    const { target } = await this.costing.target(
      this.dataSource.manager,
      v.branchId,
    );
    const cards: InsightCard[] = [];
    for (const r of rows.filter((x) => x.isActive)) {
      const label = `${r.name}${r.variantName ? ` (${r.variantName})` : ''}`;
      if (r.aboveTarget)
        cards.push({
          kind: 'food_cost_high',
          priority: r.foodCostPct! > target + 10 ? 4 : 3,
          title: `${label} costs ${r.foodCostPct}% of its price`,
          body: `Your target is ${target}%. Ingredients are Rs ${Math.round(r.cost!)} for a Rs ${r.price} plate — review the price or the recipe.`,
          action: {
            label: 'Open costing',
            screen: 'kitchen.costing',
            params: { itemId: r.itemId },
          },
          data: {
            itemId: r.itemId,
            variantId: r.variantId,
            foodCostPct: r.foodCostPct,
            target,
          },
        });
      else if (r.trend !== null && r.trend > 5)
        cards.push({
          kind: 'food_cost_rising',
          priority: 3,
          title: `${label}: food cost up ${r.trend} points this week`,
          body: `From ${r.lastWeekPct}% to ${r.foodCostPct}% — an ingredient got dearer.`,
          action: {
            label: 'Open costing',
            screen: 'kitchen.costing',
            params: { itemId: r.itemId },
          },
          data: { itemId: r.itemId, variantId: r.variantId, trend: r.trend },
        });
    }
    return cards;
  }

  private async prices(v: VendorRef): Promise<InsightCard[]> {
    const { items, city } = await this.priceWatch.view(v);
    const cards: InsightCard[] = [];
    for (const i of items) {
      if (i.aboveReference)
        cards.push({
          kind: 'price_above_reference',
          priority: 3,
          title: `You paid ${i.pctAbove}% more for ${i.name}`,
          body: `Rs ${i.yourPrice} per ${i.reference.unit} against Rs ${i.referencePrice} in ${city} (PBS, week ending ${i.weekEnding}). Worth asking another supplier.`,
          action: {
            label: 'Price watch',
            screen: 'kitchen.price-watch',
            params: { ingredientId: i.ingredientId },
          },
          data: { ingredientId: i.ingredientId, pctAbove: i.pctAbove },
        });
      if (i.referenceRising)
        cards.push({
          kind: 'reference_rising',
          priority: 2,
          title: `${i.reference.name} is up ${i.weekChangePct}% in ${city} this week`,
          body: `Buy what you need before it rises further, and check dishes that use ${i.name}.`,
          action: {
            label: 'Price watch',
            screen: 'kitchen.price-watch',
            params: { ingredientId: i.ingredientId },
          },
          data: {
            ingredientId: i.ingredientId,
            weekChangePct: i.weekChangePct,
          },
        });
    }
    return cards;
  }

  private async soldOut(v: VendorRef): Promise<InsightCard[]> {
    const rows = await this.dataSource.query(
      `SELECT mi.id, mi.name FROM branch_item_overrides o JOIN menu_items mi ON mi.id = o.item_id
        WHERE o.branch_id = $1 AND NOT o.is_available AND o.auto_reason = 'stock' ORDER BY mi.name`,
      [v.branchId],
    );
    return rows.map((r: any) => ({
      kind: 'sold_out_by_stock',
      priority: 5,
      title: `${r.name} is hidden: out of stock`,
      body: 'Log your purchase (or a stock count) and it comes back on its own.',
      action: { label: 'Log a purchase', screen: 'kitchen.purchase.new' },
      data: { itemId: r.id },
    }));
  }

  private async negative(v: VendorRef): Promise<InsightCard[]> {
    const rows = await this.dataSource.query(
      `SELECT id, name, base_unit, on_hand FROM kitchen_ingredients
        WHERE branch_id = $1 AND is_active AND on_hand < 0 ORDER BY name`,
      [v.branchId],
    );
    return rows.map((r: any) => {
      const d = display(Number(r.on_hand), r.base_unit);
      return {
        kind: 'negative_stock',
        priority: 4,
        title: `${r.name} shows ${d.qty} ${d.unit}`,
        body: 'More was used than was logged. Log the purchase so costs and sold-out stay right.',
        action: {
          label: 'Log a purchase',
          screen: 'kitchen.purchase.new',
          params: { ingredientId: r.id },
        },
        data: { ingredientId: r.id },
      };
    });
  }

  /** This week's waste cost at least 1.5× the weekly average of the 4 weeks before (and ≥ Rs 500). */
  private async waste(v: VendorRef, today: string): Promise<InsightCard[]> {
    const [r] = await this.dataSource.query(
      `SELECT coalesce(sum(cost) FILTER (WHERE created_at >= $2::date - 6), 0)::int AS week,
              coalesce(sum(cost) FILTER (WHERE created_at < $2::date - 6), 0)::int AS before
         FROM waste_entries WHERE branch_id = $1 AND created_at >= $2::date - 34`,
      [v.branchId, today],
    );
    const avg = r.before / 4;
    if (
      r.week < 500 ||
      (avg > 0 && r.week < avg * 1.5) ||
      (avg === 0 && r.before === 0 && r.week < 1500)
    )
      return [];
    return [
      {
        kind: 'waste_spike',
        priority: 3,
        title: `Waste this week: Rs ${r.week.toLocaleString('en-PK')}`,
        body: avg
          ? `About ${Math.round(r.week / avg)}× your usual week. See what's being thrown away.`
          : 'See what is being thrown away.',
        action: {
          label: 'Waste log',
          screen: 'kitchen.waste',
          params: { range: '7d' },
        },
        data: {
          week: r.week,
          usualWeek: Math.round(avg),
          since: addDays(today, -6),
        },
      },
    ];
  }
}
