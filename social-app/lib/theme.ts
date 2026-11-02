import { flameTier } from './streak';
import { useSettings } from './store';

type ThemeName = 'white' | 'neon' | 'color';

export type Tokens = {
  bg: string; surface: string; surface2: string; line: string; fg: string; muted: string; faint: string;
  accent: string; onAccent: string; accentPressed: string; danger: string; brand: string;
  cardBorderWidth: number; cardBorderColor: string;
  /** Selected chips and active tab. Colorful swaps the pink accent for blue here. */
  selected: string; onSelected: string; activeTab: string;
  media: string; mediaFg: string;
  storyRings: string[];
  glow: boolean;
  /** Stops for subtle dark gradients, Neon only. */
  pageGradient?: string[]; cardGradient?: string[];
};

const THEMES: Record<ThemeName, Tokens> = {
  white: {
    bg: '#FFFFFF', surface: '#FAFAFA', surface2: '#EFEFEF', line: '#DBDBDB', fg: '#000000', muted: '#737373', faint: '#C7C7C7',
    accent: '#000000', onAccent: '#FFFFFF', accentPressed: '#262626', danger: '#B3261E', brand: '#000000',
    cardBorderWidth: 1, cardBorderColor: '#DBDBDB',
    selected: '#000000', onSelected: '#FFFFFF', activeTab: '#000000',
    media: '#EFEFEF', mediaFg: '#737373', storyRings: ['#000000'], glow: false,
  },
  neon: {
    bg: '#000000', surface: '#121212', surface2: '#1F1F1F', line: '#2E2E2E', fg: '#F5F5F5', muted: '#A3A3A3', faint: '#4A4A4A',
    accent: '#FFFFFF', onAccent: '#000000', accentPressed: '#E0E0E0', danger: '#FF7070', brand: '#FFFFFF',
    cardBorderWidth: 1, cardBorderColor: 'rgba(255,255,255,0.16)',
    selected: '#FFFFFF', onSelected: '#000000', activeTab: '#FFFFFF',
    media: '#1F1F1F', mediaFg: '#A3A3A3', storyRings: ['#FFFFFF'], glow: true,
    pageGradient: ['#3a3a3a', '#121212', '#000000'], cardGradient: ['#181818', '#0a0a0a'],
  },
  color: {
    bg: '#F4F1FF', surface: '#FFFFFF', surface2: '#E9E4FF', line: '#D3CCF2', fg: '#14112B', muted: '#5A5670', faint: '#A9A3C9',
    accent: '#FF2E88', onAccent: '#14112B', accentPressed: '#FF5AA0', danger: '#C4142B', brand: '#2952FF',
    cardBorderWidth: 2, cardBorderColor: '#14112B',
    selected: '#2952FF', onSelected: '#FFFFFF', activeTab: '#2952FF',
    media: '#2952FF', mediaFg: '#FFFFFF', storyRings: ['#2952FF', '#FF2E88', '#9BD412'], glow: false,
  },
};

// Scrolls and the story viewer are dark in every theme.
export const DARK = {
  bg: '#111111', fg: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', faint: 'rgba(255,255,255,0.3)',
  panel: '#2A2A2A', chip: 'rgba(255,255,255,0.15)', avatar: '#444444', danger: '#FF8A8A',
  scrim: 'rgba(0,0,0,0.55)', backdrop: 'rgba(0,0,0,0.65)',
};

// The dedication dial burns the same in every theme. `levels` runs from 1 to 10, deep red to bright yellow.
export const FIRE = {
  outer: '#E8400C', mid: '#FF8A00', core: '#FFD84D', skyTop: '#1F0500', skyMid: '#7A1500',
  levels: ['#8F1D00', '#AD2600', '#C93000', '#E03C05', '#EE4F0A', '#F76510', '#FD7E12', '#FF9A1C', '#FFB62E', '#FFD84D'],
  // Streak flames, one per tier from lib/streak.ts: ember, orange, gold, hot pink, violet.
  tiers: [
    { outer: '#A81E00', mid: '#E0430A', core: '#FF8A00' },
    { outer: '#E8400C', mid: '#FF8A00', core: '#FFB62E' },
    { outer: '#F76510', mid: '#FFB62E', core: '#FFE98A' },
    { outer: '#E5177B', mid: '#FF5C8A', core: '#FFD84D' },
    { outer: '#6D28D9', mid: '#D946EF', core: '#FFE98A' },
  ],
  frozen: { outer: '#1769E0', mid: '#5CB8FF', core: '#E3F6FF' },
};

export const flamePalette = (count: number, frozen = false) =>
  (frozen ? FIRE.frozen : FIRE.tiers[Math.max(1, flameTier(count)) - 1]);

// Certificates look like paper in every theme.
export const CERTIFICATE = { paper: '#FFFBF0', ink: '#2B2118', muted: '#6B5D4A', gold: '#B8860B' };

// Disabled buttons are this gray in every theme.
export const DISABLED = '#C7C7C7';

export const useTheme = () => THEMES[useSettings((s) => s.choices.theme as ThemeName)] ?? THEMES.white;

/** Text style for the Neon glow. Empty in the other themes. */
export const textGlow = (t: Tokens) =>
  t.glow ? { textShadowColor: 'rgba(255,255,255,0.8)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } } : null;

/** View style for the Neon glow. Empty in the other themes. */
export const boxGlow = (t: Tokens) =>
  t.glow ? { shadowColor: '#FFFFFF', shadowOpacity: 0.7, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } } : null;
