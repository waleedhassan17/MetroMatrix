import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import { RECORD_TYPES, RecordType } from '../entities/health-record.entity';

export class RecordFileDto {
  @ApiProperty({
    description: 'secure_url of an upload signed for purpose health_record.',
  })
  @IsString()
  @MaxLength(500)
  url!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  publicId!: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  mime?: string;
}

export class CreateRecordDto {
  @ApiProperty({ example: 'CBC — March 2026' })
  @Trim()
  @IsString()
  @Length(2, 120)
  title!: string;

  @ApiProperty({ enum: RECORD_TYPES })
  @IsIn(RECORD_TYPES)
  type!: RecordType;

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

  @ApiProperty({ type: [RecordFileDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RecordFileDto)
  files!: RecordFileDto[];
}

export class UpdateRecordDto {
  @ApiPropertyOptional({
    type: [RecordFileDto],
    description: 'Replaces the files.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RecordFileDto)
  files?: RecordFileDto[];

  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 120)
  title?: string;

  @ApiPropertyOptional({ enum: RECORD_TYPES })
  @IsOptional()
  @IsIn(RECORD_TYPES)
  type?: RecordType;

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

  @ApiPropertyOptional({ enum: RECORD_TYPES })
  @IsOptional()
  @IsIn(RECORD_TYPES)
  type?: RecordType;
}

export class AttachRecordsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  recordIds!: string[];
}
