import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Trim } from '../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { ALIAS_LANGS, AliasLang } from '../entities/ingredient-alias.entity';

export class AliasesQueryDto extends PaginationQueryDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) canonical?: string;
  @ApiPropertyOptional({ enum: ALIAS_LANGS })
  @IsOptional()
  @IsIn(ALIAS_LANGS)
  lang?: AliasLang;
}

export class AliasDto {
  @ApiProperty({ example: 'shimla mirch' })
  @Trim()
  @IsString()
  @Length(1, 80)
  alias!: string;

  @ApiProperty({
    example: 'capsicum',
    description: 'The canonical English name.',
  })
  @Trim()
  @IsString()
  @Length(2, 80)
  canonical!: string;

  @ApiProperty({ enum: ALIAS_LANGS })
  @IsIn(ALIAS_LANGS)
  lang!: AliasLang;
}
