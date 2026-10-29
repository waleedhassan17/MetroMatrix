import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AdminRecoveryCode } from '../../auth/entities/admin-recovery-code.entity';
import { TokenService } from '../../auth/token.service';
import { PasswordHasher } from '../../auth/password-hasher';
import {
  changedFields,
  OperationalAuditService,
} from '../../../common/audit/operational-audit.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { ErrorCode } from '../../../common/errors/codes';
import { likeEscape, paged } from '../../../common/pagination/pagination';
import { temporaryPassword } from '../../../common/crypto/temp-password';
import {
  AdminPermission,
  effectivePermissions,
} from '../../../types/admin-permissions';
import {
  AdminListQueryDto,
  AdminView,
  AdminWithPasswordView,
  CreateAdminDto,
} from './admin-admins.dto';
import { assertSuperAdminRemains } from './super-admin-invariant';

const ADMIN_ROLES_IN = In(['admin', 'super_admin']);

/**
 * /admin/admins — the super admin's team. Accounts made here are always
 * `admin`, never `super_admin` (only `npm run seed:superadmin` makes those).
 *
 * Every change that alters what an admin can do — disable, permissions,
 * both resets — bumps token_version and revokes every session in the same
 * transaction, so it applies on the target's very next request.
 */
@Injectable()
export class AdminAdminsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly tokens: TokenService,
    private readonly hasher: PasswordHasher,
    private readonly audit: OperationalAuditService,
    private readonly dataSource: DataSource,
  ) {}

  async list(q: AdminListQueryDto) {
    const qb = this.users
      .createQueryBuilder('u')
      .where(`u.role IN ('admin', 'super_admin')`)
      .andWhere(`u.status <> 'deleted'`);
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.status) qb.andWhere('u.status = :status', { status: q.status });
    if (q.q) {
      qb.andWhere('(u.email ILIKE :q OR u.display_name ILIKE :q)', {
        q: `%${likeEscape(q.q)}%`,
      });
    }
    const [rows, total] = await qb
      .orderBy('u.role', 'DESC')
      .addOrderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize)
      .getManyAndCount();
    return paged(rows.map(adminView), total, q);
  }

  async get(id: string): Promise<AdminView> {
    return adminView(await this.findAdmin(id));
  }

  async create(dto: CreateAdminDto): Promise<AdminWithPasswordView> {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.exists({ where: { email, status: Not('deleted') } })) {
      // Also for a customer's address: an existing account is never promoted.
      throw new ConflictException({
        code: ErrorCode.EMAIL_EXISTS,
        message: 'An account with this email already exists.',
      });
    }
    const password = temporaryPassword();
    const permissions = normalize(dto.permissions);
    const admin = await this.users.save(
      this.users.create({
        email,
        displayName: dto.displayName,
        passwordHash: await this.hasher.hash(password),
        role: 'admin',
        adminPermissions: permissions,
        isEmailVerified: true,
        status: 'active',
        mustChangePassword: true,
        totpEnabled: false,
      }),
    );
    await this.audit.record({
      action: 'admin.create',
      targetType: 'user',
      targetId: admin.id,
      before: null,
      after: {
        email,
        displayName: dto.displayName,
        role: 'admin',
        permissions,
      },
    });
    return { admin: adminView(admin), temporaryPassword: password };
  }

  async updatePermissions(
    actor: AuthenticatedUser,
    id: string,
    next: AdminPermission[],
  ): Promise<AdminView> {
    const target = await this.findAdmin(id);
    assertNotSelf(actor, target);
    if (target.role === 'super_admin') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: 'A super admin already holds every permission.',
      });
    }
    const before = normalize(target.adminPermissions);
    const after = normalize(next);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await this.revokingTx(target, { adminPermissions: after });
      target.adminPermissions = after;
      await this.audit.record({
        action: 'admin.permissions',
        targetType: 'user',
        targetId: target.id,
        before: { permissions: before },
        after: { permissions: after },
      });
    }
    return adminView(target);
  }

  async disable(
    actor: AuthenticatedUser,
    id: string,
    reason?: string,
  ): Promise<AdminView> {
    const target = await this.findAdmin(id);
    assertNotSelf(actor, target);
    if (target.status === 'active') {
      await this.revokingTx(target, { status: 'disabled' }, async (m) => {
        if (target.role === 'super_admin') {
          await assertSuperAdminRemains(m, target.id);
        }
      });
      target.status = 'disabled';
      await this.audit.record({
        action: 'admin.disable',
        targetType: 'user',
        targetId: target.id,
        details: { reason: reason ?? null },
        before: { status: 'active' },
        after: { status: 'disabled' },
      });
    }
    return adminView(target);
  }

  async enable(actor: AuthenticatedUser, id: string): Promise<AdminView> {
    const target = await this.findAdmin(id);
    assertNotSelf(actor, target);
    if (target.status === 'disabled') {
      await this.users.update({ id: target.id }, { status: 'active' });
      target.status = 'active';
      await this.audit.record({
        action: 'admin.enable',
        targetType: 'user',
        targetId: target.id,
        before: { status: 'disabled' },
        after: { status: 'active' },
      });
    }
    return adminView(target);
  }

  async resetPassword(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<AdminWithPasswordView> {
    const target = await this.findAdmin(id);
    assertNotSelf(actor, target);
    const password = temporaryPassword();
    await this.revokingTx(target, {
      passwordHash: await this.hasher.hash(password),
      mustChangePassword: true,
    });
    const was = target.mustChangePassword;
    target.mustChangePassword = true;
    await this.audit.record({
      action: 'admin.reset_password',
      targetType: 'user',
      targetId: target.id,
      // The password itself never reaches the audit trail.
      details: { passwordReset: true },
      before: { mustChangePassword: was },
      after: { mustChangePassword: true },
    });
    return { admin: adminView(target), temporaryPassword: password };
  }

  /** Next sign-in enrols a new authenticator (lost phone). */
  async resetTotp(actor: AuthenticatedUser, id: string): Promise<AdminView> {
    const target = await this.findAdmin(id);
    assertNotSelf(actor, target);
    const was = target.totpEnabled;
    await this.revokingTx(
      target,
      {
        totpEnabled: false,
        totpSecretEnc: null,
        totpPendingSecretEnc: null,
        totpLastStep: null,
      },
      (m) => m.delete(AdminRecoveryCode, { userId: target.id }).then(() => {}),
    );
    target.totpEnabled = false;
    await this.audit.record({
      action: 'admin.reset_totp',
      targetType: 'user',
      targetId: target.id,
      ...changedFields({ totpEnabled: was }, { totpEnabled: false }),
    });
    return adminView(target);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Apply `changes`, bump token_version and revoke every refresh family, in
   * one transaction (`extra` runs first, inside it).
   */
  private async revokingTx(
    target: User,
    changes: Partial<User>,
    extra?: (m: EntityManager) => Promise<void>,
  ): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      if (extra) await extra(m);
      await m.update(
        User,
        { id: target.id },
        { ...changes, tokenVersion: () => 'token_version + 1' },
      );
      await this.tokens.revokeAllForUser(target.id, undefined, m);
    });
  }

  private async findAdmin(id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id, role: ADMIN_ROLES_IN, status: Not('deleted') },
    });
    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.NOT_FOUND,
        message: 'Admin not found.',
      });
    }
    return user;
  }
}

export function adminView(u: User): AdminView {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    isSuperAdmin: u.role === 'super_admin',
    permissions: effectivePermissions(u),
    totpEnabled: u.totpEnabled,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export function assertNotSelf(actor: AuthenticatedUser, target: User): void {
  if (actor.id === target.id) {
    throw new ForbiddenException({
      code: ErrorCode.SELF_ACTION_FORBIDDEN,
      message: 'You cannot change your own account from here.',
    });
  }
}

/** Sorted, de-duplicated: stable for comparisons and the audit trail. */
function normalize(
  keys: readonly string[] | null | undefined,
): AdminPermission[] {
  return [...new Set(keys ?? [])].sort() as AdminPermission[];
}
