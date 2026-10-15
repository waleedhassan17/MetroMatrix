import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';

export class SpecialtyQueryDto {
  @ApiPropertyOptional({
    description: 'Count listed doctors practising in this city.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  city?: string;
}

export class ConditionQueryDto {
  @ApiPropertyOptional({ description: 'Name, Urdu name or alias ("pimples").' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Only the home-screen chips.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  common?: 'true' | 'false';
}

export class SuggestQueryDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  q!: string;
}
