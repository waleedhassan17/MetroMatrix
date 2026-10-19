import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { IngredientsService } from './ingredients.service';
import { display } from './units';

export interface SpokenLine {
  name: string;
  qty?: number;
  unit?: string;
  totalPrice?: number;
  expiresInDays?: number;
}

export type ResolvedLine =
  | {
      spoken: string;
      status: 'ok' | 'UNIT_MISMATCH';
      ingredientId: string;
      name: string;
      qty: number | null;
      unit: string;
      qtyBase: number | null;
      baseUnit: 'g' | 'ml' | 'piece';
      display: { qty: number; unit: string } | null;
      totalPrice: number | null;
    }
  | {
      spoken: string;
      status: 'UNKNOWN_INGREDIENT';
      /** The alias table's name for it ("tomato"): offer "create ingredient". */
      suggestedName: string | null;
      candidates: Array<{ id: string; label: string; score: number }>;
      qty: number | null;
      unit: string | null;
      totalPrice: number | null;
    };

/**
 * Spoken or scanned lines → the kitchen's ingredients, quantities in base
 * units. An unknown name is never guessed: it comes back as
 * UNKNOWN_INGREDIENT with the canonical name to create it under.
 */
@Injectable()
export class LineResolver {
  constructor(private readonly ingredients: IngredientsService) {}

  async resolve(
    branchId: string,
    lines: SpokenLine[] = [],
    m?: EntityManager,
  ): Promise<ResolvedLine[]> {
    const out: ResolvedLine[] = [];
    for (const l of lines) {
      const r = await this.ingredients.resolve(branchId, l.name, m);
      if (!r.ingredient) {
        out.push({
          spoken: l.name,
          status: 'UNKNOWN_INGREDIENT',
          suggestedName: r.canonical,
          candidates: r.candidates.map((c) => ({
            id: c.value.id,
            label: c.value.name,
            score: Number(c.score.toFixed(2)),
          })),
          qty: l.qty ?? null,
          unit: l.unit ?? null,
          totalPrice: l.totalPrice ?? null,
        });
        continue;
      }
      const i = r.ingredient;
      const qtyBase = this.ingredients.safeBase(i, l.qty, l.unit);
      out.push({
        spoken: l.name,
        status:
          qtyBase === null && l.qty !== undefined ? 'UNIT_MISMATCH' : 'ok',
        ingredientId: i.id,
        name: i.name,
        qty: l.qty ?? null,
        unit: l.unit ?? i.base_unit,
        qtyBase,
        baseUnit: i.base_unit,
        display: qtyBase === null ? null : display(qtyBase, i.base_unit),
        totalPrice: l.totalPrice ?? null,
      });
    }
    return out;
  }
}

export type KnownLine = Extract<ResolvedLine, { ingredientId: string }>;

export const isReady = (l: ResolvedLine): l is KnownLine =>
  l.status === 'ok' && l.qtyBase !== null;
