import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { PlatformSetting } from './entities/platform-setting.entity';
import {
  checkSetting,
  DEFAULT_SETTINGS,
  isSettingKey,
  publicConfig,
  SETTING_KEYS,
  SettingKey,
  settingsSchema,
  SettingsValues,
} from './settings-schema';
import { User } from '../users/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { GoogleAuthService } from '../auth/google-auth.service';
import { AiSettings } from '../ai/ai-settings';
import {
  changedFields,
  OperationalAuditService,
} from '../../common/audit/operational-audit.service';
import { ErrorCode } from '../../common/errors/codes';

/** Long enough to spare the database a read per request; short enough that a
 * switch flipped on another dyno applies within seconds. */
const CACHE_MS = 10_000;

export interface SettingChange {
  by: { id: string; email: string; displayName: string | null } | null;
  at: Date;
}

/**
 * Reads, caches, changes and enforces the platform settings. Enforcement
 * reaches other modules through hooks set at module init (the repo's usual
 * way to avoid circular imports): sign-up gates on AuthService and
 * GoogleAuthService, and the AI kill switch on AiSettings.
 */
@Injectable()
export class PlatformSettingsService implements OnModuleInit {
  private cache: { values: SettingsValues; at: number } | null = null;

  constructor(
    @InjectRepository(PlatformSetting)
    private readonly repo: Repository<PlatformSetting>,
    private readonly dataSource: DataSource,
    private readonly audit: OperationalAuditService,
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
    private readonly ai: AiSettings,
  ) {}

  onModuleInit(): void {
    const gate = (role: 'customer' | 'partner') => this.assertSignupsOpen(role);
    this.auth.signupGate = gate;
    this.google.signupGate = gate;
    // AiSettings.isOn() is synchronous: it reads the last loaded snapshot,
    // which every request refreshes through PlatformGuard.
    this.ai.platformAllows = () =>
      (this.cache?.values ?? DEFAULT_SETTINGS)['ai.enabled'] !== false;
  }

  async values(): Promise<SettingsValues> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.values;
    }
    const rows = await this.repo.find({ where: { key: In(SETTING_KEYS) } });
    const values = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      if (isSettingKey(r.key)) values[r.key] = r.value as boolean | string;
    }
    this.cache = { values, at: Date.now() };
    return values;
  }

  async publicConfig() {
    return publicConfig(await this.values());
  }

  /** GET /admin/settings: values, the schema, and who changed each one last. */
  async detail() {
    this.cache = null;
    const values = await this.values();
    const rows = await this.repo
      .createQueryBuilder('s')
      .leftJoin(User, 'u', 'u.id = s.updated_by')
      .select([
        's.key AS key',
        's.updated_at AS at',
        'u.id AS user_id',
        'u.email AS email',
        'u.display_name AS display_name',
      ])
      .getRawMany<{
        key: string;
        at: Date;
        user_id: string | null;
        email: string | null;
        display_name: string | null;
      }>();
    const lastChanged: Partial<Record<SettingKey, SettingChange>> = {};
    for (const r of rows) {
      if (!isSettingKey(r.key)) continue;
      lastChanged[r.key] = {
        by: r.user_id
          ? { id: r.user_id, email: r.email!, displayName: r.display_name }
          : null,
        at: r.at,
      };
    }
    return { values, schema: settingsSchema(), lastChanged };
  }

  /** PATCH /admin/settings: all-or-nothing, one audit row for the lot. */
  async update(actorId: string, changes: Record<string, unknown>) {
    const problems: Record<string, string[]> = {};
    const accepted: Partial<SettingsValues> = {};
    for (const [key, raw] of Object.entries(changes ?? {})) {
      if (!isSettingKey(key)) {
        problems[key] = ['is not a setting'];
        continue;
      }
      const check = checkSetting(key, raw);
      if (check.ok) accepted[key] = check.value;
      else problems[key] = [check.problem];
    }
    if (Object.keys(problems).length || !Object.keys(accepted).length) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: Object.keys(problems).length
          ? 'Some settings are not valid.'
          : 'Send at least one setting to change.',
        details: { fields: problems },
      });
    }

    this.cache = null;
    const before = await this.values();
    const diff = changedFields(before, { ...before, ...accepted }, [
      ...(Object.keys(accepted) as SettingKey[]),
    ]);
    if (Object.keys(diff.after).length) {
      await this.dataSource.transaction(async (m) => {
        for (const key of Object.keys(diff.after)) {
          await m
            .createQueryBuilder()
            .insert()
            .into(PlatformSetting)
            .values({
              key,
              // jsonb: TypeORM serialises the boolean or string itself.
              value: diff.after[key] as never,
              updatedBy: actorId,
            })
            .orUpdate(['value', 'updated_by', 'updated_at'], ['key'])
            .execute();
        }
      });
      await this.audit.record({
        action: 'settings.update',
        targetType: 'platform_settings',
        targetId: null,
        before: diff.before,
        after: diff.after,
      });
    }
    this.cache = null;
    return this.detail();
  }

  private async assertSignupsOpen(role: 'customer' | 'partner') {
    const v = await this.values();
    if (v[`signupsEnabled.${role}`] === false) {
      throw new ForbiddenException({
        code: ErrorCode.SIGNUPS_PAUSED,
        message:
          role === 'partner'
            ? 'New partner accounts are paused for now. Please try again later.'
            : 'New accounts are paused for now. Please try again later.',
        details: { role },
      });
    }
  }
}
