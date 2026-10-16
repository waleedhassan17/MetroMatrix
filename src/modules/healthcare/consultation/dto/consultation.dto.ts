import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class NoteFileDto {
  @ApiProperty({
    description: 'secure_url of an upload signed for purpose medical_note.',
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

export class NotesDto {
  @ApiProperty({
    example: 'Moderate acne, comedonal. Started topical retinoid.',
  })
  @Trim()
  @IsString()
  @MaxLength(10_000)
  text!: string;

  @ApiPropertyOptional({ type: [NoteFileDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => NoteFileDto)
  files?: NoteFileDto[];
}

export class PatientQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Name or phone.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class InsightsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  range?: '7d' | '30d' | '90d';
}
