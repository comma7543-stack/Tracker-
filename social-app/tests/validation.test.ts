import { describe, expect, it } from 'vitest';
import { ageFrom, canSignUp, normalizeUsername, toE164, usernameIssue, validEmail, validPhone } from '../lib/validation';

describe('usernameIssue', () => {
  it.each(['abc', 'alex.lifts.27', 'a_b', 'user_name.1', 'a'.repeat(30)])('accepts %s', (u) => expect(usernameIssue(u)).toBeNull());
  it.each([
    ['', 'empty'],
    ['ab', 'short'],
    ['a'.repeat(31), 'long'],
    ['Abc', 'chars'],
    ['a b', 'chars'],
    ['a-b', 'chars'],
    ['.abc', 'dots'],
    ['abc.', 'dots'],
    ['fuck.you', 'offensive'],
    ['sh1t_lord', 'offensive'],
  ])('rejects %j as %s', (u, issue) => expect(usernameIssue(u)).toBe(issue));

  it('lowercases and strips spaces while typing', () => {
    expect(normalizeUsername('Alex Lifts')).toBe('alexlifts');
  });
});

describe('contact', () => {
  it('needs 7 digits for a phone', () => {
    expect(validPhone('+1 (949) 555-0123')).toBe(true);
    expect(validPhone('123456')).toBe(false);
  });
  it('checks email shape', () => {
    expect(validEmail('you@example.com')).toBe(true);
    expect(validEmail('you@example')).toBe(false);
    expect(validEmail('a b@example.com')).toBe(false);
  });
  it('formats E.164', () => expect(toE164('+1 (949) 555-0123')).toBe('+19495550123'));
});

describe('age', () => {
  const now = new Date(2026, 9, 31);
  it('counts whole years around the birthday', () => {
    expect(ageFrom('2013-10-31', now)).toBe(13);
    expect(ageFrom('2013-11-01', now)).toBe(12);
  });
  it('blocks under 13', () => {
    expect(canSignUp(ageFrom('2013-11-01', now))).toBe(false);
    expect(canSignUp(ageFrom('2013-10-31', now))).toBe(true);
  });
  it('rejects nonsense', () => {
    expect(ageFrom('2030-01-01', now)).toBeNull();
    expect(ageFrom('1800-01-01', now)).toBeNull();
    expect(ageFrom('not a date', now)).toBeNull();
  });
});
