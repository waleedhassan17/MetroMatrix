import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../../../common/errors/codes';
import type { VoiceContext, VoiceContextHandler } from './voice.types';

/**
 * Screens that take voice. The module that owns a screen registers its
 * handler in onModuleInit (kitchen: board, today, stock, purchase,
 * menu_search; my-kitchen: pantry, food_search), so ai/ never imports Food.
 */
@Injectable()
export class VoiceContexts {
  private readonly handlers = new Map<VoiceContext, VoiceContextHandler>();

  register(handler: VoiceContextHandler<any>): void {
    this.handlers.set(handler.context, handler);
  }

  get(context: VoiceContext): VoiceContextHandler {
    const h = this.handlers.get(context);
    if (!h)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'That screen does not take voice commands.',
      });
    return h;
  }

  list(): VoiceContext[] {
    return [...this.handlers.keys()];
  }
}
