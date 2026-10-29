import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';
import { currentActor } from '../../../common/context/request-context';
import { returned } from '../../../common/db/parallel';
import { paged } from '../../../common/pagination/pagination';
import { addDays, todayIn } from '../../../common/time/time.util';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { FoodDiscoveryService } from '../../food/discovery/discovery.service';
import { MediaService } from '../../media/media.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  HygieneChecklist,
  KitchenStory,
} from './entities/kitchen-story.entity';
import {
  HygieneQueueQueryDto,
  HygieneVerifyDto,
  KitchenStoryDto,
  SignatureQueueQueryDto,
} from './dto/story.dto';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

/** A pest control older than this no longer completes the checklist. */
const PEST_CONTROL_MAX_DAYS = 365;

const CHECKS = [
  'gloves',
  'hairnet',
  'cleanWater',
  'separateBoards',
  'fridgeTempLog',
] as const;

/** Every box ticked and a pest control date in the last year (not in the future). */
export function checklistComplete(
  c: HygieneChecklist | null,
  today: string,
): boolean {
  if (!c) return false;
  if (!CHECKS.every((k) => c[k] === true)) return false;
  const p = c.pestControlOn;
  return !!p && p <= today && p >= addDays(today, -PEST_CONTROL_MAX_DAYS);
}

const sameChecklist = (
  a: HygieneChecklist | null,
  b: HygieneChecklist | null,
) =>
  !!a &&
  !!b &&
  CHECKS.every((k) => a[k] === b[k]) &&
  (a.pestControlOn ?? null) === (b.pestControlOn ?? null);

export const hygieneBadge = (status: string | null) =>
  status === 'verified'
    ? 'hygiene_verified'
    : status === 'self_declared'
      ? 'hygiene_self_declared'
      : null;

/**
 * The kitchen's story and hygiene badge, and the signature-dish badge
 * customers see. Vendors write the story and tick the checklist ("Hygiene
 * self-declared"); only staff mark it verified after a visit or a video call,
 * and a later change to the checklist drops it back to self-declared. Staff
 * also remove false signature claims. Every staff action is audited and the
 * vendor is told.
 */
@Injectable()
export class StoryService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly discovery: FoodDiscoveryService,
    private readonly media: MediaService,
    private readonly notifications: NotificationsService,
    private readonly audit: OperationalAuditService,
  ) {}

  onModuleInit(): void {
    this.discovery.badgeSources.push((ids) => this.badges(ids));
    this.discovery.vendorExtras.push(async (v) => ({
      story: await this.publicStory(v.brandId),
      signatureDishes: await this.signatureDishes(v.brandId),
    }));
    this.discovery.itemExtras.push(async (itemId) => ({
      signature: await this.itemSignature(itemId),
    }));
  }

  // ── Customer-facing ─────────────────────────────────────────────────

  /** Badges on vendor cards: hygiene (verified / self-declared) and signature dishes. */
  async badges(brandIds: string[]) {
    const out = new Map<string, string[]>();
    const add = (id: string, b: string) =>
      out.set(id, [...(out.get(id) ?? []), b]);
    const [stories, signatures] = await Promise.all([
      this.dataSource.query(
        `SELECT brand_id, hygiene_status FROM kitchen_stories
          WHERE brand_id = ANY($1::uuid[]) AND hygiene_status IS NOT NULL`,
        [brandIds],
      ),
      this.dataSource.query(
        `SELECT DISTINCT mi.brand_id FROM recipe_cards rc JOIN menu_items mi ON mi.id = rc.menu_item_id
          WHERE mi.brand_id = ANY($1::uuid[]) AND mi.is_active AND rc.is_signature`,
        [brandIds],
      ),
    ]);
    for (const s of signatures) add(s.brand_id, 'signature');
    for (const s of stories) add(s.brand_id, hygieneBadge(s.hygiene_status)!);
    return out;
  }

  async publicStory(brandId: string) {
    const s = await this.dataSource
      .getRepository(KitchenStory)
      .findOne({ where: { brandId } });
    if (!s || (!s.story && !s.cookName && !s.photos.length && !s.hygieneStatus))
      return null;
    return {
      story: s.story,
      cookName: s.cookName,
      videoUrl: s.videoUrl,
      photos: s.photos,
      hygiene: s.hygieneStatus
        ? {
            status: s.hygieneStatus,
            badge: hygieneBadge(s.hygieneStatus),
            label:
              s.hygieneStatus === 'verified'
                ? 'Hygiene verified'
                : 'Hygiene self-declared',
            checklist: s.hygieneChecklist,
            verifiedAt: s.verifiedAt,
            verifiedMethod: s.verifiedMethod,
          }
        : null,
    };
  }

  private async signatureDishes(brandId: string) {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT ON (mi.id) mi.id, mi.name, rc.signature_by, to_char(rc.signature_since, 'YYYY-MM-DD') AS since
         FROM recipe_cards rc JOIN menu_items mi ON mi.id = rc.menu_item_id
        WHERE mi.brand_id = $1 AND mi.is_active AND rc.is_signature
        ORDER BY mi.id, rc.variant_id NULLS FIRST`,
      [brandId],
    );
    return rows.map((r: any) => ({
      itemId: r.id,
      name: r.name,
      by: r.signature_by,
      since: r.since,
    }));
  }

  private async itemSignature(itemId: string) {
    const [r] = await this.dataSource.query(
      `SELECT signature_by, to_char(signature_since, 'YYYY-MM-DD') AS since FROM recipe_cards
        WHERE menu_item_id = $1 AND is_signature ORDER BY variant_id NULLS FIRST LIMIT 1`,
      [itemId],
    );
    return r
      ? {
          badge: 'signature',
          label: 'Signature recipe',
          by: r.signature_by,
          since: r.since,
        }
      : null;
  }

  // ── Vendor: GET/PUT /food/vendor/story ──────────────────────────────

  private vendorView(s: KitchenStory | null, today: string) {
    return {
      story: s?.story ?? null,
      cookName: s?.cookName ?? null,
      videoUrl: s?.videoUrl ?? null,
      photos: s?.photos ?? [],
      hygieneChecklist: s?.hygieneChecklist ?? null,
      hygieneStatus: s?.hygieneStatus ?? null,
      badge: hygieneBadge(s?.hygieneStatus ?? null),
      checklistComplete: checklistComplete(s?.hygieneChecklist ?? null, today),
      declaredAt: s?.declaredAt ?? null,
      verifiedAt: s?.verifiedAt ?? null,
      verifiedMethod: s?.verifiedMethod ?? null,
      /** What a complete checklist needs. */
      checklistItems: [...CHECKS, 'pestControlOn'],
    };
  }

  private async tz(v: VendorRef) {
    const [b] = await this.dataSource.query(
      `SELECT timezone FROM branches WHERE id = $1`,
      [v.branchId],
    );
    return b.timezone as string;
  }

  async get(v: VendorRef, now = new Date()) {
    const s = await this.dataSource
      .getRepository(KitchenStory)
      .findOne({ where: { brandId: v.brandId } });
    return this.vendorView(s, todayIn(await this.tz(v), now));
  }

  async put(v: VendorRef, dto: KitchenStoryDto, now = new Date()) {
    const photos = dto.photos ?? [];
    photos.forEach((url, i) =>
      this.media.assertOwnedAsset(
        v.ownerUserId,
        'kitchen_story',
        url,
        undefined,
        `photos.${i}`,
      ),
    );
    if (dto.videoUrl)
      this.media.assertOwnedAsset(
        v.ownerUserId,
        'kitchen_video',
        dto.videoUrl,
        undefined,
        'videoUrl',
      );
    const today = todayIn(await this.tz(v), now);
    const repo = this.dataSource.getRepository(KitchenStory);
    const before = await repo.findOne({ where: { brandId: v.brandId } });
    const checklist: HygieneChecklist | null = dto.hygieneChecklist
      ? {
          gloves: dto.hygieneChecklist.gloves,
          hairnet: dto.hygieneChecklist.hairnet,
          cleanWater: dto.hygieneChecklist.cleanWater,
          separateBoards: dto.hygieneChecklist.separateBoards,
          fridgeTempLog: dto.hygieneChecklist.fridgeTempLog,
          pestControlOn: dto.hygieneChecklist.pestControlOn ?? null,
        }
      : null;
    const complete = checklistComplete(checklist, today);
    const unchanged = sameChecklist(
      before?.hygieneChecklist ?? null,
      checklist,
    );
    // Verified stays only while the checklist is exactly what staff saw.
    const keepVerified =
      complete && unchanged && before?.hygieneStatus === 'verified';
    const hygiene = keepVerified
      ? {}
      : {
          hygieneStatus: complete ? ('self_declared' as const) : null,
          declaredAt: complete
            ? unchanged && before?.declaredAt
              ? before.declaredAt
              : now
            : null,
          verifiedBy: null,
          verifiedAt: null,
          verifiedMethod: null,
          verifiedNote: null,
        };
    const values = {
      story: dto.story ?? null,
      cookName: dto.cookName ?? null,
      videoUrl: dto.videoUrl ?? null,
      photos,
      hygieneChecklist: checklist,
      ...hygiene,
    };
    if (before) await repo.update({ id: before.id }, values);
    else await repo.insert({ brandId: v.brandId, ...values });
    return this.get(v, now);
  }

  // ── Staff: hygiene queue ────────────────────────────────────────────

  async hygieneQueue(q: HygieneQueueQueryDto) {
    const status = q.status ?? 'self_declared';
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM kitchen_stories WHERE hygiene_status = $1`,
      [status],
    );
    const rows = await this.dataSource.query(
      `SELECT ks.brand_id, fb.name, fb.slug, br.city, ks.cook_name, ks.hygiene_checklist, ks.hygiene_status,
              ks.declared_at, ks.verified_at, ks.verified_method, ks.verified_note, ks.photos, ks.video_url,
              b.id AS business_id
         FROM kitchen_stories ks JOIN food_brands fb ON fb.id = ks.brand_id
         JOIN branches br ON br.brand_id = fb.id JOIN businesses b ON b.id = fb.business_id
        WHERE ks.hygiene_status = $1
        ORDER BY ${status === 'verified' ? 'ks.verified_at DESC' : 'ks.declared_at ASC'}, ks.brand_id
        LIMIT $2 OFFSET $3`,
      [status, q.pageSize, (q.page - 1) * q.pageSize],
    );
    return paged(
      rows.map((r: any) => ({
        brandId: r.brand_id,
        businessId: r.business_id,
        name: r.name,
        slug: r.slug,
        city: r.city,
        cookName: r.cook_name,
        checklist: r.hygiene_checklist,
        status: r.hygiene_status,
        declaredAt: r.declared_at,
        verifiedAt: r.verified_at,
        verifiedMethod: r.verified_method,
        verifiedNote: r.verified_note,
        photos: r.photos,
        videoUrl: r.video_url,
      })),
      total,
      q,
    );
  }

  private async storyOf(brandId: string) {
    const s = await this.dataSource
      .getRepository(KitchenStory)
      .findOne({ where: { brandId } });
    if (!s) throw notFound('Kitchen story');
    return s;
  }

  private async ownerOf(brandId: string): Promise<string | null> {
    const [r] = await this.dataSource.query(
      `SELECT b.owner_user_id FROM food_brands fb JOIN businesses b ON b.id = fb.business_id WHERE fb.id = $1`,
      [brandId],
    );
    return r?.owner_user_id ?? null;
  }

  private async tell(brandId: string, title: string, body: string) {
    const owner = await this.ownerOf(brandId);
    if (!owner) return;
    try {
      await this.notifications.notify(owner, {
        type: 'kitchen.story',
        title,
        body,
        data: { screen: 'kitchen.story' },
      });
    } catch {
      /* the change stands */
    }
  }

  async verify(brandId: string, dto: HygieneVerifyDto, now = new Date()) {
    const s = await this.storyOf(brandId);
    if (s.hygieneStatus !== 'self_declared')
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message:
          s.hygieneStatus === 'verified'
            ? 'This kitchen is already verified.'
            : 'The kitchen hasn’t completed its hygiene checklist.',
        details: { from: s.hygieneStatus, to: 'verified' },
      });
    const res = await this.dataSource.query(
      `UPDATE kitchen_stories SET hygiene_status = 'verified', verified_by = $2, verified_at = $3,
              verified_method = $4, verified_note = $5, updated_at = now()
        WHERE id = $1 AND hygiene_status = 'self_declared' RETURNING id`,
      [s.id, currentActor().userId, now, dto.method, dto.note ?? null],
    );
    if (!returned(res).length)
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: 'The checklist changed — reload the queue.',
      });
    await this.audit.record({
      action: 'hygiene.verify',
      targetType: 'food_brand',
      targetId: brandId,
      before: { hygieneStatus: s.hygieneStatus },
      after: {
        hygieneStatus: 'verified',
        verifiedMethod: dto.method,
        verifiedNote: dto.note ?? null,
      },
    });
    await this.tell(
      brandId,
      'Hygiene verified',
      'MetroMatrix staff verified your kitchen’s hygiene — the badge is on your page.',
    );
    return this.adminView(brandId);
  }

  async revoke(brandId: string, reason: string) {
    const s = await this.storyOf(brandId);
    if (s.hygieneStatus !== 'verified')
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: 'This kitchen isn’t verified.',
        details: { from: s.hygieneStatus, to: 'self_declared' },
      });
    await this.dataSource.query(
      `UPDATE kitchen_stories SET hygiene_status = 'self_declared', verified_by = NULL, verified_at = NULL,
              verified_method = NULL, verified_note = $2, updated_at = now()
        WHERE id = $1`,
      [s.id, reason],
    );
    await this.audit.record({
      action: 'hygiene.revoke',
      targetType: 'food_brand',
      targetId: brandId,
      before: { hygieneStatus: 'verified' },
      after: { hygieneStatus: 'self_declared', verifiedNote: reason },
    });
    await this.tell(
      brandId,
      'Hygiene badge back to self-declared',
      `Staff removed the verified badge: ${reason}`,
    );
    return this.adminView(brandId);
  }

  private async adminView(brandId: string) {
    const s = await this.storyOf(brandId);
    return {
      brandId,
      status: s.hygieneStatus,
      checklist: s.hygieneChecklist,
      declaredAt: s.declaredAt,
      verifiedAt: s.verifiedAt,
      verifiedMethod: s.verifiedMethod,
      verifiedNote: s.verifiedNote,
    };
  }

  // ── Staff: signature moderation ─────────────────────────────────────

  async signatures(q: SignatureQueueQueryDto) {
    const removed = q.status === 'removed';
    const where = removed
      ? 'NOT rc.is_signature AND rc.signature_removed_at IS NOT NULL'
      : 'rc.is_signature';
    const [{ total }] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM recipe_cards rc WHERE ${where}`,
    );
    const rows = await this.dataSource.query(
      `SELECT rc.id, rc.menu_item_id, rc.variant_id, mi.name AS item, v.name AS variant, fb.id AS brand_id,
              fb.name AS brand, fb.slug, rc.signature_by, to_char(rc.signature_since, 'YYYY-MM-DD') AS since,
              rc.signature_removed_at, rc.signature_removed_reason, rc.updated_at
         FROM recipe_cards rc JOIN menu_items mi ON mi.id = rc.menu_item_id
         JOIN food_brands fb ON fb.id = mi.brand_id LEFT JOIN item_variants v ON v.id = rc.variant_id
        WHERE ${where}
        ORDER BY ${removed ? 'rc.signature_removed_at' : 'rc.updated_at'} DESC, rc.id
        LIMIT $1 OFFSET $2`,
      [q.pageSize, (q.page - 1) * q.pageSize],
    );
    return paged(
      rows.map((r: any) => ({
        recipeCardId: r.id,
        itemId: r.menu_item_id,
        variantId: r.variant_id,
        item: r.item,
        variant: r.variant,
        brandId: r.brand_id,
        brand: r.brand,
        slug: r.slug,
        by: r.signature_by,
        since: r.since,
        removedAt: r.signature_removed_at,
        removedReason: r.signature_removed_reason,
      })),
      total,
      q,
    );
  }

  async removeSignature(cardId: string, reason: string, now = new Date()) {
    const [row] = await this.dataSource.query(
      `SELECT rc.id, mi.brand_id, mi.name FROM recipe_cards rc JOIN menu_items mi ON mi.id = rc.menu_item_id
        WHERE rc.id = $1`,
      [cardId],
    );
    if (!row) throw notFound('Recipe card');
    const res = await this.dataSource.query(
      `UPDATE recipe_cards SET is_signature = false, signature_removed_at = $2, signature_removed_reason = $3,
              updated_at = now()
        WHERE id = $1 AND is_signature RETURNING id`,
      [cardId, now, reason],
    );
    if (!returned(res).length)
      throw new ConflictException({
        code: ErrorCode.INVALID_TRANSITION,
        message: 'This dish isn’t marked as a signature recipe.',
      });
    await this.audit.record({
      action: 'signature.remove',
      targetType: 'recipe_card',
      targetId: cardId,
      details: { brandId: row.brand_id },
      before: { isSignature: true },
      after: { isSignature: false, signatureRemovedReason: reason },
    });
    await this.tell(
      row.brand_id,
      `Signature badge removed: ${row.name}`,
      `Staff removed the signature recipe badge: ${reason}`,
    );
    return { recipeCardId: cardId, isSignature: false, removedReason: reason };
  }
}
