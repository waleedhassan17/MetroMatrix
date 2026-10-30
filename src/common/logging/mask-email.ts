/**
 * `jane.doe@example.com` → `j***@e***.com`, for log lines in production: the
 * line still tells two recipients apart, without keeping the address.
 * Anything that isn't an address comes back as `***`.
 */
export function maskEmail(email: string | null | undefined): string {
  const at = (email ?? '').trim().lastIndexOf('@');
  if (at < 1) return '***';
  const value = (email ?? '').trim();
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (!domain || dot < 1) return `${local[0]}***@***`;
  return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`;
}
