import {
  isRoleAllowedOnPortal,
  PORTAL_ROLES,
  SIGNIN_PORTALS,
  wrongPortalMessage,
} from './signin-portal';
import { USER_ROLES } from '../../types';

describe('signin portals', () => {
  it('admits each role on exactly the doors the spec gives it', () => {
    expect(PORTAL_ROLES).toEqual({
      customer: ['customer'],
      partner: ['partner'],
      admin: ['admin', 'super_admin'],
    });
  });

  it('keeps a partner out of the customer door and vice versa', () => {
    expect(isRoleAllowedOnPortal('customer', 'partner')).toBe(false);
    expect(isRoleAllowedOnPortal('partner', 'customer')).toBe(false);
    expect(isRoleAllowedOnPortal('customer', 'admin')).toBe(false);
    expect(isRoleAllowedOnPortal('admin', 'super_admin')).toBe(true);
  });

  it('never admits a rider through any Chunk 1 door', () => {
    for (const portal of SIGNIN_PORTALS) {
      expect(isRoleAllowedOnPortal(portal, 'rider')).toBe(false);
    }
  });

  it('names the right door for every role', () => {
    expect(wrongPortalMessage('partner')).toMatch(/partner portal/);
    expect(wrongPortalMessage('customer')).toMatch(/customer/);
    expect(wrongPortalMessage('super_admin')).toMatch(/admin console/);
    for (const role of USER_ROLES) {
      expect(wrongPortalMessage(role)).not.toBe('');
    }
  });
});
