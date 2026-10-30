import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserDevice } from '../users/entities/user-device.entity';
import { UsersService } from '../users/users.service';
import { TokenPair, TokenService } from './token.service';
import { ClientInfo } from '../../common/decorators/client-info.decorator';
import { PasswordHasher } from './password-hasher';
import { GoogleTokenVerifier } from './google-token-verifier';
import { OperationalAuditService } from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';
import { DeleteAccountDto } from './dto/password.dto';

/**
 * Hooks other modules register to clean up after an account is deleted
 * (devices, businesses). Run inside the deletion transaction.
 */
export type AccountDeletionHook = (
  manager: EntityManager,
  user: User,
) => Promise<void>;

/** Changes to the signed-in account itself: password, deletion. */
@Injectable()
export class AccountService {
  private readonly deletionHooks: AccountDeletionHook[] = [];

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly hasher: PasswordHasher,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
    private readonly google: GoogleTokenVerifier,
  ) {}

  onAccountDeleted(hook: AccountDeletionHook): void {
    this.deletionHooks.push(hook);
  }

  /**
   * Change (or, for a Google-only account, set) the password, proven with the
   * current password or, without one, a fresh Google ID token.
   *
   * Every session ends at once, this one included, in one transaction: the
   * hash changes, token_version moves on (so every access token is refused
   * on its next request, not up to 15 minutes later) and every refresh
   * family is revoked. This device carries on with the new pair returned
   * here, in a new family.
   */
  async changePassword(
    userId: string,
    input: { currentPassword?: string; newPassword: string; idToken?: string },
    client: ClientInfo,
  ): Promise<{ changed: true; tokens: TokenPair }> {
    const user = await this.users.getByIdOrFail(userId);
    const hadPassword = !!user.passwordHash;
    await this.reauthenticate(user, {
      password: input.currentPassword,
      idToken: input.idToken,
    });
    const passwordHash = await this.hasher.hash(input.newPassword);

    const tokens = await this.dataSource.transaction(async (m) => {
      await m.update(
        User,
        { id: user.id },
        { passwordHash, tokenVersion: () => 'token_version + 1' },
      );
      await this.tokens.revokeAllForUser(user.id, undefined, m);
      // Signed with the new token_version.
      const fresh = await m.findOneOrFail(User, { where: { id: user.id } });
      return this.tokens.startSession(fresh, client, m);
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: user.id,
      details: { firstPassword: !hadPassword },
    });
    return { changed: true, tokens };
  }

  /**
   * Google Play's account-deletion requirement. The row stays (audit trail,
   * foreign keys) but everything identifying is wiped, every session dies,
   * and the email address is free to sign up again.
   */
  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<{ deleted: true }> {
    const user = await this.users.getByIdOrFail(userId);
    await this.reauthenticate(user, dto);

    await this.dataSource.transaction(async (m) => {
      await m.update(
        User,
        { id: user.id },
        {
          status: 'deleted',
          deletedAt: new Date(),
          email: `deleted+${user.id}@deleted.metromatrix`,
          phone: null,
          displayName: null,
          username: null,
          googleSub: null,
          avatarUrl: null,
          passwordHash: null,
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabled: false,
          tokenVersion: () => 'token_version + 1',
        },
      );
      await this.tokens.revokeAllForUser(user.id, undefined, m);
      // No more push notifications to a deleted account.
      await m.delete(UserDevice, { userId: user.id });
      for (const hook of this.deletionHooks) await hook(m, user);
    });

    await this.audit.record({
      actorUserId: user.id,
      action: 'auth.account_deleted',
      targetType: 'user',
      targetId: user.id,
      details: { role: user.role },
    });
    return { deleted: true };
  }

  /**
   * Changing the password and deleting the account need proof beyond a
   * (possibly stolen) session: the password, or for a Google-only account a
   * fresh ID token for the linked Google account. 403, not 401: a 401 would
   * send the app off to refresh its token.
   */
  private async reauthenticate(
    user: User,
    dto: { password?: string; idToken?: string },
  ) {
    const refuse = (message: string) =>
      new ForbiddenException({ code: ErrorCode.INVALID_CREDENTIALS, message });

    if (user.passwordHash) {
      const ok =
        !!dto.password &&
        (await this.hasher.verify(dto.password, user.passwordHash));
      if (!ok) throw refuse('Your password is incorrect.');
      return;
    }
    if (!dto.idToken || !user.googleSub) {
      throw refuse('Sign in with Google again to confirm.');
    }
    const google = await this.google.verify(dto.idToken);
    if (google.sub !== user.googleSub) {
      throw refuse('That Google account does not match this account.');
    }
  }
}
