import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transforms';
import {
  BUSINESS_STATUSES,
  BusinessStatus,
  SERVICE_TYPES,
  ServiceType,
} from '../../businesses/business-types';
import {
  USER_ROLES,
  USER_STATUSES,
  UserRole,
  UserStatus,
} from '../../../types';

export class AdminBusinessQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: BUSINESS_STATUSES })
  @IsOptional()
  @IsIn([...BUSINESS_STATUSES])
  status?: BusinessStatus;

  @ApiPropertyOptional({ enum: SERVICE_TYPES })
  @IsOptional()
  @IsIn([...SERVICE_TYPES])
  serviceType?: ServiceType;

  @ApiPropertyOptional({
    description: 'Matches name, slug, city or owner email.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class AdminUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'true = email confirmed, false = not yet.',
  })
  @IsOptional()
  // From the raw query (`obj`): implicit conversion would turn 'false' into true.
  @Transform(({ obj }) =>
    obj.verified === 'true' || obj.verified === true
      ? true
      : obj.verified === 'false' || obj.verified === false
        ? false
        : obj.verified,
  )
  @IsBoolean()
  verified?: boolean;

  @ApiPropertyOptional({
    enum: SERVICE_TYPES,
    description: 'Partners whose business is in this service.',
  })
  @IsOptional()
  @IsIn([...SERVICE_TYPES])
  service?: ServiceType;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Created at or after.',
  })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Created before.' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsIn([...USER_ROLES])
  role?: UserRole;

  @ApiPropertyOptional({
    enum: USER_STATUSES,
    description: 'Deleted accounts are hidden unless asked for.',
  })
  @IsOptional()
  @IsIn([...USER_STATUSES])
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Matches email, name or phone.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ReasonDto {
  @ApiProperty({
    example: 'The CNIC photos are too blurry to read.',
    minLength: 3,
    maxLength: 1000,
  })
  @Trim()
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class DocumentNoteDto {
  @ApiProperty()
  @IsUUID()
  documentId!: string;

  @ApiProperty({ example: 'Blurry — please retake in daylight.' })
  @Trim()
  @IsString()
  @Length(2, 500)
  note!: string;
}

export class RejectBusinessDto extends ReasonDto {
  @ApiPropertyOptional({
    type: [DocumentNoteDto],
    description: 'Per-document notes; each named document is marked rejected.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DocumentNoteDto)
  documentNotes?: DocumentNoteDto[];
}

export class DisableUserDto {
  @ApiPropertyOptional({ example: 'Fraud report #128' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
