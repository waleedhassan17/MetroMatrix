import { User } from '../users/entities/user.entity';
import { UserRole } from '../../types';
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
  };
}
