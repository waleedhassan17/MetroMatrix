import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AdminSetupService, setupCodeMatches } from './admin-setup.service';
import { maintenanceExempt } from '../../platform/platform.guard';
import { PasswordHasher } from '../password-hasher';
import { TokenService } from '../token.service';
import { OperationalAuditService } from '../../../common/audit/operational-audit.service';

const dto = {
  setupCode: 'anything-at-all-123',
  email: 'owner@example.com',
  displayName: 'Owner',
  password: 'Strong1Password',
};

function service(code: string) {
  const transaction = jest.fn();
  const hash = jest.fn();
  const s = new AdminSetupService(
    { transaction } as unknown as DataSource,
    { hash } as unknown as PasswordHasher,
    {} as TokenService,
    {} as OperationalAuditService,
    { get: () => code } as unknown as ConfigService,
  );
  return { s, transaction, hash };
}

describe('AdminSetupService', () => {
  it('refuses with SETUP_DISABLED when ADMIN_SETUP_CODE is not set, before touching the database', async () => {
    const { s, transaction, hash } = service('');
    await expect(s.setup(dto)).rejects.toMatchObject({
      status: 403,
      response: { code: 'SETUP_DISABLED' },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('refuses a wrong code with SETUP_CODE_INVALID, before hashing or the database', async () => {
    const { s, transaction, hash } = service('the-real-setup-code-0123');
    await expect(
      s.setup({ ...dto, setupCode: 'the-real-setup-code-0124' }),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SETUP_CODE_INVALID' },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
  });

  it('compares codes exactly, whatever their lengths, and never matches an unset code', () => {
    expect(setupCodeMatches('abc-setup-code-0123', 'abc-setup-code-0123')).toBe(
      true,
    );
    expect(setupCodeMatches('abc-setup-code-012', 'abc-setup-code-0123')).toBe(
      false,
    );
    expect(setupCodeMatches('ABC-setup-code-0123', 'abc-setup-code-0123')).toBe(
      false,
    );
    expect(setupCodeMatches('', '')).toBe(false);
    expect(setupCodeMatches('x'.repeat(200), 'abc-setup-code-0123')).toBe(
      false,
    );
  });

  it('stays reachable in maintenance mode', () => {
    const req = { body: {} } as Parameters<typeof maintenanceExempt>[1];
    expect(maintenanceExempt('/auth/admin/setup', req)).toBe(true);
  });
});
