import { JwtService } from '@nestjs/jwt';

export interface VideoParticipant {
  id: string;
  name: string;
  email?: string | null;
  avatar?: string | null;
  moderator: boolean;
}

export interface VideoJoin {
  provider: 'public_jitsi' | 'jaas';
  /** For the Jitsi IFrame API / mobile SDK: domain + roomName (+ jwt). */
  domain: string;
  roomName: string;
  /** Opens the call in a browser. */
  joinUrl: string;
  jwt: string | null;
  /** When the room token stops admitting (null: no token). */
  expiresAt: string | null;
  moderator: boolean;
}

/** Room names are unguessable: mm-<appointment video_room uuid>. */
export const roomName = (videoRoom: string) => `mm-${videoRoom}`;

/** A room token is never valid for more than this. */
export const MAX_TOKEN_MS = 2 * 60 * 60_000;

/**
 * Where a video consultation happens. Chosen by VIDEO_PROVIDER; tests swap
 * it. Only participants ever get here (the services 404 everyone else).
 */
export abstract class VideoProvider {
  abstract readonly name: 'public_jitsi' | 'jaas';
  abstract join(
    videoRoom: string,
    who: VideoParticipant,
    until: Date,
    now?: Date,
  ): VideoJoin;
}

/**
 * meet.jit.si — free, for development and demos. Since August 2023 the
 * person who opens a room must sign in (Google/GitHub/Facebook) to become
 * its moderator; guests join without an account. Nothing is signed.
 */
export class PublicJitsiProvider extends VideoProvider {
  readonly name = 'public_jitsi' as const;

  join(videoRoom: string, who: VideoParticipant): VideoJoin {
    const room = roomName(videoRoom);
    const display = encodeURIComponent(JSON.stringify(who.name));
    return {
      provider: this.name,
      domain: 'meet.jit.si',
      roomName: room,
      joinUrl: `https://meet.jit.si/${room}#userInfo.displayName=${display}`,
      jwt: null,
      expiresAt: null,
      moderator: who.moderator,
    };
  }
}

export interface JaasConfig {
  appId: string;
  kid: string;
  privateKey: string;
}

/**
 * 8x8 Jitsi as a Service: an RS256 room token per participant (doctor =
 * moderator), valid for this room only and never beyond the join window or
 * two hours. Claims per developer.8x8.com/jaas/docs/api-keys-jwt.
 */
export class JaasProvider extends VideoProvider {
  readonly name = 'jaas' as const;

  constructor(
    private readonly config: JaasConfig,
    private readonly jwt: JwtService = new JwtService(),
  ) {
    super();
    if (!config.appId || !config.kid.startsWith(`${config.appId}/`))
      throw new Error('JAAS_KID must be "<JAAS_APP_ID>/<key id>"');
    if (!config.privateKey.includes('PRIVATE KEY'))
      throw new Error('JAAS_PRIVATE_KEY must be a PEM private key');
  }

  join(
    videoRoom: string,
    who: VideoParticipant,
    until: Date,
    now = new Date(),
  ): VideoJoin {
    const room = roomName(videoRoom);
    const nowS = Math.floor(now.getTime() / 1000);
    const exp = Math.floor(
      Math.min(until.getTime(), now.getTime() + MAX_TOKEN_MS) / 1000,
    );
    const no = 'false';
    const token = this.jwt.sign(
      {
        aud: 'jitsi',
        iss: 'chat',
        sub: this.config.appId,
        room,
        nbf: nowS - 10,
        exp,
        context: {
          user: {
            id: who.id,
            name: who.name,
            avatar: who.avatar ?? '',
            email: who.email ?? '',
            moderator: who.moderator ? 'true' : 'false',
          },
          // A consultation is private: nothing leaves the call.
          features: {
            livestreaming: no,
            recording: no,
            transcription: no,
            'outbound-call': no,
            'sip-outbound-call': no,
          },
        },
      },
      {
        algorithm: 'RS256',
        privateKey: this.config.privateKey,
        keyid: this.config.kid,
        noTimestamp: false,
      },
    );
    return {
      provider: this.name,
      domain: '8x8.vc',
      roomName: `${this.config.appId}/${room}`,
      joinUrl: `https://8x8.vc/${this.config.appId}/${room}?jwt=${token}`,
      jwt: token,
      expiresAt: new Date(exp * 1000).toISOString(),
      moderator: who.moderator,
    };
  }
}
