import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../../common/errors/codes';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Staff support lookup (Chunk 5, P12): a catering request by its CT- code, a
 * food order by its FC- code (with what wrote it: tiffin, catering, QR…), or
 * a tiffin subscription by id. Read-only; each lookup is audited because it
 * shows a customer's details.
 */
@Injectable()
export class GrowthLookupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
  ) {}

  async lookup(code: string) {
    const c = code.trim().toUpperCase();
    let out: Record<string, unknown> | null = null;
    if (c.startsWith('CT-')) {
      const [r] = await this.dataSource.query(
        `SELECT cr.id, cr.code, cr.status, to_char(cr.event_date, 'YYYY-MM-DD') AS event_date, cr.guests, cr.event_type,
                cr.fulfilment, cr.accepted_version, cr.food_order_id, cr.created_at, fb.id AS brand_id, fb.name AS vendor,
                u.display_name AS customer, u.email AS customer_email,
                (SELECT json_agg(json_build_object('version', q.version, 'total', q.total, 'advancePct', q.advance_pct,
                        'validUntil', q.valid_until) ORDER BY q.version DESC)
                   FROM catering_quotes q WHERE q.request_id = cr.id) AS quotes
           FROM catering_requests cr JOIN food_brands fb ON fb.id = cr.brand_id JOIN users u ON u.id = cr.user_id
          WHERE cr.code = $1`,
        [c],
      );
      if (r) out = { kind: 'catering', ...r };
    } else if (c.startsWith('FC-')) {
      const [r] = await this.dataSource.query(
        `SELECT o.id, o.code, o.status, o.source, o.campaign, o.payment_method, o.payment_status, o.total,
                o.prepaid_amount, o.scheduled_for, o.created_at, fb.id AS brand_id, fb.name AS vendor,
                u.display_name AS customer,
                (SELECT cr.code FROM catering_requests cr WHERE cr.food_order_id = o.id) AS catering_code,
                (SELECT td.subscription_id FROM tiffin_deliveries td WHERE td.food_order_id = o.id) AS tiffin_subscription_id
           FROM food_orders o JOIN food_brands fb ON fb.id = o.brand_id JOIN users u ON u.id = o.user_id
          WHERE o.code = $1`,
        [c],
      );
      if (r) out = { kind: 'order', ...r };
    } else if (UUID.test(code.trim())) {
      const [r] = await this.dataSource.query(
        `SELECT s.id, s.status, s.payment_method, s.period_payment_status, to_char(s.starts_on, 'YYYY-MM-DD') AS starts_on,
                to_char(s.current_period_start, 'YYYY-MM-DD') AS period_start, to_char(s.current_period_end, 'YYYY-MM-DD') AS period_end,
                p.name AS plan, fb.id AS brand_id, fb.name AS vendor, u.display_name AS customer, u.email AS customer_email,
                (SELECT count(*)::int FROM tiffin_deliveries d WHERE d.subscription_id = s.id) AS deliveries,
                (SELECT count(*)::int FROM tiffin_deliveries d WHERE d.subscription_id = s.id AND d.status = 'missed') AS missed
           FROM tiffin_subscriptions s JOIN tiffin_plans p ON p.id = s.plan_id JOIN food_brands fb ON fb.id = p.brand_id
           JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
        [code.trim()],
      );
      if (r) out = { kind: 'tiffin', ...r };
    } else
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message:
          'Give a CT- catering code, an FC- order code or a tiffin subscription id.',
        details: { fields: { code: ['Unrecognised code.'] } },
      });
    if (!out)
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Nothing with that code.',
      });
    await this.audit.record({
      action: 'food.lookup',
      targetType: String(out.kind),
      targetId: String(out.id),
      details: { code: c },
    });
    return out;
  }
}
