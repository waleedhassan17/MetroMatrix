import { SetMetadata } from '@nestjs/common';

export const STEP_UP_KEY = 'requireStepUp';

/**
 * A sensitive admin write: the body must carry `totpCode`, a fresh code from
 * the actor's own authenticator (never one already used). StepUpGuard checks
 * it: 403 STEP_UP_REQUIRED when missing, 403 TOTP_INVALID when wrong or
 * reused.
 */
export const RequireStepUp = () => SetMetadata(STEP_UP_KEY, true);
