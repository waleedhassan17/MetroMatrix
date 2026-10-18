import { Injectable, OnModuleInit } from '@nestjs/common';
import { VoiceContexts } from '../../ai/voice/voice-contexts';
import { KitchenVendors } from '../common/kitchen-vendors.service';

/** Customers speak a search on the Food Court ("mujhe biryani chahiye"). */
@Injectable()
export class CustomerVoiceContexts implements OnModuleInit {
  constructor(
    private readonly vendors: KitchenVendors,
    private readonly contexts: VoiceContexts,
  ) {}

  onModuleInit(): void {
    this.contexts.register({
      context: 'food_search',
      hint: "Say what you'd like to eat, like “biryani” or “kuch meetha”.",
      authorize: async (user) => {
        this.vendors.assertCustomer(user);
        return {
          actor: { userId: user.id, businessId: null },
          scope: null,
          vocabulary: [],
        };
      },
      resolve: async (i) => {
        const q = (i.slots.query ?? i.slots.dish ?? '').slice(0, 80);
        return q
          ? {
              proposedAction: {
                method: 'GET',
                path: `/food/search?q=${encodeURIComponent(q)}`,
                summary: `Search the Food Court for “${q}” (add your lat & lng)`,
              },
            }
          : { proposedAction: null };
      },
    });
  }
}
