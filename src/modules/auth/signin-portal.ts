import { UserRole } from '../../types';

/**
 * The sign-in doors a client names when it posts /auth/signin.
 *
 * - `customer` the MetroMatrix app's shopper / patient / diner door.
 * - `partner`  stores, doctors and kitchens — and their riders (Food), who
 *              sign in with the username their vendor issued.
 * - `admin`    the platform console. Always followed by a TOTP step.
 */
export const SIGNIN_PORTALS = ['customer', 'partner', 'admin'] as const;
export type SigninPortal = (typeof SIGNIN_PORTALS)[number];

export const PORTAL_ROLES: Record<SigninPortal, readonly UserRole[]> = {
  customer: ['customer'],
  partner: ['partner', 'rider'],
  admin: ['admin', 'super_admin'],
};

export const isRoleAllowedOnPortal = (
  portal: SigninPortal,
  role: UserRole,
): boolean => PORTAL_ROLES[portal].includes(role);

/** Where this account signs in instead — shown only after the password matched. */
export function wrongPortalMessage(role: UserRole): string {
  switch (role) {
    case 'customer':
      return 'This is a customer account. Sign in on the customer side of the MetroMatrix app.';
    case 'partner':
      return 'This is a partner account. Sign in on the partner portal.';
    case 'admin':
    case 'super_admin':
      return 'This is an admin account. Sign in on the MetroMatrix admin console.';
    case 'rider':
      return 'This is a rider account. Riders sign in on the partner side of the MetroMatrix app with their username.';
    default:
      return 'This account cannot sign in here.';
  }
}
