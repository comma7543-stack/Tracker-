// Sharing outside the app: post and profile links, invites, and images (streak cards).
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { track } from './analytics';
import { APP_NAME, SHARE_URL_BASE, STORE_URL } from './config';
import i18n from './i18n';

const configured = (v: string) => !!v && !v.startsWith('[');

/** A web link once SHARE_URL_BASE is set, the app's own link until then. */
export const linkFor = (path: string) =>
  configured(SHARE_URL_BASE) ? `${SHARE_URL_BASE.replace(/\/$/, '')}/${path}` : Linking.createURL(path);

async function shareText(message: string, kind: string) {
  try {
    const res = await Share.share({ message });
    if (res.action === Share.sharedAction) track('share_out', { kind });
  } catch {
    // Closing the share sheet isn't an error worth showing.
  }
}

export const sharePost = (postId: string) =>
  shareText(i18n.t('growth.postMessage', { app: APP_NAME, link: linkFor(`post/${postId}`) }), 'post');

export const shareProfile = (userId: string, username: string) =>
  shareText(i18n.t('growth.profileMessage', { app: APP_NAME, name: username, link: linkFor(`user/${userId}`) }), 'profile');

export const shareInvite = () =>
  shareText(i18n.t('growth.inviteMessage', { app: APP_NAME, link: configured(STORE_URL) ? STORE_URL : linkFor('') }), 'invite');

/** Opens the system sheet for an image file, e.g. to post a streak card to a story elsewhere. */
export async function shareImage(uri: string, kind: string) {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: APP_NAME, UTI: 'public.png' });
  track('share_out', { kind });
  return true;
}
