import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { TextToSpeech } from '../../ai/providers/speech';
import { VoiceAnnounceQueryDto } from '../../ai/voice/dto/voice.dto';
import { announcementText, AnnounceOrder } from './announce';

@ApiTags('ai')
@FoodVendor()
@Controller('ai')
export class AnnounceController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tts: TextToSpeech,
  ) {}

  @Get('announce')
  @ApiOperation({
    summary:
      'The new-order announcement for one of your orders: { text } in Urdu (default), Roman Urdu or English for the device voice; ttsUrl (an audio data: URL) only when TTS_PROVIDER=google.',
  })
  async announce(
    @CurrentVendor() v: VendorRef,
    @Query() q: VoiceAnnounceQueryDto,
  ) {
    const [o] = await this.dataSource.query(
      `SELECT o.id, o.code, o.fulfilment, o.scheduled_for, o.payment_method, o.total,
              json_agg(json_build_object('name', i.item_name, 'nameUr', mi.name_ur,
                'quantity', i.quantity, 'variant', i.variant_name) ORDER BY i.created_at) AS items
         FROM food_orders o JOIN food_order_items i ON i.order_id = o.id
         LEFT JOIN menu_items mi ON mi.id = i.item_id
        WHERE o.id = $1 AND o.branch_id = $2 GROUP BY o.id`,
      [q.orderId, v.branchId],
    );
    if (!o)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Order not found.',
      });
    const lang = q.lang ?? 'ur';
    const order: AnnounceOrder = {
      code: o.code,
      fulfilment: o.fulfilment,
      scheduledFor: o.scheduled_for,
      paymentMethod: o.payment_method,
      total: o.total,
      items: o.items,
    };
    const text = announcementText(order, lang);
    let ttsUrl: string | null = null;
    if (this.tts.enabled) {
      const audio = await this.tts.synthesize(
        text,
        lang === 'en' ? 'en' : 'ur',
      );
      if (audio)
        ttsUrl = `data:${audio.mimeType};base64,${audio.audio.toString('base64')}`;
    }
    return { orderId: o.id, code: o.code, lang, text, ttsUrl };
  }
}
