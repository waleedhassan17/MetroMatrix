import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import {
  EXPO_BATCH_SIZE,
  ExpoMessage,
  ExpoPushClient,
} from './expo-push.client';
import { UserDevice } from '../users/entities/user-device.entity';
import { AccountService } from '../auth/account.service';
import { ErrorCode } from '../../common/errors/codes';
import { paged, PaginationQueryDto } from '../../common/pagination/pagination';

export interface NotifyPayload {
  type: string;
  title: string;
  body: string;
  /** Deep-link target for the app, e.g. `{ storeOrderId, groupCode }`. */
  data?: Record<string, unknown>;
  /** Push only: 'high' wakes the device at once (a vendor's new order). */
  priority?: 'high';
}

export const notificationView = (n: Notification) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  data: n.data,
  readAt: n.readAt,
  createdAt: n.createdAt,
});

/**
 * In-app notifications + Expo push, shared by every service.
 *
 * Call notify() AFTER the transaction that caused it has committed: nobody is
 * told about something that then rolled back. Push is best-effort — a failed
 * send is logged and never fails the caller; the in-app row is the record.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    @InjectRepository(UserDevice)
    private readonly devices: Repository<UserDevice>,
    private readonly push: ExpoPushClient,
    private readonly account: AccountService,
  ) {}

  onModuleInit(): void {
    this.account.onAccountDeleted(async (m, user) => {
      await m.delete(Notification, { userId: user.id });
    });
  }

  async notify(userId: string, payload: NotifyPayload): Promise<Notification> {
    const [row] = await this.notifyMany([userId], payload);
    return row;
  }

  /** One row per user, then one push per registered device. */
  async notifyMany(
    userIds: string[],
    payload: NotifyPayload,
  ): Promise<Notification[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const rows = await this.repo.save(
      unique.map((userId) =>
        this.repo.create({
          userId,
          type: payload.type,
          title: payload.title.slice(0, 140),
          body: payload.body.slice(0, 500),
          data: payload.data ?? {},
          readAt: null,
        }),
      ),
    );
    await this.sendPush(rows, payload.priority).catch((err: Error) =>
      this.logger.warn(`Push failed: ${err.message}`),
    );
    return rows;
  }

  async list(userId: string, q: PaginationQueryDto & { unread?: boolean }) {
    const where = { userId, ...(q.unread ? { readAt: IsNull() } : {}) };
    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
    return paged(rows.map(notificationView), total, q);
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    return {
      unread: await this.repo.count({ where: { userId, readAt: IsNull() } }),
    };
  }

  async markRead(userId: string, id: string) {
    const row = await this.repo.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Notification not found.',
      });
    }
    if (!row.readAt) {
      row.readAt = new Date();
      await this.repo.save(row);
    }
    return notificationView(row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.repo.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: res.affected ?? 0 };
  }

  // ── push ──────────────────────────────────────────────────────────────────

  private async sendPush(
    rows: Notification[],
    priority?: 'high',
  ): Promise<void> {
    if (!this.push.enabled || rows.length === 0) return;
    const devices = await this.devices.find({
      where: { userId: In(rows.map((r) => r.userId)) },
    });
    if (devices.length === 0) return;

    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const messages: ExpoMessage[] = devices.map((d) => {
      const n = byUser.get(d.userId)!;
      return {
        to: d.expoPushToken,
        title: n.title,
        body: n.body,
        sound: 'default',
        ...(priority ? { priority } : {}),
        data: { ...n.data, type: n.type, notificationId: n.id },
      };
    });

    const dead: string[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const tickets = await this.push.send(batch);
      tickets.forEach((ticket, j) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        ) {
          dead.push(batch[j].to);
        }
      });
    }
    // An uninstalled app's token will never work again.
    if (dead.length) await this.devices.delete({ expoPushToken: In(dead) });
  }
}
