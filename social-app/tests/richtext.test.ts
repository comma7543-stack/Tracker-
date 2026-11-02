import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('../lib/theme', () => ({ useTheme: () => ({}) }));
vi.mock('../components/ui', () => ({ T: () => null }));

const { splitRich } = await import('../components/RichText');

describe('caption tags and mentions', () => {
  it('finds tags in English and Korean, and mentions', () => {
    expect(splitRich('Leg day #legday with @minjun.lifts #헬스')).toEqual([
      { text: 'Leg day ', kind: 'plain' },
      { text: '#legday', kind: 'tag' },
      { text: ' with ', kind: 'plain' },
      { text: '@minjun.lifts', kind: 'mention' },
      { text: ' ', kind: 'plain' },
      { text: '#헬스', kind: 'tag' },
    ]);
  });

  it('keeps a sentence-ending dot out of the username', () => {
    expect(splitRich('Thanks @dan.reads.')).toEqual([
      { text: 'Thanks ', kind: 'plain' },
      { text: '@dan.reads', kind: 'mention' },
      { text: '.', kind: 'plain' },
    ]);
  });

  it('leaves plain text alone', () => {
    expect(splitRich('no tags here')).toEqual([{ text: 'no tags here', kind: 'plain' }]);
    expect(splitRich('email me at a@b')).toEqual([{ text: 'email me at a@b', kind: 'plain' }]);
  });
});
