import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FoodDiscoveryService } from '../food/discovery/discovery.service';
import { HIGH_PROTEIN_G } from './nutrition-math';
import { nutritionLabel } from './item-nutrition.service';

/**
 * Nutrition for customers: the item-sheet block, per-dish values on the
 * vendor page's menu, and the vendor-list filters maxKcal / highProtein.
 * A dish the vendor hid shows nothing.
 */
@Injectable()
export class NutritionDiscoveryService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
  ) {}

  onModuleInit(): void {
    this.discovery.itemExtras.push(async (itemId) => ({
      nutrition: await this.block(itemId),
    }));
    this.discovery.vendorExtras.push(async (v) => ({
      nutritionByItem: await this.byItem(v.brandId),
    }));
    this.discovery.brandFilters.push(async (q) => {
      if (!q.maxKcal && q.highProtein !== 'true') return null;
      const rows = await this.dataSource.query(
        `SELECT DISTINCT mi.brand_id FROM menu_item_nutrition n JOIN menu_items mi ON mi.id = n.menu_item_id AND mi.is_active
          WHERE NOT n.hidden AND ($1::numeric IS NULL OR n.kcal <= $1) AND ($2::boolean IS NOT TRUE OR n.protein_g >= ${HIGH_PROTEIN_G})`,
        [q.maxKcal ?? null, q.highProtein === 'true'],
      );
      return rows.map((r: { brand_id: string }) => r.brand_id);
    });
  }

  private async block(itemId: string) {
    const [n] = await this.dataSource.query(
      `SELECT kcal, protein_g, carbs_g, fat_g, fibre_g, sodium_mg, serving_grams, method, confidence, badges
         FROM menu_item_nutrition WHERE menu_item_id = $1 AND NOT hidden`,
      [itemId],
    );
    if (!n) return null;
    return {
      perServing: {
        kcal: Math.round(Number(n.kcal)),
        proteinG: Number(n.protein_g),
        carbsG: Number(n.carbs_g),
        fatG: Number(n.fat_g),
        fibreG: Number(n.fibre_g),
        sodiumMg: Math.round(Number(n.sodium_mg)),
      },
      servingGrams: n.serving_grams,
      method: n.method,
      confidence: Number(n.confidence),
      lowConfidence: n.method === 'ai_estimate',
      label: nutritionLabel(n.method),
      badges: n.badges,
    };
  }

  private async byItem(brandId: string) {
    const rows = await this.dataSource.query(
      `SELECT n.menu_item_id, n.kcal, n.protein_g, n.method, n.badges FROM menu_item_nutrition n
         JOIN menu_items mi ON mi.id = n.menu_item_id WHERE mi.brand_id = $1 AND NOT n.hidden`,
      [brandId],
    );
    return Object.fromEntries(
      rows.map((r: any) => [
        r.menu_item_id,
        {
          kcal: Math.round(Number(r.kcal)),
          proteinG: Number(r.protein_g),
          method: r.method,
          badges: r.badges,
        },
      ]),
    );
  }
}
