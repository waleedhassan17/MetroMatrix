import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { IsPkPhone } from '../../../../common/validation/phone';
import { RELATIONS, Relation } from '../entities/family-member.entity';
import { GENDERS, Gender } from '../../doctors/entities/doctor.entity';

export class CreateFamilyMemberDto {
  @ApiProperty({ example: 'Zara Khan' })
  @Trim()
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ enum: RELATIONS })
  @IsIn(RELATIONS)
  relation!: Relation;

  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender | null;

  @ApiPropertyOptional({ example: '2019-04-12', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({ strict: true })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsPkPhone()
  phone?: string | null;
}

export class UpdateFamilyMemberDto extends PartialType(CreateFamilyMemberDto) {}
