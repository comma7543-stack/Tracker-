// Swap the app name here and everywhere updates. See also "name" in app.json.
export const APP_NAME = '[App Name]';

// Bump when the terms change; stored with each user's acceptance.
export const TERMS_VERSION = '2026-10-placeholder';

// Placeholders until the documents and addresses exist.
export const TERMS_URL = '[Terms of Use link]';
export const PRIVACY_URL = '[Privacy Policy link]';
export const SUPPORT_EMAIL = '[Support email]';
// Shown to someone whose goal suggests they may be struggling. Must be real before launch: see PROGRESS.md.
export const HELP_LINE = '[Crisis helpline]';

export const APP_VERSION = '1.0.0';

// Where shared links point, once a website exists, e.g. 'https://example.com'. Until then
// links use the app's own scheme, which only opens for people who have the app.
// A real domain also needs universal links set up: see README "Share links".
export const SHARE_URL_BASE = '[Share link domain]';
// The store pages, shown in invites. Placeholders until the app is published.
export const STORE_URL = '[App Store or Play Store link]';
export const AUTH_REDIRECT = 'appname://auth-callback';

// Fake data instead of Supabase. See lib/demo.ts; only `npm run demo` sets this.
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';
