import {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProvider,
  AiProviderError,
} from '../../src/modules/ai/providers/ai-provider';
import {
  FetchedAsset,
  MediaStorage,
} from '../../src/modules/media/media-storage';
import { AiSettings } from '../../src/modules/ai/ai-settings';
import type { TestApp } from './test-app';

type Answer =
  | string
  | object
  | Error
  | ((req: AiGenerateRequest) => string | object)
  | { delayMs: number };

/**
 * The model, scripted. Tests queue answers (objects are sent as JSON,
 * strings as-is, Errors are thrown, `{ delayMs }` waits until aborted);
 * every request is recorded. Nothing ever reaches Gemini from a test run.
 */
export class FakeAiProvider extends AiProvider {
  readonly name = 'fake';
  on = true;
  readonly calls: AiGenerateRequest[] = [];
  private queue: Answer[] = [];
  /** Answered when the queue is empty. */
  fallback: Answer = { error: 'no scripted answer' };

  available(): boolean {
    return this.on;
  }

  answer(...answers: Answer[]): this {
    this.queue.push(...answers);
    return this;
  }

  reset(): void {
    this.queue = [];
    this.calls.length = 0;
    this.on = true;
  }

  /** The JSON input of the last call (the text part). */
  lastInput(): Record<string, unknown> {
    const req = this.calls[this.calls.length - 1];
    const text = req.parts.find((p) => 'text' in p) as { text: string };
    return JSON.parse(text.text.split('\n\nYour previous answer')[0]);
  }

  async generate(req: AiGenerateRequest): Promise<AiGenerateResponse> {
    this.calls.push(req);
    const next = this.queue.length ? this.queue.shift()! : this.fallback;
    if (next instanceof Error) throw next;
    if (typeof next === 'object' && 'delayMs' in next) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, (next as { delayMs: number }).delayMs);
        req.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new AiProviderError('timeout', 'aborted'));
        });
      });
      return { text: '{}', tokensIn: 1, tokensOut: 1, model: 'fake' };
    }
    const out = typeof next === 'function' ? next(req) : next;
    return {
      text: typeof out === 'string' ? out : JSON.stringify(out),
      tokensIn: 12,
      tokensOut: 8,
      model: 'fake',
    };
  }
}

/** Uploaded files, in memory: tests "upload" bytes under a URL; deletes are recorded. */
export class FakeMediaStorage extends MediaStorage {
  readonly files = new Map<string, FetchedAsset>();
  readonly destroyed: string[] = [];
  failDestroy = false;

  put(url: string, bytes = Buffer.from('fake-audio'), mimeType = 'audio/mp4') {
    this.files.set(url, { bytes, mimeType });
  }

  async fetch(url: string, maxBytes: number) {
    const f = this.files.get(url);
    if (!f) return null;
    return f.bytes.length > maxBytes ? ('too_large' as const) : f;
  }

  async destroy(url: string) {
    if (this.failDestroy) return false;
    this.destroyed.push(url);
    this.files.delete(url);
    return true;
  }
}

export interface AiFakes {
  ai: FakeAiProvider;
  storage: FakeMediaStorage;
}

/** `createTestApp({ override: withFakeAi(fakes) })` */
export function fakeAi(): AiFakes {
  return { ai: new FakeAiProvider(), storage: new FakeMediaStorage() };
}

export const withFakeAi =
  (f: AiFakes) => (b: import('@nestjs/testing').TestingModuleBuilder) =>
    b
      .overrideProvider(AiProvider)
      .useValue(f.ai)
      .overrideProvider(MediaStorage)
      .useValue(f.storage);

/** Flip the kill switch / feature list for one test (restore afterwards). */
export function aiSettings(t: TestApp): AiSettings {
  return t.app.get(AiSettings);
}

let clip = 0;
/** A shape-correct private voice_audio upload URL for this user. */
export function voiceClip(userId: string, ext = 'm4a') {
  clip += 1;
  const publicId = `metromatrix/test/${userId}/voice_audio/v${clip}`;
  return {
    url: `https://res.cloudinary.com/metromatrix-test/video/authenticated/s--Ab12_cd-9--/v1712345678/${publicId}.${ext}`,
    publicId,
  };
}
