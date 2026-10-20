import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DateTime } from 'luxon';
import { ErrorCode } from '../../common/errors/codes';
import { DEFAULT_TZ } from '../../common/time/time.util';
import { VoiceContexts } from '../ai/voice/voice-contexts';
import { PANTRY_UNITS } from './entities/pantry-item.entity';
import { PantryService } from './pantry.service';

/** "Ek litre doodh, teen din mein expire" → a pantry line to confirm. */
@Injectable()
export class MyKitchenVoiceContexts implements OnModuleInit {
  constructor(
    private readonly contexts: VoiceContexts,
    private readonly pantry: PantryService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.contexts.register({
      context: 'pantry',
      hint: 'Say what you put away, like “ek litre doodh, teen din mein expire”.',
      authorize: async (user) => {
        if (user.role !== 'customer')
          throw new ForbiddenException({
            code: ErrorCode.FORBIDDEN,
            message: 'My Kitchen is for customers.',
          });
        return {
          actor: { userId: user.id, businessId: null },
          scope: null,
          vocabulary: [],
        };
      },
      resolve: async (i) => {
        const lines = i.slots.lines ?? [];
        if (!lines.length)
          return { proposedAction: null, note: 'What did you put away?' };
        const today = DateTime.now().setZone(DEFAULT_TZ);
        const items = [];
        for (const l of lines.slice(0, 30)) {
          const canonical = await this.pantry.canonicalOf(
            this.dataSource.manager,
            l.name,
          );
          const unit = (PANTRY_UNITS as readonly string[]).includes(
            l.unit ?? '',
          )
            ? (l.unit as string)
            : 'piece';
          items.push({
            name: canonical ?? l.name,
            qty: l.qty ?? 1,
            unit,
            expiresOn:
              l.expiresInDays !== undefined
                ? today.plus({ days: l.expiresInDays }).toISODate()
                : null,
          });
        }
        return {
          proposedAction: {
            method: 'POST',
            path: '/my-kitchen/pantry/batch',
            body: { items },
            summary: `Add ${items.map((x) => `${x.qty} ${x.unit} ${x.name}`).join(', ')} to your pantry`,
          },
          draft: items,
        };
      },
    });
  }
}
