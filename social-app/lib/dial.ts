// The rules behind the dedication dial, free of React so tests/dial.test.ts can run them.
export const DIAL_MAX = 10;
/** At or below this, the intro dares people to go higher. They can still stay. */
export const DARE_AT = 5;

/** A position on the meter, 0 at the bottom and 1 at the top, as a level from 1 to 10. */
export function levelFromFraction(fraction: number) {
  const clamped = Math.min(1, Math.max(0, fraction));
  return 1 + Math.round(clamped * (DIAL_MAX - 1));
}

export const fractionOfLevel = (level: number) => (level - 1) / (DIAL_MAX - 1);

/** Higher levels flicker harder and faster. */
export const flickerFor = (level: number) => ({ stretch: 0.02 + level * 0.012, ms: 460 - level * 30 });
