import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProductReport } from './entities/product-report.entity';
import { CreateReportDto } from './dto/report.dto';
import { ErrorCode } from '../../../common/errors/codes';
import { PRODUCT_FROM_SQL, VISIBLE_PRODUCT_SQL } from '../common/catalog-sql';

/** Customers flag products; admins work the queue (P6 admin routes). */
@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(userId: string, productId: string, dto: CreateReportDto) {
    const [visible] = await this.dataSource.query(
      `SELECT 1 ${PRODUCT_FROM_SQL} WHERE p.id = $1 AND ${VISIBLE_PRODUCT_SQL}`,
      [productId],
    );
    if (!visible)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Product not found.',
      });
    try {
      const saved = await this.dataSource.manager.save(
        this.dataSource.manager.create(ProductReport, {
          productId,
          reporterUserId: userId,
          reason: dto.reason,
          details: dto.details ?? null,
        }),
      );
      return {
        id: saved.id,
        status: saved.status,
        reason: saved.reason,
        createdAt: saved.createdAt,
      };
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message:
            'You have already reported this product; our team is looking at it.',
        });
      }
      throw err;
    }
  }
}
