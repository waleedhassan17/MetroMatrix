import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { NotificationsService } from '../../notifications/notifications.service';
import { KitchenAlertKind } from '../entities/kitchen-alert.entity';

/**
 * Kitchen notifications through an outbox: `queue` inside the stock
 * transaction, `flush` after it commits (and the minute job flushes
 * whatever is left). A rolled-back change never notifies.
 */
@Injectable()
export class KitchenAlertsService {
  private readonly logger = new Logger(KitchenAlertsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async queue(
    m: EntityManager,
    branchId: string,
    kind: KitchenAlertKind,
    title: string,
    body: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await m.query(
      `INSERT INTO kitchen_alerts (branch_id, kind, title, body, data) VALUES ($1, $2, $3, $4, $5)`,
      [
        branchId,
        kind,
        title.slice(0, 120),
        body.slice(0, 300),
        JSON.stringify(data),
      ],
    );
  }

  /** Send pending alerts (one branch, or all). Each is sent once: rows are claimed with SKIP LOCKED. */
  async flush(branchId?: string): Promise<number> {
    const rows: Array<{
      id: string;
      kind: string;
      title: string;
      body: string;
      data: Record<string, unknown>;
      owner: string;
    }> = await this.dataSource.transaction(async (m) =>
      m
        .query(
          `UPDATE kitchen_alerts a SET sent_at = now(), updated_at = now()
           FROM branches br JOIN businesses b ON b.id = br.business_id
          WHERE a.branch_id = br.id
            AND a.id IN (SELECT id FROM kitchen_alerts WHERE sent_at IS NULL
                           ${branchId ? 'AND branch_id = $1' : ''}
                          ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED)
        RETURNING a.id, a.kind, a.title, a.body, a.data, b.owner_user_id AS owner`,
          branchId ? [branchId] : [],
        )
        .then(
          (r: [unknown[], number] | unknown[]) =>
            (Array.isArray(r[0]) ? r[0] : r) as any,
        ),
    );
    for (const r of rows) {
      try {
        await this.notifications.notify(r.owner, {
          type: `kitchen.${r.kind}`,
          title: r.title,
          body: r.body,
          data: { ...r.data, alertId: r.id },
        });
      } catch (err) {
        this.logger.warn(`kitchen alert not sent: ${(err as Error).message}`);
      }
    }
    return rows.length;
  }

  /** After an order changes: send what that order's stock moves queued. */
  async flushForOrder(orderId: string): Promise<void> {
    const [o] = await this.dataSource.query(
      `SELECT branch_id FROM food_orders WHERE id = $1`,
      [orderId],
    );
    if (o) await this.flush(o.branch_id);
  }
}
