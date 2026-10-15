import { registerAs } from '@nestjs/config';

export default registerAs('jobs', () => ({
  /**
   * Scheduled jobs (order deadlines, reminders, completion, digests). On by
   * default; tests turn them off and call the job methods directly, so a
   * wall-clock tick can never race a test.
   */
  enabled: (process.env.JOBS_ENABLED || 'true') === 'true',
}));
