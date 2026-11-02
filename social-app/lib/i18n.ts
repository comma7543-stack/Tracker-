import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import en from '../locales/en.json';
import ko from '../locales/ko.json';
import { APP_NAME } from './config';

export const LANGUAGES: readonly (readonly [string, string, string])[] = [
  ['en', 'English', ''], ['ko', '한국어', 'Korean'], ['ja', '日本語', 'Japanese'], ['zh', '中文（简体）', 'Chinese, Simplified'],
  ['zh-TW', '中文（繁體）', 'Chinese, Traditional'], ['es', 'Español', 'Spanish'], ['fr', 'Français', 'French'], ['de', 'Deutsch', 'German'],
  ['pt', 'Português', 'Portuguese'], ['vi', 'Tiếng Việt', 'Vietnamese'], ['th', 'ภาษาไทย', 'Thai'], ['id', 'Bahasa Indonesia', 'Indonesian'],
  ['tl', 'Filipino', 'Filipino'], ['ru', 'Русский', 'Russian'], ['ar', 'العربية', 'Arabic'], ['hi', 'हिन्दी', 'Hindi'],
];

export function deviceLanguage() {
  const code = getLocales()[0]?.languageTag ?? 'en';
  const exact = LANGUAGES.find((l) => l[0] === code);
  if (exact) return exact[0];
  return LANGUAGES.find((l) => l[0] === code.split('-')[0])?.[0] ?? 'en';
}

i18n.use(initReactI18next).init({
  // Only en and ko ship translated; every other language falls back to en.
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false, defaultVariables: { app: APP_NAME } },
});

/** Returns true when an app restart is needed for the layout direction to change. */
export function applyLanguage(code: string) {
  i18n.changeLanguage(code);
  const rtl = code === 'ar';
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

export default i18n;
