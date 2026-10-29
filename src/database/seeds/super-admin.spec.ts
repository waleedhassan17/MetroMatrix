import * as bcrypt from 'bcryptjs';
import type { DataSource } from 'typeorm';
import { seedSuperAdmin } from './super-admin';

/** Enough of a DataSource for the seed: one users table, in memory. */
function fakeDataSource() {
  const rows: Record<string, unknown>[] = [];
  const repo = {
    findOne: async () => null,
    create: (v: Record<string, unknown>) => ({ ...v }),
    save: async (v: Record<string, unknown>) => {
      const row = { id: 'u1', ...v };
      rows.push(row);
      return row;
    },
  };
  return { rows, ds: { getRepository: () => repo } as unknown as DataSource };
}

describe('seedSuperAdmin', () => {
  const password = 'Very-Secret-42';

  it('stores a bcrypt hash only, and never hands the password back', async () => {
    const { rows, ds } = fakeDataSource();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await seedSuperAdmin(ds, {
      email: 'Root@Example.com',
      password,
      bcryptRounds: 4,
    });
    expect(result).toEqual({ outcome: 'created', userId: 'u1' });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(rows[0]).toMatchObject({
      email: 'root@example.com',
      role: 'super_admin',
      status: 'active',
    });
    // No authenticator yet: the first admin sign-in must enrol one.
    expect(rows[0].totpEnabled).toBeUndefined();
    expect(JSON.stringify(rows[0])).not.toContain(password);
    expect(await bcrypt.compare(password, rows[0].passwordHash as string)).toBe(
      true,
    );
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('refuses a weak password before touching the database', async () => {
    const { rows, ds } = fakeDataSource();
    await expect(
      seedSuperAdmin(ds, { email: 'root@example.com', password: 'short' }),
    ).rejects.toThrow(/SUPER_ADMIN_PASSWORD/);
    expect(rows).toHaveLength(0);
  });
});
