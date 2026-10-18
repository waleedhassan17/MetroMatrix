import { Injectable, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AI_FEATURES, AiFeature } from './ai-settings';

export interface PromptDef {
  id: string;
  version: number;
  feature: AiFeature;
  title: string;
  text: string;
}

/** `---\nid: x\nversion: 1\nfeature: voice\ntitle: …\n---\n<system prompt>` */
export function parsePrompt(raw: string, file: string): PromptDef {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(
    raw.replace(/\r\n/g, '\n'),
  );
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const version = parseInt(meta.version ?? '', 10);
  if (!meta.id || !Number.isInteger(version) || version < 1)
    throw new Error(`${file}: id and a positive integer version are required`);
  if (!(AI_FEATURES as readonly string[]).includes(meta.feature))
    throw new Error(`${file}: unknown feature "${meta.feature}"`);
  return {
    id: meta.id,
    version,
    feature: meta.feature as AiFeature,
    title: meta.title ?? meta.id,
    text: m[2].trim(),
  };
}

export const PROMPTS_DIR = join(__dirname, 'prompts');

/**
 * Prompts live in ai/prompts/*.md, each with an id and a version (logged
 * with every call in ai_usage). Loaded once at boot; a broken file fails
 * the boot rather than a request.
 */
@Injectable()
export class PromptRegistry implements OnModuleInit {
  private readonly prompts = new Map<string, PromptDef>();

  onModuleInit(): void {
    this.load(PROMPTS_DIR);
  }

  load(dir: string): void {
    if (!existsSync(dir)) throw new Error(`AI prompts folder missing: ${dir}`);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()) {
      const def = parsePrompt(readFileSync(join(dir, file), 'utf8'), file);
      if (this.prompts.has(def.id))
        throw new Error(`duplicate prompt id ${def.id}`);
      this.prompts.set(def.id, def);
    }
  }

  get(id: string): PromptDef {
    const p = this.prompts.get(id);
    if (!p) throw new Error(`unknown prompt ${id}`);
    return p;
  }

  list(): Array<Omit<PromptDef, 'text'> & { length: number }> {
    return [...this.prompts.values()].map(({ text, ...rest }) => ({
      ...rest,
      length: text.length,
    }));
  }
}
