import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { bestMatch, normalizeText } from '../../../common/text/fuzzy';
import { VoiceContexts } from '../../ai/voice/voice-contexts';
import type {
  ProposedAction,
  Resolution,
  VoiceContextHandler,
  VoiceIntent,
} from '../../ai/voice/voice.types';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { KitchenVendors } from '../common/kitchen-vendors.service';
import {
  LineResolver,
  ResolvedLine,
  isReady,
} from '../stock/line-resolver.service';

interface Dish {
  id: string;
  name: string;
  nameUr: string | null;
}
interface BoardOrder {
  id: string;
  code: string;
  status: string;
  fulfilment: string;
  summary: string;
}
interface VendorScope {
  v: VendorRef;
  dishes: Dish[];
  orders: BoardOrder[];
}

/** A clear winner: high enough and ahead of the next name. */
const CLEAR = 0.6;
const MARGIN = 0.08;

export function matchDish(
  spoken: string | undefined,
  dishes: Dish[],
): {
  dish: Dish | null;
  candidates: Array<{ id: string; label: string; score: number }>;
} {
  if (!spoken) return { dish: null, candidates: [] };
  const { best, others } = bestMatch(
    spoken,
    dishes.map((d) => ({
      value: d,
      names: [d.name, ...(d.nameUr ? [d.nameUr] : [])],
    })),
  );
  if (!best) return { dish: null, candidates: [] };
  const clear =
    best.score >= CLEAR &&
    (!others.length || best.score - others[0].score >= MARGIN);
  const list = [best, ...others].map((c) => ({
    id: c.value.id,
    label: c.value.name,
    score: Number(c.score.toFixed(2)),
  }));
  return clear
    ? { dish: best.value, candidates: [] }
    : { dish: null, candidates: list };
}

/** The order meant: by (part of) its code, else the only one in a fitting state. */
export function matchOrder(
  code: string | undefined,
  orders: BoardOrder[],
  statuses: string[],
): { order: BoardOrder | null; candidates: BoardOrder[] } {
  const fitting = orders.filter((o) => statuses.includes(o.status));
  const wanted = code
    ? normalizeText(code)
        .replace(/^fc\s*/, '')
        .replace(/\s/g, '')
        .toUpperCase()
    : '';
  if (wanted.length >= 3) {
    const hits = orders.filter((o) =>
      o.code.replace(/^FC-/, '').includes(wanted),
    );
    if (hits.length === 1) return { order: hits[0], candidates: [] };
    if (hits.length > 1) return { order: null, candidates: hits };
  }
  if (fitting.length === 1) return { order: fitting[0], candidates: [] };
  return { order: null, candidates: fitting };
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * The vendor's voice screens: the order board, today's portions, and menu
 * search. Each reading becomes the exact request the app would make — the
 * app calls it only after the person confirms.
 */
@Injectable()
export class KitchenVoiceContexts implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vendors: KitchenVendors,
    private readonly contexts: VoiceContexts,
    private readonly lines: LineResolver,
  ) {}

  onModuleInit(): void {
    this.contexts.register(this.board());
    this.contexts.register(this.today());
    this.contexts.register(this.menuSearch());
    this.contexts.register(this.stockScreen());
    this.contexts.register(this.purchaseScreen());
  }

  private async ingredientScope(u: AuthenticatedUser) {
    const s = await this.scope(u, false);
    const names: Array<{ name: string; name_ur: string | null }> =
      await this.dataSource.query(
        `SELECT name, name_ur FROM kitchen_ingredients WHERE branch_id = $1 AND is_active ORDER BY name`,
        [s.scope.v.branchId],
      );
    return {
      ...s,
      vocabulary: names.flatMap((n) => [
        n.name,
        ...(n.name_ur ? [n.name_ur] : []),
      ]),
    };
  }

  /** add_purchase → a purchase draft; log_waste → one waste entry. Unknown names are flagged, never guessed. */
  private purchaseOrWaste(i: VoiceIntent, lines: ResolvedLine[]): Resolution {
    const fmt = (l: Extract<ResolvedLine, { ingredientId: string }>) =>
      `${l.name} ${l.display ? `${l.display.qty} ${l.display.unit}` : ''}`.trim();
    if (i.intent === 'add_purchase') {
      const ready = lines.filter(isReady);
      const priced = ready.filter((l) => l.totalPrice !== null);
      const all = lines.length > 0 && priced.length === lines.length;
      const total = priced.reduce((s, l) => s + (l.totalPrice ?? 0), 0);
      const body = {
        source: 'voice',
        lines: priced.map((l) => ({
          ingredientId: l.ingredientId,
          qty: l.qty,
          unit: l.unit,
          totalPrice: Math.round(l.totalPrice!),
        })),
      };
      return {
        proposedAction: all
          ? {
              method: 'POST',
              path: '/food/vendor/kitchen/purchases',
              body,
              summary: `Purchase: ${priced.map((l) => `${fmt(l)} Rs ${Math.round(l.totalPrice!).toLocaleString('en-PK')}`).join(', ')} — Rs ${total.toLocaleString('en-PK')}`,
            }
          : null,
        draft: { lines, body },
        ...(all
          ? {}
          : {
              note: lines.some((l) => l.status === 'UNKNOWN_INGREDIENT')
                ? 'Add the new ingredients first, or pick one of the suggestions.'
                : 'Add the price (and check the unit) for each line before saving.',
            }),
      };
    }
    if (i.intent === 'log_waste') {
      const [l] = lines;
      const ok = lines.length === 1 && l && isReady(l);
      return {
        proposedAction: ok
          ? {
              method: 'POST',
              path: '/food/vendor/kitchen/waste',
              body: {
                ingredientId: l.ingredientId,
                qty: l.qty,
                unit: l.unit,
                reason: i.slots.reason ?? 'other',
              },
              summary: `Waste: ${fmt(l)} (${i.slots.reason ?? 'other'})`,
            }
          : null,
        draft: { lines },
        ...(ok
          ? {}
          : {
              note:
                lines.length > 1
                  ? 'Log one item at a time.'
                  : 'Check the name and the amount.',
            }),
      };
    }
    return { proposedAction: null, draft: { lines } };
  }

  private purchaseScreen(): VoiceContextHandler<VendorScope> {
    return {
      context: 'purchase',
      hint: 'Try: “paanch kilo tamatar, baara sau rupay”.',
      authorize: (u) => this.ingredientScope(u),
      resolve: async (i, s) =>
        this.purchaseOrWaste(
          i,
          await this.lines.resolve(s.v.branchId, i.slots.lines),
        ),
    };
  }

  private stockScreen(): VoiceContextHandler<VendorScope> {
    return {
      context: 'stock',
      hint: 'Try: “chawal bees kilo baqi hain” or “do kilo dahi kharab ho gaya”.',
      authorize: (u) => this.ingredientScope(u),
      resolve: async (i, s) => {
        const lines = await this.lines.resolve(s.v.branchId, i.slots.lines);
        if (i.intent === 'count') {
          const ok = lines.filter(isReady);
          return {
            proposedAction:
              ok.length && ok.length === lines.length
                ? {
                    method: 'POST',
                    path: '/food/vendor/kitchen/stock/count',
                    body: {
                      lines: ok.map((l) => ({
                        ingredientId: l.ingredientId,
                        qty: l.qty,
                        unit: l.unit,
                      })),
                    },
                    summary: `Count: ${ok.map((l) => `${l.name} ${l.display!.qty} ${l.display!.unit}`).join(', ')}`,
                  }
                : null,
            draft: { lines },
            ...(ok.length === lines.length
              ? {}
              : { note: 'Some names or units need a look before saving.' }),
          };
        }
        return this.purchaseOrWaste(i, lines);
      },
    };
  }

  private async scope(user: AuthenticatedUser, withOrders: boolean) {
    const v = await this.vendors.forUser(user);
    const dishes: Dish[] = (
      await this.dataSource.query(
        `SELECT id, name, name_ur FROM menu_items WHERE brand_id = $1 ORDER BY sold_30d DESC, name`,
        [v.brandId],
      )
    ).map((r: any) => ({ id: r.id, name: r.name, nameUr: r.name_ur }));
    const orders: BoardOrder[] = withOrders
      ? (
          await this.dataSource.query(
            `SELECT o.id, o.code, o.status, o.fulfilment,
                    string_agg(i.quantity || ' ' || i.item_name, ', ' ORDER BY i.created_at) AS summary
               FROM food_orders o JOIN food_order_items i ON i.order_id = o.id
              WHERE o.branch_id = $1 AND o.status IN ('placed', 'accepted', 'preparing', 'ready')
              GROUP BY o.id ORDER BY o.created_at`,
            [v.branchId],
          )
        ).map((r: any) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          fulfilment: r.fulfilment,
          summary: r.summary,
        }))
      : [];
    const scope: VendorScope = { v, dishes, orders };
    return {
      actor: { userId: user.id, businessId: v.businessId },
      scope,
      vocabulary: [
        ...orders.map((o) => o.code),
        ...dishes.flatMap((d) => [d.name, ...(d.nameUr ? [d.nameUr] : [])]),
      ],
    };
  }

  private board(): VoiceContextHandler<VendorScope> {
    return {
      context: 'board',
      hint: 'Try: “order accept karo, bees minute” or “biryani khatam ho gayi”.',
      authorize: (u) => this.scope(u, true),
      resolve: async (i, s) => this.resolveBoard(i, s),
    };
  }

  private orderAction(
    i: VoiceIntent,
    s: VendorScope,
    statuses: string[],
    build: (o: BoardOrder) => ProposedAction | { note: string },
    none: string,
  ): Resolution {
    const { order, candidates } = matchOrder(
      i.slots.orderCode,
      s.orders,
      statuses,
    );
    if (!order)
      return {
        proposedAction: null,
        candidates: candidates.map((o) => ({
          id: o.id,
          label: `${o.code} · ${o.summary}`,
        })),
        note: candidates.length ? 'Which order?' : none,
      };
    const out = build(order);
    return 'note' in out
      ? { proposedAction: null, note: out.note }
      : { proposedAction: out };
  }

  private resolveBoard(i: VoiceIntent, s: VendorScope): Resolution {
    switch (i.intent) {
      case 'accept':
        return this.orderAction(
          i,
          s,
          ['placed'],
          (o) =>
            o.status !== 'placed'
              ? { note: `${o.code} is already ${o.status.replace('_', ' ')}.` }
              : {
                  method: 'POST',
                  path: `/food/vendor/orders/${o.id}/accept`,
                  body: i.slots.etaMinutes
                    ? { etaMinutes: clamp(i.slots.etaMinutes, 5, 180) }
                    : {},
                  summary: `Accept ${o.code} (${o.summary})${i.slots.etaMinutes ? `, ${clamp(i.slots.etaMinutes, 5, 180)} minutes` : ''}`,
                },
          'No new orders to accept.',
        );
      case 'reject':
        return this.orderAction(
          i,
          s,
          ['placed'],
          (o) =>
            o.status !== 'placed'
              ? { note: `${o.code} was already accepted — cancel it instead.` }
              : {
                  method: 'POST',
                  path: `/food/vendor/orders/${o.id}/reject`,
                  body: {
                    reason: (i.slots.reason && i.slots.reason.length >= 3
                      ? i.slots.reason
                      : 'We can’t take this order right now.'
                    ).slice(0, 300),
                  },
                  summary: `Reject ${o.code} (${o.summary})`,
                },
          'No new orders to reject.',
        );
      case 'mark_ready':
        return this.orderAction(
          i,
          s,
          ['preparing'],
          (o) =>
            o.status === 'preparing'
              ? {
                  method: 'POST',
                  path: `/food/vendor/orders/${o.id}/ready`,
                  summary: `Mark ${o.code} ready (${o.summary})`,
                }
              : o.status === 'accepted'
                ? {
                    method: 'POST',
                    path: `/food/vendor/orders/${o.id}/preparing`,
                    summary: `${o.code} isn’t being prepared yet — start preparing it`,
                  }
                : { note: `${o.code} is ${o.status.replace('_', ' ')}.` },
          'No orders being prepared.',
        );
      case 'mark_unavailable': {
        const { dish, candidates } = matchDish(i.slots.dish, s.dishes);
        if (!dish)
          return {
            proposedAction: null,
            candidates,
            note: candidates.length
              ? 'Which dish?'
              : `No dish called “${i.slots.dish ?? ''}” on your menu.`,
          };
        return {
          proposedAction: {
            method: 'PATCH',
            path: '/food/vendor/availability',
            body: { items: [{ itemId: dish.id, isAvailable: false }] },
            summary: `Mark ${dish.name} sold out`,
          },
        };
      }
      case 'busy': {
        const minutes = clamp(i.slots.minutes ?? 15, 5, 60);
        return {
          proposedAction: {
            method: 'POST',
            path: '/food/vendor/busy',
            body: { extraMinutes: minutes },
            summary: `Busy: add ${minutes} minutes to every ETA for the next hour`,
          },
        };
      }
      default:
        return { proposedAction: null };
    }
  }

  private today(): VoiceContextHandler<VendorScope> {
    return {
      context: 'today',
      hint: 'Try: “aaj biryani ki bees plate” or “aaj chutti hai”.',
      authorize: (u) => this.scope(u, false),
      resolve: async (i, s) => {
        if (i.intent === 'cooking_today' && !i.slots.dish)
          return {
            proposedAction:
              i.slots.on === false
                ? {
                    method: 'POST',
                    path: '/food/vendor/pause',
                    body: { message: 'Not cooking today — back tomorrow.' },
                    summary: 'Pause your kitchen for today',
                  }
                : {
                    method: 'POST',
                    path: '/food/vendor/resume',
                    summary: 'Open your kitchen again',
                  },
          };
        const { dish, candidates } = matchDish(i.slots.dish, s.dishes);
        if (!dish)
          return {
            proposedAction: null,
            candidates,
            note: candidates.length
              ? 'Which dish?'
              : `No dish called “${i.slots.dish ?? ''}” on your menu.`,
          };
        if (i.intent === 'set_portions') {
          const n = clamp(i.slots.count ?? 0, 0, 5000);
          return {
            proposedAction: {
              method: 'PATCH',
              path: '/food/vendor/today',
              body: { items: [{ itemId: dish.id, portions: n }] },
              summary: `${dish.name}: ${n} portions today`,
            },
          };
        }
        if (i.intent === 'cooking_today')
          return {
            proposedAction: {
              method: 'PATCH',
              path: '/food/vendor/today',
              body: {
                items: [{ itemId: dish.id, cooking: i.slots.on !== false }],
              },
              summary: `${dish.name}: ${i.slots.on === false ? 'not cooking today' : 'cooking today'}`,
            },
          };
        return { proposedAction: null };
      },
    };
  }

  private menuSearch(): VoiceContextHandler<VendorScope> {
    return {
      context: 'menu_search',
      hint: 'Say a dish name, like “chicken karahi”.',
      authorize: (u) => this.scope(u, false),
      resolve: async (i, s) => {
        const q = i.slots.query ?? i.slots.dish ?? '';
        const { dish, candidates } = matchDish(q, s.dishes);
        if (dish)
          return {
            proposedAction: {
              method: 'GET',
              path: `/food/vendor/menu/items/${dish.id}`,
              summary: `Open ${dish.name}`,
            },
          };
        return {
          proposedAction: null,
          candidates,
          note: candidates.length
            ? 'Did you mean one of these?'
            : `Nothing on your menu matches “${q}”.`,
        };
      },
    };
  }
}
