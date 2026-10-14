import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// bcryptjs (pure JS) as in FinMatrix: no native build step on Heroku/Alpine.
import * as bcrypt from 'bcryptjs';

/** The one place passwords are hashed and checked. */
@Injectable()
export class PasswordHasher {
  private readonly rounds: number;
  /** Compared against when there is no hash, so timing reveals nothing. */
  private dummyHash: Promise<string> | null = null;

  constructor(config: ConfigService) {
    this.rounds = config.get<number>('app.bcryptRounds', 12);
  }

  hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  /**
   * True only when `hash` exists and matches. With no hash (unknown email,
   * Google-only account) a real comparison still runs against a dummy, so a
   * miss costs the same time as a hit.
   */
  async verify(
    password: string,
    hash: string | null | undefined,
  ): Promise<boolean> {
    if (hash) return bcrypt.compare(password, hash);
    this.dummyHash ??= bcrypt.hash('metromatrix-timing-pad', this.rounds);
    await bcrypt.compare(password, await this.dummyHash);
    return false;
  }
}
