import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shapes for admin-banners.controller.ts (Swagger only), checked
 * against real responses from the e2e suites.
 */

export class AdminHealthBannersRemoveView {
  @ApiProperty({ type: Boolean })
  deleted!: boolean;
}

export class AdminHealthBannersUpdateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  imageUrl!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String })
  subtitle!: string;
  @ApiProperty({ type: String })
  targetType!: string;
  @ApiProperty({ type: String, nullable: true })
  targetId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  targetScreen!: string | null;
  @ApiProperty({ type: String })
  city!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminHealthBannersCreateView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  imageUrl!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;
  @ApiProperty({ type: String })
  targetType!: string;
  @ApiProperty({ type: String, nullable: true })
  targetId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  targetScreen!: string | null;
  @ApiProperty({ type: String, nullable: true })
  city!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}

export class AdminHealthBannersReorderView {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  imageUrl!: string;
  @ApiProperty({ type: String })
  title!: string;
  @ApiProperty({ type: String, nullable: true })
  subtitle!: string | null;
  @ApiProperty({ type: String })
  targetType!: string;
  @ApiProperty({ type: String, nullable: true })
  targetId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  targetScreen!: string | null;
  @ApiProperty({ type: String, nullable: true })
  city!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: 'integer' })
  sort!: number;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
}
