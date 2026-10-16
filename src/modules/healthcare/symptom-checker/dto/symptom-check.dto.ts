import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { GENDERS, Gender } from '../../doctors/entities/doctor.entity';

export class SymptomCheckDto {
  @ApiProperty({
    example: 'Pimples on my face and back for six months',
    description: 'English or Roman Urdu, 10–1000 characters.',
  })
  @Trim()
  @IsString()
  @Length(10, 1000)
  text!: string;

  @ApiPropertyOptional({
    description: 'For a family member: their age and gender are used.',
  })
  @IsOptional()
  @IsUUID()
  familyMemberId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: GENDERS })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender;
}
