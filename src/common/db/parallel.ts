import { EntityManager } from 'typeorm';

type Thunk<T> = () => Promise<T>;

/**
 * Promise.all on the pool; one after another inside a transaction, whose
 * single connection must not run overlapping queries (pg deprecates it, and
 * pg@9 refuses).
 */
export function parallel<A, B>(
  m: EntityManager,
  fns: [Thunk<A>, Thunk<B>],
): Promise<[A, B]>;
export function parallel<A, B, C>(
  m: EntityManager,
  fns: [Thunk<A>, Thunk<B>, Thunk<C>],
): Promise<[A, B, C]>;
export async function parallel(
  m: EntityManager,
  fns: Thunk<unknown>[],
): Promise<unknown[]> {
  if (!m.queryRunner) return Promise.all(fns.map((f) => f()));
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out;
}

/**
 * The rows of an `UPDATE … RETURNING` / `DELETE … RETURNING`: TypeORM's pg
 * driver gives `[rows, affected]` for those (and plain rows for SELECT), so
 * `const [first] = await m.query(...)` would be the row *array*, never
 * undefined.
 */
export function returned<T = Record<string, unknown>>(res: unknown): T[] {
  if (
    Array.isArray(res) &&
    res.length === 2 &&
    Array.isArray(res[0]) &&
    typeof res[1] === 'number'
  )
    return res[0] as T[];
  return (Array.isArray(res) ? res : []) as T[];
}
