import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUI } from '../lib/store';
import { boxGlow, useTheme } from '../lib/theme';
import { CommentsSheet } from './sheets/Comments';
import { CreateSheet } from './sheets/Create';
import { ReportSheet } from './sheets/Report';
import { ShareSheet } from './sheets/Share';
import { StreakSheet } from './sheets/Streak';
import { SuspendedSheet } from './sheets/Suspended';
import { T } from './ui';

/** Rendered once at the root; screens open these through useUI. */
export function GlobalSheets() {
  const sheet = useUI((s) => s.sheet);
  const close = useUI((s) => s.close);
  if (!sheet) return null;
  switch (sheet.type) {
    case 'comments': return <CommentsSheet key={sheet.postId} postId={sheet.postId} onClose={close} />;
    case 'share': return <ShareSheet postId={sheet.postId} ownerId={sheet.ownerId} onClose={close} />;
    case 'create': return <CreateSheet onClose={close} />;
    case 'suspended': return <SuspendedSheet onClose={close} />;
    case 'streak': return <StreakSheet onClose={close} />;
    case 'report': return <ReportSheet target={sheet.target} onClose={close} />;
  }
}

export function Toast() {
  const c = useTheme();
  const message = useUI((s) => s.toast);
  const inset = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 72 + inset.bottom, alignItems: 'center' }}>
      <View accessibilityLiveRegion="polite" style={[{ backgroundColor: c.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 }, boxGlow(c)]}>
        <T s={14} w="600" c={c.onAccent}>{message}</T>
      </View>
    </View>
  );
}
