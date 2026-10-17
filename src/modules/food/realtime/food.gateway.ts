import { HttpException, Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { DataSource, In } from 'typeorm';
import { AccessTokenValidator } from '../../auth/access-token-validator';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { FoodOrder } from '../orders/entities/food-order.entity';
import { FoodOrderViewsService } from '../orders/food-order-views.service';
import { FoodNotifier, OrderChange } from '../orders/food-notifier.service';
import { ACTIVE_STATUSES } from '../orders/food-order-status';

export const FOOD_NAMESPACE = '/food';

/** What the server knows about a connected socket. */
export interface FoodSocketData {
  user: AuthenticatedUser;
  /** Vendor owner: their branch (room branch:{id}). */
  branchId?: string;
  /** Rider: their rider row (room rider:{userId}). */
  riderId?: string;
}

type FoodSocket = Socket<any, any, any, FoodSocketData>;

export const rooms = {
  order: (id: string) => `order:${id}`,
  branch: (id: string) => `branch:${id}`,
  rider: (userId: string) => `rider:${userId}`,
};

/** The handshake's access token: `auth.token`, else an Authorization header. */
function tokenOf(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token)
    return auth.token.replace(/^Bearer\s+/i, '');
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header))
    return header.replace(/^Bearer\s+/i, '');
  return null;
}

/**
 * Food Court's live channel (namespace /food, same dyno as the API).
 *
 * - Handshake: `auth: { token }` — the access token, checked exactly like an
 *   HTTP request (AccessTokenValidator: signature, jti denylist,
 *   token_version, status). Refused → connect_error with the error code.
 * - Rooms: the vendor owner joins branch:{id} on connect (and gets
 *   board.sync); a rider joins rider:{userId}; anyone joins order:{id} only
 *   through `subscribe`, which the server authorises (the order's customer,
 *   its vendor, its rider) — otherwise `{ ok: false, code: 'NOT_FOUND' }`.
 * - Server → client: order.new, order.updated, order.payment,
 *   rider.location, board.sync. State always lives in REST: after a
 *   reconnect, clients resync from the API.
 * - One dyno, in-memory adapter. Several dynos need the Redis adapter.
 */
@WebSocketGateway({ namespace: FOOD_NAMESPACE })
export class FoodGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleInit
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(FoodGateway.name);

  constructor(
    private readonly validator: AccessTokenValidator,
    private readonly dataSource: DataSource,
    private readonly views: FoodOrderViewsService,
    private readonly notifier: FoodNotifier,
  ) {}

  onModuleInit(): void {
    this.notifier.onOrderChanged = (id, kind) => this.emitOrder(id, kind);
  }

  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      const token = tokenOf(socket);
      if (!token) {
        const err = new Error('UNAUTHORIZED') as Error & { data?: unknown };
        err.data = { code: 'UNAUTHORIZED', message: 'Send auth.token.' };
        return next(err);
      }
      this.validator.verify(token).then(
        (user) => {
          (socket.data as FoodSocketData).user = user;
          next();
        },
        (e: unknown) => {
          const body =
            e instanceof HttpException
              ? (e.getResponse() as { code?: string; message?: string })
              : {};
          const code = body.code ?? 'UNAUTHORIZED';
          const err = new Error(code) as Error & { data?: unknown };
          err.data = { code, message: body.message ?? 'Invalid token.' };
          next(err);
        },
      );
    });
  }

  async handleConnection(socket: FoodSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    try {
      if (user.role === 'partner') {
        const [b] = await this.dataSource.query(
          `SELECT br.id FROM branches br JOIN businesses b ON b.id = br.business_id
            WHERE b.owner_user_id = $1 AND b.service_type = 'food' AND b.status = 'approved'`,
          [user.id],
        );
        if (b) {
          socket.data.branchId = b.id;
          await socket.join(rooms.branch(b.id));
          socket.emit('board.sync', await this.board(b.id));
        }
      } else if (user.role === 'rider') {
        const [r] = await this.dataSource.query(
          `SELECT r.id FROM riders r JOIN businesses b ON b.id = r.business_id
            WHERE r.user_id = $1 AND r.status = 'active' AND b.status = 'approved'`,
          [user.id],
        );
        if (r) {
          socket.data.riderId = r.id;
          await socket.join(rooms.rider(user.id));
        }
      }
    } catch (err) {
      this.logger.warn(`connection setup failed: ${(err as Error).message}`);
    }
  }

  /** Join an order's room — only its customer, its vendor or its rider. */
  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: FoodSocket,
    @MessageBody() body: { orderId?: unknown },
  ) {
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    if (!isUUID(orderId) || !(await this.canWatch(socket.data, orderId)))
      return { ok: false, code: 'NOT_FOUND' };
    await socket.join(rooms.order(orderId));
    return { ok: true, orderId };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: FoodSocket,
    @MessageBody() body: { orderId?: unknown },
  ) {
    if (typeof body?.orderId === 'string')
      await socket.leave(rooms.order(body.orderId));
    return { ok: true };
  }

  /** Called after a commit (FoodNotifier.onOrderChanged). Never throws into the caller. */
  async emitOrder(orderId: string, kind: OrderChange): Promise<void> {
    const o = await this.dataSource.manager.findOne(FoodOrder, {
      where: { id: orderId },
    });
    if (!o || !this.server) return;
    const [card] = await this.views.boardCards([o]);
    const branchRoom = rooms.branch(o.branchId);
    if (kind === 'new') {
      this.server.to(branchRoom).emit('order.new', { order: card });
      return;
    }
    const head = { orderId: o.id, code: o.code, status: o.status };
    const view = await this.views.detail(o, 'customer');
    this.server
      .to(rooms.order(o.id))
      .except(branchRoom)
      .emit('order.updated', { ...head, order: view });
    this.server.to(branchRoom).emit('order.updated', { ...head, order: card });
    if (o.riderId) {
      const [r] = await this.dataSource.query(
        `SELECT user_id FROM riders WHERE id = $1`,
        [o.riderId],
      );
      if (r)
        this.server
          .to(rooms.rider(r.user_id))
          .except(rooms.order(o.id))
          .emit('order.updated', { ...head, order: view });
    }
    if (kind === 'payment')
      this.server.to([rooms.order(o.id), branchRoom]).emit('order.payment', {
        ...head,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
      });
  }

  /** Emit to everyone watching an order (rider.location, P6). */
  toOrder(orderId: string, event: string, payload: unknown) {
    this.server?.to(rooms.order(orderId)).emit(event, payload);
  }

  toRider(userId: string, event: string, payload: unknown) {
    this.server?.to(rooms.rider(userId)).emit(event, payload);
  }

  private async board(branchId: string) {
    const rows = await this.dataSource.manager.find(FoodOrder, {
      where: { branchId, status: In([...ACTIVE_STATUSES]) },
      order: { createdAt: 'ASC' },
      take: 200,
    });
    return { at: new Date(), orders: await this.views.boardCards(rows) };
  }

  private async canWatch(data: FoodSocketData, orderId: string) {
    const [o] = await this.dataSource.query(
      `SELECT user_id, branch_id, rider_id FROM food_orders WHERE id = $1`,
      [orderId],
    );
    if (!o) return false;
    return (
      (data.user.role === 'customer' && o.user_id === data.user.id) ||
      (!!data.branchId && o.branch_id === data.branchId) ||
      (!!data.riderId && o.rider_id === data.riderId)
    );
  }
}
