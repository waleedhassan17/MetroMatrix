import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const DEMAND_DIMENSIONS = ['all', 'cuisine', 'query'] as const;
export type DemandDimension = (typeof DEMAND_DIMENSIONS)[number];

/**
 * The nightly aggregate of search_events per week (Monday, Pakistan time),
 * city and geohash6 cell: everything (`all`), per cuisine or per query, for
 * the whole day (`hour` null) or one hour. A cell is shown only with at
 * least 5 searches (DEMAND_K); `orders` are food orders dropped in the cell.
 */
@Entity('demand_cells')
@Index(['city', 'week', 'dimension'])
export class DemandCell {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'date' })
  week!: string;

  @Column({ type: 'citext' })
  city!: string;

  @Column({ type: 'varchar', length: 6 })
  geohash6!: string;

  @Column({
    type: 'enum',
    enum: DEMAND_DIMENSIONS,
    enumName: 'demand_dimension',
  })
  dimension!: DemandDimension;

  @Column({ type: 'uuid', name: 'cuisine_id', nullable: true })
  cuisineId!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'query_norm', nullable: true })
  queryNorm!: string | null;

  @Column({ type: 'smallint', nullable: true })
  hour!: number | null;

  @Column({ type: 'int' })
  searches!: number;

  @Column({ type: 'int', name: 'zero_results' })
  zeroResults!: number;

  /** Searches that found kitchens, none of them open. */
  @Column({ type: 'int', name: 'closed_results' })
  closedResults!: number;

  @Column({ type: 'int', default: 0 })
  orders!: number;

  @Column({ type: 'timestamptz', name: 'computed_at' })
  computedAt!: Date;
}
