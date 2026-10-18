import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base/base.entity';

export const ALIAS_LANGS = ['en', 'ur', 'roman'] as const;
export type AliasLang = (typeof ALIAS_LANGS)[number];

/**
 * What people call an ingredient → its canonical English name
 * ("tamatar", "ٹماٹر" → tomato). Seeded by migration, staff-editable; the
 * voice resolver and receipt scan match a vendor's ingredients through it.
 */
@Entity('ingredient_aliases')
@Index(['canonical'])
@Check('CHK_ingredient_aliases_lang', `"lang" IN ('en', 'ur', 'roman')`)
export class IngredientAlias extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'citext' })
  alias!: string;

  @Column({ type: 'varchar', length: 80 })
  canonical!: string;

  @Column({ type: 'varchar', length: 6 })
  lang!: AliasLang;
}
