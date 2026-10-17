import { io, Socket } from 'socket.io-client';

/** A Socket.IO client on the /food namespace; resolves once connected, rejects with the connect_error. */
export function foodSocket(url: string, token?: string): Promise<Socket> {
  const socket = io(`${url}/food`, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error & { data?: unknown }) => {
      socket.close();
      reject(err);
    });
  });
}

/** Everything received on `event`, in order. */
export function record<T = any>(socket: Socket, event: string): T[] {
  const got: T[] = [];
  socket.on(event, (payload: T) => got.push(payload));
  return got;
}

/** The next `event` matching `match`, or reject after `ms`. */
export function nextEvent<T = any>(
  socket: Socket,
  event: string,
  match: (p: T) => boolean = () => true,
  ms = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`no ${event} within ${ms} ms`));
    }, ms);
    const on = (p: T) => {
      if (!match(p)) return;
      clearTimeout(timer);
      socket.off(event, on);
      resolve(p);
    };
    socket.on(event, on);
  });
}

/** Wait until `check()` is true (events arrive asynchronously). */
export async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A vendor's socket, resolved once the server has put it in its branch room and sent board.sync. */
export function vendorSocket(
  url: string,
  token: string,
): Promise<{ socket: Socket; board: any }> {
  const socket = io(`${url}/food`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no board.sync')), 3000);
    socket.once('board.sync', (board: any) => {
      clearTimeout(timer);
      resolve({ socket, board });
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}
