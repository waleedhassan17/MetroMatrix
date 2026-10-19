import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FoodVendor } from '../../food/common/food-roles.decorator';
import { CurrentVendor } from '../../food/common/current-vendor.decorator';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { KitchenStoryDto } from './dto/story.dto';
import { StoryService } from './story.service';

/** The kitchen story and hygiene checklist — the vendor side (Chunk 5, P7). */
@ApiTags('growth · story')
@FoodVendor()
@Controller('food/vendor/story')
export class VendorStoryController {
  constructor(private readonly stories: StoryService) {}

  @Get()
  get(@CurrentVendor() v: VendorRef) {
    return this.stories.get(v);
  }

  @Put()
  @ApiOperation({
    summary:
      '{ story?, cookName?, videoUrl? (kitchen_video upload), photos? (≤ 6 kitchen_story uploads), hygieneChecklist?: { gloves, hairnet, cleanWater, separateBoards, fridgeTempLog, pestControlOn } } — a complete checklist shows "Hygiene self-declared"; only staff verify.',
  })
  put(@CurrentVendor() v: VendorRef, @Body() dto: KitchenStoryDto) {
    return this.stories.put(v, dto);
  }
}
