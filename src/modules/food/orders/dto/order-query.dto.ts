import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/pagination/pagination';

export class CustomerFoodOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'past'] })
  @IsOptional()
  @IsIn(['active', 'past'])
  status?: 'active' | 'past';
}
