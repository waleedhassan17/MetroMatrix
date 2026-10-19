import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SEARCH_KINDS = ['home', 'list', 'search'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/**
 * One look for food: the home, a vendor list or a search. Anonymous by
 * design — no user, device or IP, and the place only as a geohash6 cell
 * (≈ 1.2 × 0.6 km). Free text is normalised and stripped of digit runs
 * (phone numbers). Aggregated nightly into demand_cells; kept 26 weeks.
 */
@Entity('search_events')
@Index(['at'])
@Index(['city', 'at'])
@Check(
  'CHK_search_events_numbers',
  '"hour" BETWEEN 0 AND 23 AND "weekday" BETWEEN 0 AND 6 AND "results_count" >= 0 AND "open_results_count" BETWEEN 0 AND "results_count"',
)
export class SearchEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: SEARCH_KINDS, enumName: 'search_kind' })
  kind!: SearchKind;

  @Column({ type: 'varchar', length: 6 })
  geohash6!: string;

  /** The nearest kitchen's city within 30 km (null: nowhere near one). */
  @Column({ type: 'citext', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'query_norm', nullable: true })
  queryNorm!: string | null;

  @Column({ type: 'uuid', name: 'cuisine_id', nullable: true })
  cuisineId!: string | null;

  @Column({ type: 'smallint', name: 'results_count' })
  resultsCount!: number;

  @Column({ type: 'smallint', name: 'open_results_count' })
  openResultsCount!: number;

  /** Pakistan time. */
  @Column({ type: 'smallint' })
  hour!: number;

  /** 0 = Sunday. */
  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  at!: Date;
}
