import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { MediaStorage } from '../media/media-storage';

/** Voice audio is kept 24 h, transcripts 30 days, cached answers until they expire. */
export const AUDIO_RETENTION_HOURS = 24;
export const VOICE_LOG_RETENTION_DAYS = 30;
const BATCH = 100;

/**
 * Retention for the AI layer. Advisory-locked like every job; a plain
 * method too, so tests call it with a fixed `now`.
 */
@Injectable()
export class AiJobsService {
  private readonly logger = new Logger(AiJobsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: MediaStorage,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 15 * * * *', { name: 'ai-retention' })
  async cronRetention() {
    if (this.config.get<boolean>('jobs.enabled') ?? true)
      await this.retention();
  }

  async retention(now = new Date()) {
    const result = await this.dataSource.transaction(async (m) => {
      const [{ locked }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext('ai:retention')) AS locked`,
      );
      if (!locked) return null;
      const due: Array<{ id: string; audio_url: string }> = await m.query(
        `SELECT id, audio_url FROM voice_logs
          WHERE audio_url IS NOT NULL AND audio_deleted_at IS NULL
            AND created_at < $1::timestamptz - make_interval(hours => $2)
          ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
        [now, AUDIO_RETENTION_HOURS],
      );
      let audioDeleted = 0;
      let audioFailed = 0;
      for (const row of due) {
        if (await this.storage.destroy(row.audio_url)) {
          await m.query(
            `UPDATE voice_logs SET audio_deleted_at = $2, audio_url = NULL, updated_at = now() WHERE id = $1`,
            [row.id, now],
          );
          audioDeleted++;
        } else audioFailed++;
      }
      const logs = await m.query(
        `DELETE FROM voice_logs WHERE created_at < $1::timestamptz - make_interval(days => $2)
           AND (audio_url IS NULL OR audio_deleted_at IS NOT NULL)`,
        [now, VOICE_LOG_RETENTION_DAYS],
      );
      const cache = await m.query(
        `DELETE FROM ai_cache WHERE expires_at < $1`,
        [now],
      );
      return {
        audioDeleted,
        audioFailed,
        voiceLogsPurged: logs[1] ?? 0,
        cachePurged: cache[1] ?? 0,
      };
    });
    if (!result) return { skipped: true };
    this.logger.log(`ai:retention: ${JSON.stringify(result)}`);
    return result;
  }
}
