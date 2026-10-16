import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';
import {
  MEDICINE_FORMS,
  MedicineForm,
} from '../../reference/entities/medicine.entity';
import {
  MEDICINE_TIMINGS,
  MedicineTiming,
} from '../entities/prescription.entity';

export class PrescribedMedicineDto {
  @ApiProperty({ example: 'Doxycycline' })
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: '100 mg' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  strength?: string;

  @ApiProperty({ enum: MEDICINE_FORMS })
  @IsIn(MEDICINE_FORMS)
  form!: MedicineForm;

  @ApiProperty({
    example: '1+0+1',
    description: 'Morning + afternoon + night (or e.g. "2 puffs").',
  })
  @Trim()
  @IsString()
  @Matches(/^[0-9½¼.+\- a-zA-Z]{1,20}$/, {
    message: 'dosePattern looks like 1+0+1',
  })
  dosePattern!: string;

  @ApiProperty({ enum: MEDICINE_TIMINGS })
  @IsIn(MEDICINE_TIMINGS)
  timing!: MedicineTiming;

  @ApiPropertyOptional({ nullable: true, example: 14 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number | null;

  @ApiPropertyOptional({ example: 'Take with plenty of water.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  instructions?: string;
}

export class PrescribedTestDto {
  @ApiProperty({ example: 'CBC' })
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  instructions?: string;
}

export class WritePrescriptionDto {
  @ApiProperty({ example: 'Acne vulgaris (moderate)' })
  @Trim()
  @IsString()
  @Length(2, 2000)
  diagnosis!: string;

  @ApiPropertyOptional({
    example: 'Avoid picking; use a gentle cleanser twice a day.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(3000)
  advice?: string;

  @ApiPropertyOptional({ nullable: true, example: 30 })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  followUpInDays?: number | null;

  @ApiProperty({ type: [PrescribedMedicineDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescribedMedicineDto)
  medicines!: PrescribedMedicineDto[];

  @ApiPropertyOptional({ type: [PrescribedTestDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescribedTestDto)
  tests?: PrescribedTestDto[];
}

export class MedicineSuggestDto {
  @Trim()
  @IsString()
  @Length(1, 60)
  q!: string;
}

export class PatientPrescriptionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only this family member.' })
  @IsOptional()
  @IsUUID()
  familyMemberId?: string;
}
