import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { normalizeText } from '../../../common/text/fuzzy';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { kitchenNotFound } from '../common/errors';
import { readSpi, spiUnit } from './spi-csv';

/** More than this above the city reference → flagged. */
export const ABOVE_REFERENCE_PCT = 15;
/** The city reference rising more than this in a week → flagged. */
export const REFERENCE_RISE_PCT = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Price watch: what the kitchen last paid against the Pakistan Bureau of
 * Statistics weekly city prices (SPI), per the SPI item's unit.
 */
@Injectable()
export class PriceWatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  async view(v: VendorRef) {
    const [b] = await this.dataSource.query(
      `SELECT city FROM branches WHERE id = $1`,
      [v.branchId],
    );
    const city: string = b.city;
    const rows = await this.dataSource.query(
      `SELECT ki.id, ki.name, ki.base_unit, ki.last_cost, ki.reference_item_id,
              ri.name AS ref_name, ri.unit AS ref_unit, ri.factor, ri.base_unit AS ref_base,
              p1.price AS ref_price, p1.week_ending AS ref_week, p2.price AS prev_price, p2.week_ending AS prev_week
         FROM kitchen_ingredients ki
         JOIN reference_items ri ON ri.id = ki.reference_item_id
         LEFT JOIN LATERAL (SELECT price, week_ending FROM reference_prices
                             WHERE item_id = ri.id AND city = $2 ORDER BY week_ending DESC LIMIT 1) p1 ON true
         LEFT JOIN LATERAL (SELECT price, week_ending FROM reference_prices
                             WHERE item_id = ri.id AND city = $2 AND week_ending < p1.week_ending
                             ORDER BY week_ending DESC LIMIT 1) p2 ON true
        WHERE ki.branch_id = $1 AND ki.is_active ORDER BY ki.name`,
      [v.branchId, city],
    );
    const items = rows.map((r: any) => {
      const sameKind = r.base_unit === r.ref_base;
      const yours =
        r.last_cost !== null && sameKind
          ? Math.round(Number(r.last_cost) * Number(r.factor) * 100) / 100
          : null;
      const ref = r.ref_price === null ? null : Number(r.ref_price);
      const prev = r.prev_price === null ? null : Number(r.prev_price);
      const days =
        r.prev_week && r.ref_week
          ? (Date.parse(r.ref_week) - Date.parse(r.prev_week)) / 86_400_000
          : null;
      const pctAbove =
        yours !== null && ref ? round1(((yours - ref) / ref) * 100) : null;
      const weekChange =
        ref && prev && days !== null && days <= 8
          ? round1(((ref - prev) / prev) * 100)
          : null;
      return {
        ingredientId: r.id,
        name: r.name,
        reference: {
          id: r.reference_item_id,
          name: r.ref_name,
          unit: r.ref_unit,
        },
        city,
        weekEnding: r.ref_week,
        referencePrice: ref,
        yourPrice: yours,
        pctAbove,
        weekChangePct: weekChange,
        aboveReference: pctAbove !== null && pctAbove > ABOVE_REFERENCE_PCT,
        referenceRising: weekChange !== null && weekChange > REFERENCE_RISE_PCT,
      };
    });
    return { city, items, suggestions: await this.suggestions(v) };
  }

  /** Unmapped ingredients whose alias canonical matches an SPI item. */
  async suggestions(v: VendorRef) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (ki.id) ki.id, ki.name, ri.id AS ref_id, ri.name AS ref_name, ri.unit
         FROM kitchen_ingredients ki
         JOIN ingredient_aliases a ON a.alias = ki.name::text::citext
                                   OR a.alias = ANY(string_to_array(lower(ki.name::text), ' ')::citext[])
         JOIN reference_items ri ON ri.canonical = a.canonical AND ri.base_unit = ki.base_unit
        WHERE ki.branch_id = $1 AND ki.is_active AND ki.reference_item_id IS NULL
        ORDER BY ki.id, ri.name`,
      [v.branchId],
    );
    return rows.map((r: any) => ({
      ingredientId: r.id,
      name: r.name,
      reference: { id: r.ref_id, name: r.ref_name, unit: r.unit },
    }));
  }

  async referenceItems(q?: string) {
    const rows = await this.dataSource.query(
      `SELECT ri.id, ri.name, ri.unit, ri.base_unit, ri.canonical,
              (SELECT count(DISTINCT city)::int FROM reference_prices rp WHERE rp.item_id = ri.id) AS cities,
              (SELECT max(week_ending) FROM reference_prices rp WHERE rp.item_id = ri.id) AS latest_week
         FROM reference_items ri ${q ? 'WHERE ri.name ILIKE $1' : ''} ORDER BY ri.name`,
      q ? [`%${q}%`] : [],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      baseUnit: r.base_unit,
      canonical: r.canonical,
      cities: r.cities,
      latestWeek: r.latest_week,
    }));
  }

  async map(
    v: VendorRef,
    ingredientId: string,
    referenceItemId: string | null,
  ) {
    const [i] = await this.dataSource.query(
      `SELECT id, base_unit FROM kitchen_ingredients WHERE id = $1 AND branch_id = $2`,
      [ingredientId, v.branchId],
    );
    if (!i) throw kitchenNotFound('Ingredient');
    if (referenceItemId) {
      const [ri] = await this.dataSource.query(
        `SELECT id, base_unit FROM reference_items WHERE id = $1`,
        [referenceItemId],
      );
      if (!ri) throw kitchenNotFound('Reference item');
      if (ri.base_unit !== i.base_unit)
        throw new BadRequestException({
          code: ErrorCode.UNIT_MISMATCH,
          message: 'That reference item is counted in a different unit.',
          details: { baseUnit: i.base_unit, referenceBaseUnit: ri.base_unit },
        });
    }
    await this.dataSource.query(
      `UPDATE kitchen_ingredients SET reference_item_id = $2, updated_at = now() WHERE id = $1`,
      [ingredientId, referenceItemId],
    );
    return { ingredientId, referenceItemId };
  }

  /** Staff: the weekly SPI CSV → reference items and prices (upsert). Audited. */
  async import(csv: string) {
    const { rows, errors } = readSpi(csv);
    if (!rows.length)
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'No usable rows.',
        details: {
          fields: {
            csv: errors.slice(0, 20).map((e) => `line ${e.line}: ${e.error}`),
          },
          errors,
        },
      });
    const result = await this.dataSource.transaction(async (m) => {
      const names = [...new Set(rows.map((r) => r.item))];
      const words = [
        ...new Set(
          names.flatMap((n) => [
            normalizeText(n),
            ...normalizeText(n).split(' '),
          ]),
        ),
      ];
      const aliases: Array<{ alias: string; canonical: string }> =
        await m.query(
          `SELECT alias::text, canonical FROM ingredient_aliases WHERE alias = ANY($1::citext[])`,
          [words],
        );
      const canon = new Map(
        aliases.map((a) => [normalizeText(a.alias), a.canonical]),
      );
      const ids = new Map<string, string>();
      for (const name of names) {
        const unit = rows.find((r) => r.item === name)!.unit;
        const u = spiUnit(unit)!;
        const n = normalizeText(name);
        const canonical =
          canon.get(n) ??
          n
            .split(' ')
            .map((w) => canon.get(w))
            .find(Boolean) ??
          null;
        const [row] = await m.query(
          `INSERT INTO reference_items (name, unit, base_unit, factor, canonical) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO UPDATE SET unit = EXCLUDED.unit, base_unit = EXCLUDED.base_unit,
             factor = EXCLUDED.factor, canonical = coalesce(reference_items.canonical, EXCLUDED.canonical), updated_at = now()
           RETURNING id`,
          [name, unit, u.baseUnit, u.factor, canonical],
        );
        ids.set(name, row.id);
      }
      for (const r of rows)
        await m.query(
          `INSERT INTO reference_prices (item_id, city, week_ending, price) VALUES ($1, $2, $3, $4)
           ON CONFLICT (item_id, city, week_ending) DO UPDATE SET price = EXCLUDED.price, updated_at = now()`,
          [ids.get(r.item), r.city, r.weekEnding, r.price],
        );
      return {
        items: names.length,
        prices: rows.length,
        cities: [...new Set(rows.map((r) => r.city))],
        weeks: [...new Set(rows.map((r) => r.weekEnding))].sort(),
      };
    });
    await this.audit.record({
      action: 'kitchen.reference_prices.import',
      targetType: 'reference_prices',
      details: { ...result, rejected: errors.length },
    });
    return { ...result, rejected: errors.length, errors: errors.slice(0, 50) };
  }
}
