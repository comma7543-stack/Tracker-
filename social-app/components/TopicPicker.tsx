import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { TOPICS } from '../lib/topics';
import { Chip } from './ui';

export const INTEREST_TOPICS = TOPICS.map(([name]) => name);

export function TopicPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {INTEREST_TOPICS.map((name) => {
        const on = value.includes(name);
        return <Chip key={name} label={t(`topic.${name}`)} on={on} onPress={() => onChange(on ? value.filter((v) => v !== name) : [...value, name])} />;
      })}
    </View>
  );
}
