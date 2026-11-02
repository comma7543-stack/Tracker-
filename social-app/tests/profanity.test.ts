import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBad } from '../lib/profanity';
import { isBad as isBadServer } from '../supabase/functions/_shared/profanity';

describe('isBad', () => {
  it.each(['fuck', 'FUCK you', 'shit', 'bitch', 'porn', 'kys'])('catches %s', (w) => expect(isBad(w)).toBe(true));
  it.each(['씨발', '병신', '개새끼', 'ㅅㅂ', '존나 좋아', '시 발'])('catches Korean %s', (w) => expect(isBad(w)).toBe(true));
  it.each(['fuk', 'sh1t', 'b!tch', 'a55hole', '$hit', 'p0rn', 'bi7ch', '8itch'])('catches leetspeak %s', (w) => expect(isBad(w)).toBe(true));
  it.each(['fuuuuck', 'shiiit', 'biiitch'])('catches repeated letters %s', (w) => expect(isBad(w)).toBe(true));
  it.each(['f u c k', 's h i t', 'b i t c h'])('catches spaced letters %s', (w) => expect(isBad(w)).toBe(true));
  it.each(['ass', 'dick', 'tits', 'crap'])('catches whole word %s', (w) => expect(isBad(w)).toBe(true));

  it.each([
    'shiitake', 'shitake mushrooms', 'Scunthorpe', 'cocktail', 'assassin', 'classic', 'passion', 'grape juice',
    'therapist', 'peacock', 'cucumber', 'document', 'analysis', 'cumulative', 'Dickens', '시발점',
  ])('allows %s', (w) => expect(isBad(w)).toBe(false));

  it.each(['Leg day. Squats 5x5 at 100kg', 'Day 30 of reading', 'class', 'title', '오늘 운동 끝', ''])('allows normal text: %s', (w) =>
    expect(isBad(w)).toBe(false),
  );

  // A false positive in the prototype's function, kept because the brief says to port
  // it exactly: "assess" matches "asses" plus a repeated letter.
  it('has a known false positive on assess', () => expect(isBad('assess')).toBe(true));

  it('treats empty and null as clean', () => {
    expect(isBad(null)).toBe(false);
    expect(isBad(undefined)).toBe(false);
  });

  it('matches the prototype word lists exactly', () => {
    const source = readFileSync(join(__dirname, '..', 'design', 'NamePassword.dc.html'), 'utf8');
    const port = readFileSync(join(__dirname, '..', 'lib', 'profanity.ts'), 'utf8');
    for (const name of ['KO', 'STRONG', 'WHOLE']) {
      const rx = new RegExp(`const ${name} = (\\[.*?\\]);`);
      expect(port.match(rx)?.[1]).toBe(source.match(rx)?.[1]);
    }
    expect(port.match(/const ALLOW = (.*);/)?.[1]).toBe(source.match(/const ALLOW = (.*);/)?.[1]);
  });

  it('is identical in the app and the Edge Function', () => {
    const app = readFileSync(join(__dirname, '..', 'lib', 'profanity.ts'), 'utf8');
    const server = readFileSync(join(__dirname, '..', 'supabase', 'functions', '_shared', 'profanity.ts'), 'utf8');
    expect(server).toBe(app);
    expect(isBadServer('sh1t')).toBe(true);
  });
});
