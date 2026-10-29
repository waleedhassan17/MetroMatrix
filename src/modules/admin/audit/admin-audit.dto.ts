import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/validation/transforms';

export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Who did it.' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({
    example: 'business.*',
    description: 'An action, or a prefix ending in * (business.*).',
  })
  @IsOptional()
  @Trim()
  @Matches(/^[a-z_.]+\*?$/, {
    message: 'action is a dotted verb, optionally ending in *',
  })
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ example: 'business' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(64)
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'At or after.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Before.' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

class AuditActorView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
  @ApiProperty() role!: string;
}

export class AuditEventView {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'business.approve' }) action!: string;
  @ApiProperty({ example: 'business' }) targetType!: string;
  @ApiProperty({ nullable: true, type: String }) targetId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorUserId!: string | null;
  @ApiProperty({ type: AuditActorView, nullable: true })
  actor!: AuditActorView | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  details!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  before!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  after!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) ip!: string | null;
  @ApiProperty({ nullable: true, type: String }) userAgent!: string | null;
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}
