import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** ?page=1&pageSize=20 — extend it for list endpoints. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

/**
 * The one list shape. Rows go under `items` — NEVER `data`, which the
 * envelope interceptor would unwrap, silently dropping total/page/pageSize.
 */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const paged = <T>(
  items: T[],
  total: number,
  q: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
): Paged<T> => ({ items, total, page: q.page, pageSize: q.pageSize });

/** Escape LIKE wildcards in user input before wrapping it in %…%. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
