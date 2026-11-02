import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';
import { report } from '../../lib/api';
import { toast } from '../../lib/store';
import { useTheme } from '../../lib/theme';
import type { ReportTarget } from '../../lib/types';
import { Button, Chip, SheetFrame, T } from '../ui';

const REPORT_REASONS = ['sexual', 'illegal', 'violence', 'hate', 'scam', 'alcohol', 'spam', 'other'];

export function ReportSheet({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const c = useTheme();
  const { t } = useTranslation();
  const [reason, setReason] = useState(target.type === 'problem' ? 'other' : '');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await report(target, details.trim() ? `${reason}: ${details.trim()}` : reason);
      toast(t('report.thanks'));
      onClose();
    } catch {
      toast(t('common.tryAgain'));
      setBusy(false);
    }
  };

  return (
    <SheetFrame title={target.type === 'problem' ? t('report.problem') : t('report.title')} onClose={onClose}>
      <View style={{ padding: 16, gap: 12 }}>
        {target.type !== 'problem' ? (
          <>
            <T s={14} c={c.muted}>{t('report.why')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {REPORT_REASONS.map((r) => <Chip key={r} label={t(`report.reason.${r}`)} on={reason === r} onPress={() => setReason(r)} />)}
            </View>
          </>
        ) : null}
        <TextInput
          accessibilityLabel={t('report.details')}
          value={details}
          onChangeText={setDetails}
          maxLength={500}
          multiline
          placeholder={t('report.details')}
          placeholderTextColor={c.muted}
          style={{ minHeight: 80, borderWidth: 1, borderColor: c.line, borderRadius: 12, padding: 12, fontSize: 15, color: c.fg, backgroundColor: c.surface, textAlignVertical: 'top' }}
        />
        <Button label={t('report.send')} disabled={!reason || (target.type === 'problem' && !details.trim())} busy={busy} onPress={submit} />
      </View>
    </SheetFrame>
  );
}
