import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../common/errors/codes';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DEFAULT_TZ } from '../../common/time/time.util';
import { NutritionProfile } from './entities/nutrition-profile.entity';
import { NutritionProfileDto } from './dto/nutrition.dto';
import { MIFFLIN, mifflinTarget } from './nutrition-math';

const noProfile = () =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: 'No nutrition profile.',
  });

/**
 * The customer's own nutrition profile and their ordered-food summary.
 * Opt-in, theirs only (any other caller gets 404 — vendors included), and
 * deleted for good on request. The summary is food ordered on MetroMatrix,
 * labelled an estimate, never total intake.
 */
@Injectable()
export class NutritionProfileService {
  constructor(private readonly dataSource: DataSource) {}

  private view(p: NutritionProfile) {
    return {
      goal: p.goal,
      sex: p.sex,
      age: p.age,
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      activity: p.activity,
      targetKcal: p.targetKcal,
      targetMethod: p.targetMethod,
      formula: p.targetMethod === 'mifflin_st_jeor' ? MIFFLIN : null,
      updatedAt: p.updatedAt,
    };
  }

  private async mine(user: AuthenticatedUser) {
    // A profile only ever belongs to a customer; for anyone else there is none.
    if (user.role !== 'customer') return null;
    return this.dataSource
      .getRepository(NutritionProfile)
      .findOne({ where: { userId: user.id } });
  }

  async get(user: AuthenticatedUser) {
    const p = await this.mine(user);
    if (!p) throw noProfile();
    return this.view(p);
  }

  async put(user: AuthenticatedUser, dto: NutritionProfileDto) {
    if (user.role !== 'customer')
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Nutrition profiles are for customers.',
      });
    let target: number;
    let method: 'mifflin_st_jeor' | 'manual';
    if (dto.manualTargetKcal) {
      target = dto.manualTargetKcal;
      method = 'manual';
    } else {
      const missing = (
        ['sex', 'age', 'heightCm', 'weightKg', 'activity'] as const
      ).filter((k) => dto[k] === undefined);
      if (missing.length)
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message:
            'Give sex, age, height, weight and activity for the formula — or your own manualTargetKcal.',
          details: {
            fields: Object.fromEntries(
              missing.map((k) => [k, ['Needed for the formula.']]),
            ),
          },
        });
      target = mifflinTarget({
        sex: dto.sex!,
        age: dto.age!,
        heightCm: dto.heightCm!,
        weightKg: dto.weightKg!,
        activity: dto.activity!,
        goal: dto.goal,
      }).targetKcal;
      method = 'mifflin_st_jeor';
    }
    await this.dataSource.getRepository(NutritionProfile).save({
      userId: user.id,
      goal: dto.goal,
      sex: dto.sex ?? null,
      age: dto.age ?? null,
      heightCm: dto.heightCm ?? null,
      weightKg: dto.weightKg ?? null,
      activity: dto.activity ?? null,
      targetKcal: target,
      targetMethod: method,
    });
    return this.get(user);
  }

  async remove(user: AuthenticatedUser) {
    if (!(await this.mine(user))) throw noProfile();
    await this.dataSource
      .getRepository(NutritionProfile)
      .delete({ userId: user.id });
    return { deleted: true };
  }

  /** GET /food/me/nutrition/summary — per day, from delivered food orders only. */
  async summary(
    user: AuthenticatedUser,
    range: '7d' | '30d',
    now = new Date(),
  ) {
    const days = range === '30d' ? 30 : 7;
    const today = DateTime.fromJSDate(now, { zone: DEFAULT_TZ }).startOf('day');
    const from = today.minus({ days: days - 1 });
    const rows: Array<{
      day: string;
      qty: number;
      kcal: string | null;
      protein_g: string | null;
      carbs_g: string | null;
      fat_g: string | null;
      hidden: boolean | null;
    }> = await this.dataSource.query(
      `SELECT to_char(o.created_at AT TIME ZONE '${DEFAULT_TZ}', 'YYYY-MM-DD') AS day, oi.quantity AS qty,
              n.kcal, n.protein_g, n.carbs_g, n.fat_g, n.hidden
         FROM food_orders o JOIN food_order_items oi ON oi.order_id = o.id
         LEFT JOIN menu_item_nutrition n ON n.menu_item_id = oi.item_id
        WHERE o.user_id = $1 AND o.status IN ('delivered', 'picked_up') AND o.created_at >= $2`,
      [user.id, from.toJSDate()],
    );
    const byDay = new Map<
      string,
      {
        kcal: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
        items: number;
        withNutrition: number;
      }
    >();
    for (let i = 0; i < days; i++)
      byDay.set(from.plus({ days: i }).toISODate()!, {
        kcal: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        items: 0,
        withNutrition: 0,
      });
    for (const r of rows) {
      const d = byDay.get(r.day);
      if (!d) continue;
      d.items += r.qty;
      if (r.kcal === null || r.hidden) continue;
      d.withNutrition += r.qty;
      d.kcal += r.qty * Number(r.kcal);
      d.proteinG += r.qty * Number(r.protein_g);
      d.carbsG += r.qty * Number(r.carbs_g);
      d.fatG += r.qty * Number(r.fat_g);
    }
    const profile = await this.mine(user);
    const list = [...byDay.entries()].map(([date, d]) => ({
      date,
      kcal: Math.round(d.kcal),
      proteinG: Math.round(d.proteinG * 10) / 10,
      carbsG: Math.round(d.carbsG * 10) / 10,
      fatG: Math.round(d.fatG * 10) / 10,
      items: d.items,
      itemsWithNutrition: d.withNutrition,
    }));
    const items = list.reduce((s, d) => s + d.items, 0);
    const known = list.reduce((s, d) => s + d.itemsWithNutrition, 0);
    return {
      range,
      days: list,
      totals: {
        kcal: list.reduce((s, d) => s + d.kcal, 0),
        proteinG:
          Math.round(list.reduce((s, d) => s + d.proteinG, 0) * 10) / 10,
      },
      coverage: items ? Math.round((known / items) * 100) / 100 : null,
      targetKcal: profile?.targetKcal ?? null,
      label:
        'Estimated, from food you ordered on MetroMatrix only — not everything you ate.',
    };
  }
}
