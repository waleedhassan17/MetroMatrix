import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlansModule } from '../plans/plans.module';
import { MediaModule } from '../media/media.module';
import { AiUsage } from './entities/ai-usage.entity';
import { AiCacheEntry } from './entities/ai-cache.entity';
import { VoiceLog } from './entities/voice-log.entity';
import { AiSettings } from './ai-settings';
import { AiProvider } from './providers/ai-provider';
import { GeminiProvider } from './providers/gemini.provider';
import {
  GeminiCombinedSpeech,
  GoogleSpeechToText,
  GoogleTextToSpeech,
  NoTextToSpeech,
  SpeechToText,
  TextToSpeech,
} from './providers/speech';
import { PromptRegistry } from './prompt-registry';
import { AiQuotaService } from './ai-quota.service';
import { AiService } from './ai.service';
import { AiJobsService } from './ai-jobs.service';
import { VoiceContexts } from './voice/voice-contexts';
import { VoiceService } from './voice/voice.service';
import { AiController } from './ai.controller';
import { AiAdminController } from './ai-admin.controller';

/**
 * The optional AI layer (Chunk 5): one provider (Gemini by default), the
 * prompt registry, quotas, usage, cache and the voice pipeline. Global so
 * kitchen, food-growth, nutrition and my-kitchen inject AiService and
 * register voice contexts without importing each other. Nothing depends on
 * the model answering: every caller has a manual path.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AiUsage, AiCacheEntry, VoiceLog]),
    PlansModule,
    MediaModule,
  ],
  controllers: [AiController, AiAdminController],
  providers: [
    AiSettings,
    {
      provide: AiProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new GeminiProvider(config),
    },
    {
      provide: SpeechToText,
      inject: [ConfigService, AiSettings],
      useFactory: (config: ConfigService, s: AiSettings) =>
        s.sttProvider === 'google'
          ? new GoogleSpeechToText(config)
          : new GeminiCombinedSpeech(),
    },
    {
      provide: TextToSpeech,
      inject: [ConfigService, AiSettings],
      useFactory: (config: ConfigService, s: AiSettings) =>
        s.ttsProvider === 'google'
          ? new GoogleTextToSpeech(config)
          : new NoTextToSpeech(),
    },
    PromptRegistry,
    AiQuotaService,
    AiService,
    AiJobsService,
    VoiceContexts,
    VoiceService,
  ],
  exports: [
    AiSettings,
    AiService,
    AiQuotaService,
    PromptRegistry,
    VoiceContexts,
    TextToSpeech,
  ],
})
export class AiModule {}
