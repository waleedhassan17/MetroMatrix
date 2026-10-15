import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  /** Off in dev and tests; on in production once the app ships push. */
  pushEnabled: (process.env.PUSH_ENABLED ?? 'false') === 'true',
  /** Optional: Expo "enhanced push security" access token. */
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
}));
