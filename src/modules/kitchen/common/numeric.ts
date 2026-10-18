import type { ColumnOptions } from 'typeorm';

/** numeric(p, s) read back as a JS number (quantities and costs stay well inside double precision). */
export const numeric = (precision: number, scale: number): ColumnOptions => ({
  type: 'numeric',
  precision,
  scale,
  transformer: {
    to: (v: number | null | undefined) => v,
    from: (v: string | null) =>
      v === null || v === undefined ? null : Number(v),
  },
});
