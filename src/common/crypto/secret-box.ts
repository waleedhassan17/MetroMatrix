import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM for small secrets at rest (admin TOTP seeds). The key is
 * TOTP_ENC_KEY: 32 random bytes, base64. Output: `v1.<iv>.<tag>.<ciphertext>`,
 * each base64url — self-describing, so the format can change later.
 *
 * GCM authenticates: a tampered value fails to open rather than decrypting to
 * garbage.
 */
const VERSION = 'v1';

function keyFrom(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return key;
}

export function seal(plaintext: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function open(sealed: string, keyB64: string): string {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new Error('Unrecognised sealed value');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(keyB64),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
