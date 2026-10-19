import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { bestMatch } from '../../../common/text/fuzzy';
import type { VendorRef } from '../../food/vendor/food-vendor.service';
import { MediaService } from '../../media/media.service';
import { AiService } from '../../ai/ai.service';
import { aiUnavailable } from '../../ai/ai-errors';
import { ScanDto } from '../dto/purchase.dto';
import { LineResolver, isReady } from '../stock/line-resolver.service';

class ReceiptLineAnswer {
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) qty?: number;
  @IsOptional() @IsString() @MaxLength(12) unit?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) totalPrice?: number;
}

export class ReceiptAnswerDto {
  @IsOptional() @IsString() @MaxLength(80) supplier?: string;
  @IsOptional() @IsISO8601({ strict: true }) date?: string;

  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineAnswer)
  lines!: ReceiptLineAnswer[];

  @IsOptional() @IsNumber() @Min(0) @Max(100_000_000) total?: number;
  @IsNumber() @Min(0) @Max(1) confidence!: number;
}

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    supplier: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: {
            type: 'string',
            enum: ['kg', 'g', 'l', 'ml', 'dozen', 'piece', 'packet', 'tray'],
          },
          totalPrice: { type: 'number', description: 'Rupees for this line.' },
        },
        required: ['name'],
      },
    },
    total: { type: 'number' },
    confidence: { type: 'number' },
  },
  required: ['lines', 'confidence'],
};

const MANUAL = 'Type the bill’s lines into a new purchase.';

/**
 * POST /purchases/scan: a photographed bill → draft purchase lines matched
 * to the kitchen's ingredients. Nothing is saved: the vendor checks the
 * draft and POSTs it as a purchase (source receipt_scan).
 */
@Injectable()
export class ReceiptScanService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly media: MediaService,
    private readonly lines: LineResolver,
  ) {}

  async scan(v: VendorRef, dto: ScanDto) {
    this.media.assertOwnedAsset(
      v.ownerUserId,
      'receipt',
      dto.imageUrl,
      dto.publicId,
      'imageUrl',
    );
    if (!this.ai.usable('receipt_scan'))
      throw aiUnavailable(MANUAL, 'disabled');
    const names: Array<{ name: string }> = await this.dataSource.query(
      `SELECT name FROM kitchen_ingredients WHERE branch_id = $1 AND is_active ORDER BY name`,
      [v.branchId],
    );
    const out = await this.ai.vision({
      feature: 'receipt_scan',
      promptId: 'receipt_scan',
      input: { ingredients: names.map((n) => n.name).slice(0, 200) },
      imageUrls: [dto.imageUrl],
      schema: RECEIPT_SCHEMA,
      dto: ReceiptAnswerDto,
      actor: { businessId: v.businessId, userId: v.ownerUserId },
      temperature: 0,
    });
    if (!out.ok) throw this.ai.failure(out, MANUAL);
    const a = out.data;
    const resolved = await this.lines.resolve(v.branchId, a.lines);
    const suppliers: Array<{ id: string; name: string }> =
      await this.dataSource.query(
        `SELECT id, name FROM suppliers WHERE branch_id = $1 AND is_active`,
        [v.branchId],
      );
    const supplier = a.supplier
      ? (bestMatch(
          a.supplier,
          suppliers.map((s) => ({ value: s, names: [s.name] })),
          0.6,
        ).best?.value ?? null)
      : null;
    const ready = resolved.filter(isReady).filter((l) => l.totalPrice !== null);
    const linesTotal = resolved.reduce((s, l) => s + (l.totalPrice ?? 0), 0);
    const body = {
      ...(supplier ? { supplierId: supplier.id } : {}),
      ...(a.date ? { purchasedAt: a.date } : {}),
      receiptUrl: dto.imageUrl,
      ...(dto.publicId ? { receiptPublicId: dto.publicId } : {}),
      source: 'receipt_scan',
      lines: ready.map((l) => ({
        ingredientId: l.ingredientId,
        qty: l.qty,
        unit: l.unit,
        totalPrice: Math.round(l.totalPrice!),
      })),
    };
    return {
      supplierName: a.supplier ?? null,
      supplier,
      date: a.date ?? null,
      total: a.total ?? null,
      linesTotal,
      /** The bill total and the lines disagree: something was misread or skipped. */
      totalMismatch:
        a.total !== undefined && Math.abs(a.total - linesTotal) > 1,
      confidence: a.confidence,
      lines: resolved,
      proposedAction:
        ready.length && ready.length === resolved.length
          ? {
              method: 'POST',
              path: '/food/vendor/kitchen/purchases',
              body,
              summary: `Save ${ready.length} lines, Rs ${linesTotal.toLocaleString('en-PK')}`,
            }
          : null,
      draft: body,
      needsConfirmation: true,
    };
  }
}
