const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** "15m" → 900000. The same `<n><s|m|h|d>` form env validation accepts. */
export function durationMs(value: string): number {
  const m = /^(\d+)([smhd])$/.exec(value.trim());
  if (!m)
    throw new Error(`Invalid duration "${value}" (expected e.g. 15m, 30d)`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}
