import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ko from '../locales/ko.json';
import { DIAL_MAX, flickerFor, fractionOfLevel, levelFromFraction } from '../lib/dial';

describe('dedication dial', () => {
  it('maps the bottom and top of the meter to 1 and 10', () => {
    expect(levelFromFraction(0)).toBe(1);
    expect(levelFromFraction(1)).toBe(DIAL_MAX);
  });

  it('never leaves 1 to 10, however far the finger goes', () => {
    expect(levelFromFraction(-3)).toBe(1);
    expect(levelFromFraction(3)).toBe(DIAL_MAX);
  });

  it('returns every level from its own position', () => {
    for (let level = 1; level <= DIAL_MAX; level += 1) expect(levelFromFraction(fractionOfLevel(level))).toBe(level);
  });

  it('flickers harder and faster as the level climbs', () => {
    for (let level = 2; level <= DIAL_MAX; level += 1) {
      expect(flickerFor(level).stretch).toBeGreaterThan(flickerFor(level - 1).stretch);
      expect(flickerFor(level).ms).toBeLessThan(flickerFor(level - 1).ms);
    }
    expect(flickerFor(DIAL_MAX).ms).toBeGreaterThan(0);
  });

  it('has a line for every level in both languages', () => {
    for (let level = 1; level <= DIAL_MAX; level += 1) {
      expect(en.commit).toHaveProperty(`level${level}`);
      expect(ko.commit).toHaveProperty(`level${level}`);
    }
  });
});
