import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Trim } from '../../../../common/validation/transforms';
import { IsPkPhone } from '../../../../common/validation/phone';
import { RIDER_VEHICLES, RiderVehicle } from '../entities/rider.entity';

export class CreateRiderDto {
  @ApiProperty({ example: 'Imran Ali' })
  @Trim()
  @IsString()
  @Length(2, 80)
  fullName!: string;

  @ApiPropertyOptional({ example: '03001234567' })
  @IsOptional()
  @IsPkPhone()
  phone?: string;

  @ApiPropertyOptional({ enum: RIDER_VEHICLES, default: 'bike' })
  @IsOptional()
  @IsIn(RIDER_VEHICLES)
  vehicle?: RiderVehicle;
}

export class UpdateRiderDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 80)
  fullName?: string;

  @ApiPropertyOptional({ example: '03001234567' })
  @IsOptional()
  @IsPkPhone()
  phone?: string;

  @ApiPropertyOptional({ enum: RIDER_VEHICLES })
  @IsOptional()
  @IsIn(RIDER_VEHICLES)
  vehicle?: RiderVehicle;
}

export const VENDOR_RIDER_STATUSES = [
  'active',
  'inactive',
  'on_leave',
] as const;

export class RiderStatusDto {
  @ApiProperty({ enum: VENDOR_RIDER_STATUSES })
  @IsIn(VENDOR_RIDER_STATUSES)
  status!: (typeof VENDOR_RIDER_STATUSES)[number];
}
