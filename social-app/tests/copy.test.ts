// Guards the copy and design rules from the build brief across all source files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ko from '../locales/ko.json';

const ROOT = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const source = ['app', 'components', 'lib'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.tsx?$/.test(f));

function flatten(obj: object, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((out, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, key));
    else out[key] = String(v);
    return out;
  }, {});
}

const enFlat = flatten(en);
const koFlat = flatten(ko);
const baseKey = (k: string) => k.replace(/_(one|other)$/, '');

describe('translations', () => {
  it('has the same keys in English and Korean', () => {
    expect(Object.keys(koFlat).map(baseKey).sort()).toEqual([...new Set(Object.keys(enFlat).map(baseKey))].sort());
  });

  it('says supporter, never follower', () => {
    for (const [k, v] of [...Object.entries(enFlat), ...Object.entries(koFlat)]) expect(v, k).not.toMatch(/follow|팔로/i);
  });

  it('has no empty strings', () => {
    for (const [k, v] of [...Object.entries(enFlat), ...Object.entries(koFlat)]) expect(v, k).not.toBe('');
  });

  it('defines every key the code uses', () => {
    const known = new Set(Object.keys(enFlat).map(baseKey));
    const missing: string[] = [];
    for (const file of source) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!known.has(m[1])) missing.push(`${m[1]} (${file.replace(ROOT, '')})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('copy rules', () => {
  const allCopy = [...Object.values(enFlat), ...source.map((f) => readFileSync(f, 'utf8'))];

  it('never says Respect or Reels', () => {
    for (const text of allCopy) {
      expect(text).not.toMatch(/\brespect\b/i);
      expect(text).not.toMatch(/\breels?\b/i);
    }
  });

  it('has no emoji anywhere', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const text of [...allCopy, ...Object.values(koFlat)]) expect(text.match(emoji)?.[0], text.slice(0, 60)).toBeUndefined();
  });

  it('did not ship the prototype-only controls', () => {
    for (const f of source) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(/prototype only/i);
      expect(text).not.toMatch(/demoChips|Reset strikes/);
    }
  });
});

describe('design rules', () => {
  it('keeps color values in lib/theme.ts only', () => {
    const offenders = source
      .filter((f) => !f.endsWith('lib/theme.ts'))
      .filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(ROOT, ''))).toEqual([]);
  });

  it('never selects * from tables with column grants', () => {
    const api = readFileSync(join(ROOT, 'lib', 'api.ts'), 'utf8');
    expect(api).not.toMatch(/from\('(profiles|posts)'\)\.select\('\*'\)/);
  });
});
