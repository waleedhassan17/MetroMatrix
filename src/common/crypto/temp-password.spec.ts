import { temporaryPassword } from './temp-password';
import { PASSWORD_REGEX } from '../validation/password';

describe('temporaryPassword', () => {
  it('is 16 characters, meets the policy and avoids look-alikes', () => {
    for (let i = 0; i < 500; i += 1) {
      const p = temporaryPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(PASSWORD_REGEX);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  it('does not repeat', () => {
    const seen = new Set(
      Array.from({ length: 200 }, () => temporaryPassword()),
    );
    expect(seen.size).toBe(200);
  });
});
