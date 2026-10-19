import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { MenuCategory } from './entities/menu-category.entity';
import { EVERY_DAY_MASK, MenuItem } from './entities/menu-item.entity';
import { ItemVariant } from './entities/item-variant.entity';
import { OptionGroup } from './entities/option-group.entity';
import { MenuOption } from './entities/menu-option.entity';
import { ItemOptionGroup } from './entities/item-option-group.entity';
import {
  CategoryDto,
  ItemDto,
  ItemGroupLinkDto,
  OptionGroupDto,
  UpdateCategoryDto,
  UpdateItemDto,
  VariantDto,
} from './dto/menu.dto';
import { daysOf, maskOf } from './item-pricing';
import type { VendorRef } from '../vendor/food-vendor.service';
import { VendorSetupService } from '../vendor/vendor-setup.service';
import { PlanService } from '../../plans/plans.service';
import { MediaService } from '../../media/media.service';
import { ErrorCode } from '../../../common/errors/codes';
import { parallel } from '../../../common/db/parallel';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCode.NOT_FOUND,
    message: `${what} not found.`,
  });

const invalid = (field: string, message: string) =>
  new BadRequestException({
    code: ErrorCode.VALIDATION_FAILED,
    message,
    details: { fields: { [field]: [message] } },
  });

/**
 * The vendor's menu: categories, items (with variants), reusable option
 * groups and which items offer them. Everything is scoped by the vendor's
 * brand — another vendor's rows are 404. Item counts are plan-limited.
 */
@Injectable()
export class MenuService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly plans: PlanService,
    private readonly media: MediaService,
    private readonly setup: VendorSetupService,
  ) {}

  onModuleInit(): void {
    this.plans.registerCounter(
      'menu_items',
      async (m, businessId) =>
        (
          await m.query(
            `SELECT count(*)::int AS n FROM menu_items i JOIN food_brands fb ON fb.id = i.brand_id WHERE fb.business_id = $1`,
            [businessId],
          )
        )[0].n,
    );
    this.setup.register({
      key: 'menu',
      label: 'At least one dish on the menu',
      done: async (m, v) =>
        !!(
          await m.query(
            `SELECT 1 FROM menu_items i JOIN menu_categories c ON c.id = i.category_id
            WHERE i.brand_id = $1 AND i.is_active AND c.is_active LIMIT 1`,
            [v.brandId],
          )
        )[0],
    });
  }

  // ── Categories ───────────────────────────────────────────────────────────

  private categoryView(c: MenuCategory, itemCount?: number) {
    return {
      id: c.id,
      name: c.name,
      sort: c.sort,
      availableFrom: c.availableFrom?.slice(0, 5) ?? null,
      availableTo: c.availableTo?.slice(0, 5) ?? null,
      isActive: c.isActive,
      ...(itemCount !== undefined ? { itemCount } : {}),
    };
  }

  async categories(v: VendorRef) {
    const rows = await this.dataSource.manager.find(MenuCategory, {
      where: { brandId: v.brandId },
      order: { sort: 'ASC', name: 'ASC' },
    });
    const counts: Array<{ category_id: string; n: number }> =
      await this.dataSource.query(
        `SELECT category_id, count(*)::int AS n FROM menu_items WHERE brand_id = $1 GROUP BY 1`,
        [v.brandId],
      );
    return rows.map((c) =>
      this.categoryView(c, counts.find((x) => x.category_id === c.id)?.n ?? 0),
    );
  }

  private windowOk(
    from: string | null | undefined,
    to: string | null | undefined,
  ) {
    if ((from == null) !== (to == null))
      throw invalid(
        'availableFrom',
        'Send both availableFrom and availableTo, or neither.',
      );
    if (from && from === to)
      throw invalid('availableTo', 'The window must have a length.');
  }

  async createCategory(v: VendorRef, dto: CategoryDto) {
    this.windowOk(dto.availableFrom, dto.availableTo);
    const [{ next }] = await this.dataSource.query(
      `SELECT coalesce(max(sort), 0) + 10 AS next FROM menu_categories WHERE brand_id = $1`,
      [v.brandId],
    );
    const c = await this.dataSource.manager.save(
      this.dataSource.manager.create(MenuCategory, {
        brandId: v.brandId,
        name: dto.name,
        sort: next,
        availableFrom: dto.availableFrom ?? null,
        availableTo: dto.availableTo ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
    return this.categoryView(c, 0);
  }

  private async ownedCategory(m: EntityManager, v: VendorRef, id: string) {
    const c = await m.findOne(MenuCategory, {
      where: { id, brandId: v.brandId },
    });
    if (!c) throw notFound('Category');
    return c;
  }

  async updateCategory(v: VendorRef, id: string, dto: UpdateCategoryDto) {
    const c = await this.ownedCategory(this.dataSource.manager, v, id);
    const from =
      dto.availableFrom !== undefined ? dto.availableFrom : c.availableFrom;
    const to = dto.availableTo !== undefined ? dto.availableTo : c.availableTo;
    this.windowOk(from, to);
    Object.assign(c, {
      name: dto.name ?? c.name,
      availableFrom: from,
      availableTo: to,
      isActive: dto.isActive ?? c.isActive,
    });
    return this.categoryView(await this.dataSource.manager.save(c));
  }

  async removeCategory(v: VendorRef, id: string) {
    await this.ownedCategory(this.dataSource.manager, v, id);
    const [{ n }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM menu_items WHERE category_id = $1`,
      [id],
    );
    if (n) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'Move or delete this category’s items first.',
        details: { items: n },
      });
    }
    await this.dataSource.manager.delete(MenuCategory, {
      id,
      brandId: v.brandId,
    });
    return { removed: true };
  }

  /** The categories (or a category's items) in a new order. Unknown ids are 404. */
  async reorder(v: VendorRef, kind: 'categories' | 'items', ids: string[]) {
    const table = kind === 'categories' ? 'menu_categories' : 'menu_items';
    await this.dataSource.transaction(async (m) => {
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE brand_id = $1 AND id = ANY($2::uuid[])`,
        [v.brandId, ids],
      );
      if (n !== new Set(ids).size)
        throw notFound(kind === 'categories' ? 'Category' : 'Item');
      for (const [i, id] of ids.entries()) {
        await m.query(
          `UPDATE ${table} SET sort = $3, updated_at = now() WHERE id = $1 AND brand_id = $2`,
          [id, v.brandId, (i + 1) * 10],
        );
      }
    });
    return kind === 'categories' ? this.categories(v) : this.items(v, {});
  }

  // ── Items ────────────────────────────────────────────────────────────────

  private async itemViews(m: EntityManager, rows: MenuItem[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [variants, links] = await parallel(m, [
      () =>
        m.find(ItemVariant, {
          where: { itemId: In(ids) },
          order: { sort: 'ASC', price: 'ASC' },
        }),
      () =>
        m.find(ItemOptionGroup, {
          where: { itemId: In(ids) },
          order: { sort: 'ASC' },
        }),
    ]);
    return rows.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      nameUr: i.nameUr,
      description: i.description,
      descriptionUr: i.descriptionUr,
      photoUrl: i.photoUrl,
      basePrice: i.basePrice,
      tags: i.tags,
      isDeal: i.isDeal,
      serves: i.serves,
      days: daysOf(i.daysMask),
      isActive: i.isActive,
      sort: i.sort,
      sold30d: i.sold30d,
      variants: variants
        .filter((x) => x.itemId === i.id)
        .map((x) => ({ id: x.id, name: x.name, price: x.price })),
      optionGroups: links
        .filter((l) => l.itemId === i.id)
        .map((l) => ({
          groupId: l.groupId,
          variantId: l.variantId,
          sort: l.sort,
        })),
    }));
  }

  async items(v: VendorRef, q: { categoryId?: string }) {
    const rows = await this.dataSource.manager.find(MenuItem, {
      where: {
        brandId: v.brandId,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      },
      order: { sort: 'ASC', name: 'ASC' },
    });
    return this.itemViews(this.dataSource.manager, rows);
  }

  private async ownedItem(m: EntityManager, v: VendorRef, id: string) {
    const i = await m.findOne(MenuItem, { where: { id, brandId: v.brandId } });
    if (!i) throw notFound('Item');
    return i;
  }

  async item(v: VendorRef, id: string) {
    return (
      await this.itemViews(this.dataSource.manager, [
        await this.ownedItem(this.dataSource.manager, v, id),
      ])
    )[0];
  }

  private photo(
    v: VendorRef,
    url: string | null | undefined,
    current: string | null = null,
  ) {
    if (url && url !== current)
      this.media.assertOwnedAsset(
        v.ownerUserId,
        'menu_item',
        url,
        undefined,
        'photoUrl',
      );
  }

  private async writeVariants(
    m: EntityManager,
    itemId: string,
    variants: VariantDto[],
  ) {
    const keep = variants.filter((x) => x.id).map((x) => x.id!);
    const existing = await m.find(ItemVariant, { where: { itemId } });
    if (keep.some((id) => !existing.some((e) => e.id === id)))
      throw notFound('Variant');
    const drop = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id);
    if (drop.length) await m.delete(ItemVariant, { id: In(drop) });
    for (const [i, x] of variants.entries()) {
      if (x.id)
        await m.update(
          ItemVariant,
          { id: x.id },
          { name: x.name, price: x.price, sort: i },
        );
      else
        await m.insert(ItemVariant, {
          itemId,
          name: x.name,
          price: x.price,
          sort: i,
        });
    }
  }

  async createItem(v: VendorRef, dto: ItemDto) {
    this.photo(v, dto.photoUrl);
    const id = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `menu:${v.brandId}`,
      ]);
      const [{ n }] = await m.query(
        `SELECT count(*)::int AS n FROM menu_items WHERE brand_id = $1`,
        [v.brandId],
      );
      await this.plans.assertWithin(m, v.businessId, 'menu_items', n + 1);
      await this.ownedCategory(m, v, dto.categoryId);
      const [{ next }] = await m.query(
        `SELECT coalesce(max(sort), 0) + 10 AS next FROM menu_items WHERE category_id = $1`,
        [dto.categoryId],
      );
      const item = await m.save(
        m.create(MenuItem, {
          brandId: v.brandId,
          categoryId: dto.categoryId,
          name: dto.name,
          nameUr: dto.nameUr ?? null,
          description: dto.description ?? null,
          descriptionUr: dto.descriptionUr ?? null,
          photoUrl: dto.photoUrl ?? null,
          basePrice: dto.basePrice,
          tags: [...new Set(dto.tags ?? [])],
          isDeal: dto.isDeal ?? false,
          serves: dto.serves ?? null,
          daysMask: dto.days ? maskOf(dto.days) : EVERY_DAY_MASK,
          isActive: dto.isActive ?? true,
          sort: next,
        }),
      );
      if (dto.variants?.length)
        await this.writeVariants(m, item.id, dto.variants);
      return item.id;
    });
    await this.dataSource.query(`SELECT food_item_search_refresh($1)`, [id]);
    await this.dataSource.query(`SELECT food_brand_search_refresh($1)`, [
      v.brandId,
    ]);
    return this.item(v, id);
  }

  async updateItem(v: VendorRef, id: string, dto: UpdateItemDto) {
    await this.dataSource.transaction(async (m) => {
      const i = await this.ownedItem(m, v, id);
      if (dto.categoryId && dto.categoryId !== i.categoryId)
        await this.ownedCategory(m, v, dto.categoryId);
      if (dto.photoUrl !== undefined) this.photo(v, dto.photoUrl, i.photoUrl);
      await m.update(
        MenuItem,
        { id },
        {
          categoryId: dto.categoryId ?? i.categoryId,
          name: dto.name ?? i.name,
          nameUr: dto.nameUr !== undefined ? dto.nameUr : i.nameUr,
          description:
            dto.description !== undefined ? dto.description : i.description,
          descriptionUr:
            dto.descriptionUr !== undefined
              ? dto.descriptionUr
              : i.descriptionUr,
          photoUrl: dto.photoUrl !== undefined ? dto.photoUrl : i.photoUrl,
          basePrice: dto.basePrice ?? i.basePrice,
          tags: dto.tags ? [...new Set(dto.tags)] : i.tags,
          isDeal: dto.isDeal ?? i.isDeal,
          serves: dto.serves !== undefined ? dto.serves : i.serves,
          daysMask: dto.days ? maskOf(dto.days) : i.daysMask,
          isActive: dto.isActive ?? i.isActive,
        },
      );
    });
    await this.dataSource.query(`SELECT food_item_search_refresh($1)`, [id]);
    await this.dataSource.query(`SELECT food_brand_search_refresh($1)`, [
      v.brandId,
    ]);
    return this.item(v, id);
  }

  /** Orders keep their own snapshot, so an item can always be deleted. */
  async removeItem(v: VendorRef, id: string) {
    await this.ownedItem(this.dataSource.manager, v, id);
    await this.dataSource.manager.delete(MenuItem, { id, brandId: v.brandId });
    await this.dataSource.query(`SELECT food_brand_search_refresh($1)`, [
      v.brandId,
    ]);
    return { removed: true };
  }

  /** A copy (inactive, "(copy)") with the same variants and option groups. */
  async duplicateItem(v: VendorRef, id: string) {
    const original = await this.item(v, id);
    const copy = await this.createItem(v, {
      categoryId: original.categoryId,
      name: `${original.name} (copy)`.slice(0, 120),
      nameUr: original.nameUr ?? undefined,
      description: original.description ?? undefined,
      descriptionUr: original.descriptionUr ?? undefined,
      photoUrl: undefined,
      basePrice: original.basePrice,
      tags: original.tags,
      isDeal: original.isDeal,
      serves: original.serves,
      days: original.days,
      isActive: false,
      variants: original.variants.map((x) => ({
        name: x.name,
        price: x.price,
      })),
    });
    await this.dataSource.manager.update(
      MenuItem,
      { id: copy.id },
      { photoUrl: original.photoUrl },
    );
    const variantMap = new Map(
      original.variants.map((x, i) => [x.id, copy.variants[i]?.id]),
    );
    await this.linkGroups(
      v,
      copy.id,
      original.optionGroups.map((l) => ({
        groupId: l.groupId,
        variantId: l.variantId ? variantMap.get(l.variantId) : undefined,
      })),
    );
    return this.item(v, copy.id);
  }

  async replaceVariants(v: VendorRef, id: string, variants: VariantDto[]) {
    await this.dataSource.transaction(async (m) => {
      await this.ownedItem(m, v, id);
      await this.writeVariants(m, id, variants);
    });
    return this.item(v, id);
  }

  // ── Option groups ────────────────────────────────────────────────────────

  private async groupViews(m: EntityManager, groups: OptionGroup[]) {
    if (!groups.length) return [];
    const options = await m.find(MenuOption, {
      where: { groupId: In(groups.map((g) => g.id)) },
      order: { sort: 'ASC', name: 'ASC' },
    });
    const used: Array<{ group_id: string; n: number }> = await m.query(
      `SELECT group_id, count(DISTINCT item_id)::int AS n FROM item_option_groups WHERE group_id = ANY($1::uuid[]) GROUP BY 1`,
      [groups.map((g) => g.id)],
    );
    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      required: g.minSelect >= 1,
      usedByItems: used.find((u) => u.group_id === g.id)?.n ?? 0,
      options: options
        .filter((o) => o.groupId === g.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: o.priceDelta,
          isDefault: o.isDefault,
          isActive: o.isActive,
        })),
    }));
  }

  async groups(v: VendorRef) {
    const rows = await this.dataSource.manager.find(OptionGroup, {
      where: { brandId: v.brandId },
      order: { name: 'ASC' },
    });
    return this.groupViews(this.dataSource.manager, rows);
  }

  private groupRules(dto: OptionGroupDto) {
    if (dto.minSelect > dto.maxSelect)
      throw invalid('minSelect', 'minSelect can’t be more than maxSelect.');
    if (dto.maxSelect > dto.options.length)
      throw invalid(
        'maxSelect',
        'maxSelect can’t be more than the number of options.',
      );
  }

  private async writeOptions(
    m: EntityManager,
    groupId: string,
    options: OptionGroupDto['options'],
  ) {
    const keep = options.filter((o) => o.id).map((o) => o.id!);
    const existing = await m.find(MenuOption, { where: { groupId } });
    if (keep.some((id) => !existing.some((e) => e.id === id)))
      throw notFound('Option');
    const drop = existing.filter((e) => !keep.includes(e.id)).map((e) => e.id);
    if (drop.length) await m.delete(MenuOption, { id: In(drop) });
    for (const [i, o] of options.entries()) {
      const fields = {
        name: o.name,
        priceDelta: o.priceDelta,
        isDefault: o.isDefault ?? false,
        isActive: o.isActive ?? true,
        sort: i,
      };
      if (o.id) await m.update(MenuOption, { id: o.id }, fields);
      else await m.insert(MenuOption, { groupId, ...fields });
    }
  }

  async createGroup(v: VendorRef, dto: OptionGroupDto) {
    this.groupRules(dto);
    const id = await this.dataSource.transaction(async (m) => {
      const g = await m.save(
        m.create(OptionGroup, {
          brandId: v.brandId,
          name: dto.name,
          minSelect: dto.minSelect,
          maxSelect: dto.maxSelect,
        }),
      );
      await this.writeOptions(m, g.id, dto.options);
      return g.id;
    });
    return this.group(v, id);
  }

  private async ownedGroup(m: EntityManager, v: VendorRef, id: string) {
    const g = await m.findOne(OptionGroup, {
      where: { id, brandId: v.brandId },
    });
    if (!g) throw notFound('Option group');
    return g;
  }

  async group(v: VendorRef, id: string) {
    return (
      await this.groupViews(this.dataSource.manager, [
        await this.ownedGroup(this.dataSource.manager, v, id),
      ])
    )[0];
  }

  /** Replaces the group's rules and options (keep existing ones by id). */
  async updateGroup(v: VendorRef, id: string, dto: OptionGroupDto) {
    this.groupRules(dto);
    await this.dataSource.transaction(async (m) => {
      await this.ownedGroup(m, v, id);
      await m.update(
        OptionGroup,
        { id },
        { name: dto.name, minSelect: dto.minSelect, maxSelect: dto.maxSelect },
      );
      await this.writeOptions(m, id, dto.options);
    });
    return this.group(v, id);
  }

  async removeGroup(v: VendorRef, id: string) {
    await this.ownedGroup(this.dataSource.manager, v, id);
    await this.dataSource.manager.delete(OptionGroup, {
      id,
      brandId: v.brandId,
    });
    return { removed: true };
  }

  /** Which groups an item offers (in order), optionally per variant. Replaces the list. */
  async linkGroups(v: VendorRef, itemId: string, links: ItemGroupLinkDto[]) {
    await this.dataSource.transaction(async (m) => {
      await this.ownedItem(m, v, itemId);
      const groupIds = [...new Set(links.map((l) => l.groupId))];
      if (groupIds.length) {
        const n = await m.count(OptionGroup, {
          where: { id: In(groupIds), brandId: v.brandId },
        });
        if (n !== groupIds.length) throw notFound('Option group');
      }
      const variantIds = [
        ...new Set(
          links.map((l) => l.variantId).filter((x): x is string => !!x),
        ),
      ];
      if (variantIds.length) {
        const n = await m.count(ItemVariant, {
          where: { id: In(variantIds), itemId },
        });
        if (n !== variantIds.length) throw notFound('Variant');
      }
      const seen = new Set<string>();
      for (const l of links) {
        const key = `${l.groupId}|${l.variantId ?? ''}`;
        if (seen.has(key))
          throw invalid('groups', 'Each group can be linked once per variant.');
        seen.add(key);
      }
      await m.delete(ItemOptionGroup, { itemId });
      if (links.length)
        await m.insert(
          ItemOptionGroup,
          links.map((l, i) => ({
            itemId,
            groupId: l.groupId,
            variantId: l.variantId ?? null,
            sort: i,
          })),
        );
    });
    return this.item(v, itemId);
  }
}
