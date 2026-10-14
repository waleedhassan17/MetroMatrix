/**
 * Super admin seed.
 *
 *   npm run seed:superadmin                        (dev, ts-node)
 *   npm run seed:superadmin:prod                   (compiled, e.g. `heroku run`)
 *   … -- --reset-password                          re-hash from SUPER_ADMIN_PASSWORD
 *   … -- --reset-totp                              force TOTP re-enrolment (lost phone)
 *
 * Reads SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD from the environment. Never
 * prints the password. Refuses to run against a database with pending
 * migrations.
 */
import { AppDataSource } from '../data-source';
import { seedSuperAdmin } from './super-admin';

/* eslint-disable no-console */
async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL ?? '';
  const password = process.env.SUPER_ADMIN_PASSWORD ?? '';
  if (!email || !password) {
    throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD first.');
  }

  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) {
      throw new Error(
        'Pending migrations — run `npm run migration:run` first.',
      );
    }
    const args = process.argv.slice(2);
    const { outcome, userId } = await seedSuperAdmin(AppDataSource, {
      email,
      password,
      bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
      resetPassword: args.includes('--reset-password'),
      resetTotp: args.includes('--reset-totp'),
    });
    console.log(
      `[seed] super admin ${outcome}: ${email.toLowerCase()} (${userId})`,
    );
    if (outcome === 'created' || args.includes('--reset-totp')) {
      console.log(
        '[seed] Next: sign in on the admin portal; it will ask you to enrol an authenticator app.',
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', (err as Error).message);
  process.exit(1);
});
