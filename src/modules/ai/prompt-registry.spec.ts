import { parsePrompt, PromptRegistry, PROMPTS_DIR } from './prompt-registry';

describe('prompt registry', () => {
  it('parses front matter', () => {
    expect(
      parsePrompt(
        '---\nid: x\nversion: 2\nfeature: voice\ntitle: X\n---\nHello',
        'x.md',
      ),
    ).toEqual({
      id: 'x',
      version: 2,
      feature: 'voice',
      title: 'X',
      text: 'Hello',
    });
  });

  it('refuses a prompt without an id, a version or a known feature', () => {
    expect(() => parsePrompt('Hello', 'a.md')).toThrow(/front matter/);
    expect(() =>
      parsePrompt('---\nid: x\nfeature: voice\n---\nHi', 'a.md'),
    ).toThrow(/version/);
    expect(() =>
      parsePrompt('---\nid: x\nversion: 1\nfeature: weather\n---\nHi', 'a.md'),
    ).toThrow(/feature/);
  });

  it('every shipped prompt loads, with a unique id', () => {
    const r = new PromptRegistry();
    r.load(PROMPTS_DIR);
    const list = r.list();
    expect(list.map((p) => p.id)).toContain('voice_intent');
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    for (const p of list) expect(p.length).toBeGreaterThan(200);
  });
});
