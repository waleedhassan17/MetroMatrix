import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { RECORD_KINDS, RecordKind } from '../entities/health-record.entity';

export class CreateRecordDto {
  @ApiProperty({ example: 'CBC — March 2026' })
  @Trim()
  @IsString()
  @Length(2, 120)
  title!: string;

  @ApiProperty({ enum: RECORD_KINDS })
  @IsIn(RECORD_KINDS)
  kind!: RecordKind;

  @ApiPropertyOptional({ example: '2026-03-14' })
  @IsOptional()
  @IsISO8601({ strict: true })
  recordDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Whose record; omit for yourself.' })
  @IsOptional()
  @IsUUID()
  familyMemberId?: string;

  @ApiProperty({
    description: 'secure_url of an upload signed for purpose health_record.',
  })
  @IsString()
  @MaxLength(500)
  fileUrl!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  filePublicId!: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  mime?: string;
}

export class UpdateRecordDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 120)
  title?: string;

  @ApiPropertyOptional({ enum: RECORD_KINDS })
  @IsOptional()
  @IsIn(RECORD_KINDS)
  kind?: RecordKind;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  recordDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class RecordQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "'self' or a family member id" })
  @IsOptional()
  @ValidateIf((_, v) => v !== 'self')
  @IsUUID()
  person?: string;

  @ApiPropertyOptional({ enum: RECORD_KINDS })
  @IsOptional()
  @IsIn(RECORD_KINDS)
  kind?: RecordKind;
}

export class AttachRecordsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  recordIds!: string[];
}
