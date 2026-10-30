import { User } from '../users/entities/user.entity';
import { UserGender, UserRole } from '../../types';
import { TokenPair } from './token.service';

/** The user as every client sees it. Never carries hashes or secrets. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  phone: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  /** False for Google-only accounts — the app offers "set a password". */
  hasPassword: boolean;
  /** Customer profile (PATCH /users/me/profile); null until given. */
  dateOfBirth: string | null;
  gender: UserGender | null;
  streetAddress: string | null;
  city: string | null;
  postalCode: string | null;
  /**
   * True for every non-customer. A customer's is true once date of birth,
   * gender, street address and city are all set.
   */
  profileComplete: boolean;
  /** Customers from before the profile existed: the app may let them skip. */
  profileSkippable: boolean;
}

/** A partner's business as the auth responses summarise it (null otherwise). */
export interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  serviceType: string;
  subType: string;
  status: string;
  rejectionReason: string | null;
  suspensionReason: string | null;
  submittedAt: Date | null;
  /** Doctors only (API_HEALTH.md A1): patients can find them; staff checked the PMDC number. */
  isListed?: boolean;
  pmdcVerified?: boolean;
}

/** GET /auth/me — and the body of AuthResult minus tokens. */
export interface AccountView {
  user: AuthUser;
  business: BusinessSummary | null;
}

/** signup, signin, Google, admin TOTP. */
export interface AuthResult extends AccountView {
  tokens: TokenPair;
}

/** Admin portal step 1: the password was right; now prove the second factor. */
export interface TotpChallengeResult {
  totpRequired: true;
  /** True until this admin has enrolled an authenticator. */
  enrolmentRequired: boolean;
  /** 5 minutes. For /auth/admin/totp, or /admin/me/totp/* while enrolling. */
  challengeToken: string;
}

/** The profile fields a customer must give before using the app. */
export function isProfileComplete(user: User): boolean {
  if (user.role !== 'customer') return true;
  return !!(user.dateOfBirth && user.gender && user.streetAddress && user.city);
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    isEmailVerified: user.isEmailVerified,
    hasPassword: !!user.passwordHash,
    dateOfBirth: user.dateOfBirth ?? null,
    gender: user.gender ?? null,
    streetAddress: user.streetAddress ?? null,
    city: user.city ?? null,
    postalCode: user.postalCode ?? null,
    profileComplete: isProfileComplete(user),
    profileSkippable: user.role === 'customer' && !!user.profileSkippable,
  };
}
