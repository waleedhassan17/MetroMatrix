import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ArrayMaxSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { VOICE_CONTEXTS, VoiceContext } from '../voice.types';

export const VOICE_MAX_SECONDS = 30;

export class VoiceCommandDto {
  @ApiProperty({
    enum: VOICE_CONTEXTS,
    description: 'The screen the mic was pressed on.',
  })
  @IsIn(VOICE_CONTEXTS)
  context!: VoiceContext;

  @ApiPropertyOptional({
    description:
      'A `voice_audio` upload from POST /media/sign-upload (m4a/aac/webm/ogg/mp3/wav, ≤ 1 MB). Give this or `text`.',
  })
  @ValidateIf((o: VoiceCommandDto) => o.text === undefined)
  @IsString()
  @MaxLength(500)
  audioUrl?: string;

  @ApiPropertyOptional({
    description: 'Cloudinary public_id from the upload response.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  publicId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: VOICE_MAX_SECONDS,
    description:
      'Length of the recording as the app measured it. Over 30 s is 400 VOICE_TOO_LONG.',
  })
  @ValidateIf((o: VoiceCommandDto) => o.audioUrl !== undefined)
  @IsNumber()
  @Min(0)
  @Max(3600)
  durationSeconds?: number;

  @ApiPropertyOptional({
    description:
      'A typed command instead of a recording (same reading, no audio).',
  })
  @ValidateIf((o: VoiceCommandDto) => o.audioUrl === undefined)
  @Trim()
  @IsString()
  @Length(1, 300)
  text?: string;

  @ApiPropertyOptional({ enum: ['ur', 'en', 'auto'], default: 'auto' })
  @IsOptional()
  @IsIn(['ur', 'en', 'auto'])
  languageHint?: 'ur' | 'en' | 'auto';
}

export class VoiceAnnounceQueryDto {
  @ApiProperty() @IsString() @Length(36, 36) orderId!: string;

  @ApiPropertyOptional({ enum: ['ur', 'roman', 'en'], default: 'ur' })
  @IsOptional()
  @IsIn(['ur', 'roman', 'en'])
  lang?: 'ur' | 'roman' | 'en';
}

// ---- The model's answer (checked before anything is used) ----

class VoiceLineAnswer {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) qty?: number;
  @IsOptional() @IsString() @MaxLength(12) unit?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) totalPrice?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) expiresInDays?: number;
}

class VoiceSlotsAnswer {
  @IsOptional() @IsString() @MaxLength(12) orderCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(240) etaMinutes?: number;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsString() @MaxLength(120) dish?: string;
  @IsOptional() @IsInt() @Min(0) @Max(5000) count?: number;
  @IsOptional() @IsBoolean() on?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(360) minutes?: number;
  @IsOptional() @IsString() @MaxLength(120) query?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VoiceLineAnswer)
  lines?: VoiceLineAnswer[];
}

export class VoiceAnswerDto {
  /** Empty when the model only read text we gave it. */
  @IsOptional() @IsString() @MaxLength(600) transcript?: string;
  @IsIn(['ur', 'en', 'mixed', 'unknown']) language!:
    'ur' | 'en' | 'mixed' | 'unknown';
  @IsString() @Length(2, 40) intent!: string;

  @ValidateNested()
  @Type(() => VoiceSlotsAnswer)
  slots!: VoiceSlotsAnswer;

  @IsNumber() @Min(0) @Max(1) confidence!: number;
}
