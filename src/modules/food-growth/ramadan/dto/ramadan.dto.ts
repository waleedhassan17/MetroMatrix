import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { CALENDAR_KINDS } from '../../../food/reference/entities/calendar-event.entity';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = { message: 'use HH:mm (24-hour)' };

/** PUT /food/vendor/ramadan — a window is both ends or neither (null clears it). */
export class RamadanSettingsDto {
  @IsBoolean() enabled!: boolean;

  @ApiPropertyOptional({ nullable: true, example: '02:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, hhmm)
  sehriFrom?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '04:45' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, hhmm)
  sehriTo?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '17:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, hhmm)
  iftarFrom?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '21:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, hhmm)
  iftarTo?: string | null;

  @ApiPropertyOptional({
    description:
      'Orders for the iftar window must be placed before it opens (scheduled for iftar time).',
  })
  @IsOptional()
  @IsBoolean()
  iftarPreorderOnly?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

/** POST /admin/food/calendar-events */
export class CalendarEventDto {
  @ApiProperty({ enum: CALENDAR_KINDS })
  @IsIn(CALENDAR_KINDS)
  kind!: (typeof CALENDAR_KINDS)[number];

  @Trim() @IsString() @Length(2, 120) name!: string;

  @ApiProperty({ example: '2027-02-08' })
  @IsISO8601({ strict: true })
  startsOn!: string;

  @ApiProperty({ example: '2027-03-09' })
  @IsISO8601({ strict: true })
  endsOn!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null / omitted = every city.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @Length(2, 80)
  city?: string | null;
}

export class UpdateCalendarEventDto {
  @IsOptional() @IsIn(CALENDAR_KINDS) kind?: (typeof CALENDAR_KINDS)[number];
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsISO8601({ strict: true }) startsOn?: string;
  @IsOptional() @IsISO8601({ strict: true }) endsOn?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @Length(2, 80)
  city?: string | null;
}

export class CalendarEventsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(CALENDAR_KINDS) kind?: (typeof CALENDAR_KINDS)[number];

  @ApiPropertyOptional({
    description: 'Events ending on or after this date (default: all).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional() @Trim() @IsString() @MaxLength(80) city?: string;
}
