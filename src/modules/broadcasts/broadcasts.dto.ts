import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../common/validation/transforms';
import { StepUpDto } from '../admin/admins/admin-admins.dto';
import { SERVICE_TYPES, ServiceType } from '../businesses/business-types';
import { BROADCAST_AUDIENCES, BroadcastAudience } from './broadcast-audience';
import { BROADCAST_STATUSES } from './entities/admin-broadcast.entity';

export class CreateBroadcastDto extends StepUpDto {
  @ApiProperty({ enum: BROADCAST_AUDIENCES })
  @IsIn([...BROADCAST_AUDIENCES])
  audience!: BroadcastAudience;

  @ApiPropertyOptional({
    enum: SERVICE_TYPES,
    description: 'Partners only: one service (default: every service).',
  })
  @IsOptional()
  @IsIn([...SERVICE_TYPES])
  service?: ServiceType;

  @ApiProperty({ example: 'Eid Mubarak!', minLength: 2, maxLength: 65 })
  @Trim()
  @IsString()
  @Length(2, 65)
  title!: string;

  @ApiProperty({
    example: 'Kitchens are open all through Eid. Order your favourites.',
    minLength: 2,
    maxLength: 240,
  })
  @Trim()
  @IsString()
  @Length(2, 240)
  body!: string;

  @ApiPropertyOptional({
    example: 'metromatrix://food',
    description: 'Opened when tapped: a metromatrix:// link or an https URL.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  @Matches(/^(metromatrix:\/\/|https:\/\/)[^\s<>"']+$/, {
    message: 'deepLink must start with metromatrix:// or https://',
  })
  deepLink?: string;
}

class BroadcastAuthorView {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null;
}

export class BroadcastView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: BROADCAST_AUDIENCES }) audience!: string;
  @ApiProperty({ enum: SERVICE_TYPES, nullable: true, type: String })
  service!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true, type: String }) deepLink!: string | null;
  @ApiProperty({ enum: BROADCAST_STATUSES }) status!: string;
  @ApiProperty({ description: 'People with at least one device.' })
  recipients!: number;
  @ApiProperty({ description: 'Devices targeted.' }) devices!: number;
  @ApiProperty({ description: 'Accepted by Expo.' }) delivered!: number;
  @ApiProperty({ description: 'Refused by Expo.' }) failed!: number;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
  @ApiProperty({ type: BroadcastAuthorView, nullable: true })
  createdBy!: BroadcastAuthorView | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  finishedAt!: Date | null;
}
