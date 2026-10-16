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
  },
}));
