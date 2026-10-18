import { registerAs } from '@nestjs/config';

export default registerAs('integrations', () => ({
  /** Web, Android and iOS OAuth client ids; an ID token must name one of them. */
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
  video: {
    provider: (process.env.VIDEO_PROVIDER || 'public_jitsi') as
      'public_jitsi' | 'jaas',
    jaas: {
      appId: process.env.JAAS_APP_ID ?? '',
      kid: process.env.JAAS_KID ?? '',
      // One-line env vars carry the PEM's newlines as "\n".
      privateKey: (process.env.JAAS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    },
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    /** Only the voice-eval script synthesises clips. */
    ttsModel: process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts',
  },
  ai: {
    /** The kitchen AI / voice model (the symptom checker keeps gemini.model). */
    model: process.env.AI_MODEL || 'gemini-3.8-flash',
    /** The kill switch: false turns every AI feature to its manual path. */
    enabled: (process.env.AI_ENABLED ?? 'true').toLowerCase() !== 'false',
    /** Comma-separated feature names, or "all". */
    features: (process.env.AI_FEATURES || 'all')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '12000', 10),
    /** gemini (default) or google (Cloud Speech-to-Text, ur-PK / en-PK). */
    sttProvider: (process.env.STT_PROVIDER || 'gemini') as 'gemini' | 'google',
    /** none (the app speaks on-device) or google (Cloud Text-to-Speech). */
    ttsProvider: (process.env.TTS_PROVIDER || 'none') as 'none' | 'google',
    googleCloudApiKey: process.env.GOOGLE_CLOUD_API_KEY ?? '',
  },
}));
