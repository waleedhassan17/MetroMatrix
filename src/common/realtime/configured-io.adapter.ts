import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * Socket.IO with the same CORS rule as HTTP (CORS_ORIGINS): a browser origin
 * on the list, or none at all (the mobile apps send no Origin).
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean) => void,
        ) =>
          callback(
            null,
            !origin ||
              this.origins.includes('*') ||
              this.origins.includes(origin),
          ),
        credentials: true,
      },
    });
  }
}
