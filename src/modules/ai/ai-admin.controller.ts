import {
  AiAdminListPromptsView,
  AiAdminSettingsViewView,
  AiAdminUsageView,
} from './ai-admin.response';
import { ApiEnvelopeOk } from '../../common/swagger/api-envelope';
import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AiSettings } from './ai-settings';
import { AiProvider } from './providers/ai-provider';
import { PromptRegistry } from './prompt-registry';

export class AiUsageQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days: number = 30;
}

/**
 * Staff: what the AI layer did (Chunk 5, P12) — by feature, by business,
 * the latest failures, latency and tokens; the prompt versions with their
 * calls; and the switches (never a key). Allowance overrides stay on the
 * vendor plan (`PATCH /admin/food/vendors/:id/plan`).
 */
@ApiTags('admin · ai')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@RequirePermission('manageKitchen')
@Controller('admin/ai')
export class AiAdminController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly prompts: PromptRegistry,
    private readonly settings: AiSettings,
    private readonly provider: AiProvider,
    private readonly config: ConfigService,
  ) {}

  @Get('usage')
  @ApiOperation({
    summary:
      '?days (30) → totals, byFeature (statuses, p50/p95 latency), top businesses, recent failures.',
  })
  @ApiEnvelopeOk(AiAdminUsageView)
  async usage(@Query() q: AiUsageQueryDto) {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const [[totals], byFeature, byBusiness, failures] = await Promise.all([
      this.dataSource.query(
        `SELECT count(*)::int AS calls, count(*) FILTER (WHERE status = 'ok')::int AS ok,
                count(*) FILTER (WHERE cached)::int AS cached,
                count(*) FILTER (WHERE status <> 'ok')::int AS failures,
                coalesce(sum(tokens_in), 0)::int AS "tokensIn", coalesce(sum(tokens_out), 0)::int AS "tokensOut",
                coalesce(sum(audio_seconds), 0)::int AS "audioSeconds"
           FROM ai_usage WHERE created_at >= $1`,
        [since],
      ),
      this.dataSource.query(
        `SELECT feature, count(*)::int AS calls,
                count(*) FILTER (WHERE status = 'ok')::int AS ok,
                count(*) FILTER (WHERE cached)::int AS cached,
                count(*) FILTER (WHERE status = 'invalid')::int AS invalid,
                count(*) FILTER (WHERE status = 'timeout')::int AS timeout,
                count(*) FILTER (WHERE status = 'quota')::int AS quota,
                count(*) FILTER (WHERE status = 'error')::int AS error,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE NOT cached))::int AS "p50Ms",
                round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE NOT cached))::int AS "p95Ms",
                coalesce(sum(tokens_in + tokens_out), 0)::int AS tokens
           FROM ai_usage WHERE created_at >= $1 GROUP BY feature ORDER BY calls DESC, feature`,
        [since],
      ),
      this.dataSource.query(
        `SELECT u.business_id AS "businessId", b.name, count(*)::int AS calls,
                count(*) FILTER (WHERE u.status <> 'ok')::int AS failures
           FROM ai_usage u LEFT JOIN businesses b ON b.id = u.business_id
          WHERE u.created_at >= $1 AND u.business_id IS NOT NULL
          GROUP BY u.business_id, b.name ORDER BY calls DESC LIMIT 20`,
        [since],
      ),
      this.dataSource.query(
        `SELECT created_at AS at, feature, prompt_id AS "promptId", prompt_version AS "promptVersion", status,
                latency_ms AS "latencyMs", business_id AS "businessId"
           FROM ai_usage WHERE created_at >= $1 AND status NOT IN ('ok', 'quota')
          ORDER BY created_at DESC LIMIT 20`,
        [since],
      ),
    ]);
    return { days: q.days, totals, byFeature, byBusiness, failures };
  }

  @Get('prompts')
  @ApiOperation({
    summary:
      'Every prompt (id, version, feature, title, length) with its calls in the last 30 days.',
  })
  @ApiEnvelopeOk(AiAdminListPromptsView)
  async listPrompts() {
    const calls: Array<{
      prompt_id: string;
      prompt_version: number;
      calls: number;
      ok: number;
    }> = await this.dataSource.query(
      `SELECT prompt_id, prompt_version, count(*)::int AS calls, count(*) FILTER (WHERE status = 'ok')::int AS ok
           FROM ai_usage WHERE created_at >= now() - interval '30 days' GROUP BY prompt_id, prompt_version`,
    );
    return {
      items: this.prompts.list().map((p) => {
        const mine = calls.filter((c) => c.prompt_id === p.id);
        return {
          ...p,
          calls30d:
            mine.find((c) => c.prompt_version === p.version)?.calls ?? 0,
          ok30d: mine.find((c) => c.prompt_version === p.version)?.ok ?? 0,
          olderVersionCalls30d: mine
            .filter((c) => c.prompt_version !== p.version)
            .reduce((s, c) => s + c.calls, 0),
        };
      }),
    };
  }

  @Get('settings')
  @ApiOperation({ summary: 'The switches as the server runs them (no keys).' })
  @ApiEnvelopeOk(AiAdminSettingsViewView)
  settingsView() {
    return {
      enabled: this.settings.enabled,
      features:
        this.settings.features === 'all' ? 'all' : [...this.settings.features],
      timeoutMs: this.settings.timeoutMs,
      model: this.config.get<string>('integrations.ai.model') ?? null,
      providerConfigured: this.provider.available(),
      sttProvider: this.settings.sttProvider,
      ttsProvider: this.settings.ttsProvider,
    };
  }
}
