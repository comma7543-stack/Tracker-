// Text with tappable #tags and @mentions, for captions and comments.
import { router } from 'expo-router';
import type { StyleProp, TextStyle } from 'react-native';
import { useTheme } from '../lib/theme';
import { T } from './ui';

// Same characters the database reads tags and usernames with.
const TOKEN = /([#][A-Za-z0-9_가-힣]{1,30}|@[A-Za-z0-9._]{3,30})/g;

export type RichPart = { text: string; kind: 'plain' | 'tag' | 'mention' };

export function splitRich(text: string): RichPart[] {
  return text.split(TOKEN).filter(Boolean).flatMap((part): RichPart[] => {
    if (/^#[A-Za-z0-9_가-힣]{1,30}$/.test(part)) return [{ text: part, kind: 'tag' }];
    if (/^@[A-Za-z0-9._]{3,30}$/.test(part)) {
      // A trailing dot ends the sentence, not the username: usernames can't end with one.
      const name = part.replace(/\.+$/, '');
      const rest = part.slice(name.length);
      return name.length >= 4 ? [{ text: name, kind: 'mention' }, ...(rest ? [{ text: rest, kind: 'plain' as const }] : [])] : [{ text: part, kind: 'plain' }];
    }
    return [{ text: part, kind: 'plain' }];
  });
}

export function RichText({ text, s = 15, c, style }: { text: string; s?: number; c?: string; style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <T s={s} c={c} style={style}>
      {splitRich(text).map((part, i) => (part.kind === 'plain' ? part.text : (
        <T
          key={i}
          s={s}
          w="600"
          c={c ?? theme.fg}
          accessibilityRole="link"
          onPress={() => router.push(part.kind === 'tag' ? `/tag/${encodeURIComponent(part.text.slice(1).toLowerCase())}` : `/u/${encodeURIComponent(part.text.slice(1).toLowerCase())}`)}
        >
          {part.text}
        </T>
      )))}
    </T>
  );
}
