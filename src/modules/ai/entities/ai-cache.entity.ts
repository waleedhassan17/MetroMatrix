import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';

/** 24 h answers for prompts whose output isn't user-specific, keyed by (prompt, version, input hash). */
@Entity('ai_cache')
@Index(['cacheKey'], { unique: true })
@Index(['expiresAt'])
export class AiCacheEntry extends BaseEntity {
  @Column({ type: 'varchar', length: 64, name: 'cache_key' })
  cacheKey!: string;

  @Column({ type: 'varchar', length: 60, name: 'prompt_id' })
  promptId!: string;

  @Column({ type: 'smallint', name: 'prompt_version' })
  promptVersion!: number;

  @Column({ type: 'jsonb' })
  output!: Record<string, unknown>;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}
