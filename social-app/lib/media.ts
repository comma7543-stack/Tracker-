import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { DEMO } from './config';
import { demoMediaUrl } from './demo';
import { myId } from './store';
import { supabase } from './supabase';
import type { MediaType } from './types';

export type PickedMedia = { uri: string; type: MediaType; width: number; durationMs: number | null; mimeType?: string };

const MAX_VIDEO_SECONDS = 90;
const MAX_PHOTO_WIDTH = 1600;
const FRAME_COUNT = 4;

export async function pickMedia(type: MediaType): Promise<PickedMedia | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: type === 'video' ? ['videos'] : ['images'],
    videoMaxDuration: MAX_VIDEO_SECONDS,
    exif: false,
    quality: 1,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { uri: a.uri, type, width: a.width, durationMs: a.duration ?? null, mimeType: a.mimeType };
}

// Re-encoding drops all EXIF, including GPS location.
async function preparePhoto(uri: string, width: number, maxWidth = MAX_PHOTO_WIDTH) {
  const ctx = ImageManipulator.manipulate(uri);
  if (width > maxWidth) ctx.resize({ width: maxWidth });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  return saved.uri;
}

const uploadFile = async (bucket: string, path: string, uri: string, contentType: string, upsert = false) => {
  const body = await (await fetch(uri)).arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType, upsert });
  if (error) throw new Error(error.message);
};

/** Uploads to the private media bucket and returns the storage path. */
/** Goal proof sends more frames, so the AI has more of the video to judge. */
export const PROOF_FRAMES = 10;

export async function uploadMedia(m: PickedMedia, frames = FRAME_COUNT): Promise<string> {
  if (DEMO) return m.uri;
  const id = Crypto.randomUUID();
  if (m.type === 'photo') {
    const uri = await preparePhoto(m.uri, m.width);
    const path = `${myId()}/${id}.jpg`;
    await uploadFile('media', path, uri, 'image/jpeg');
    return path;
  }

  const quicktime = m.mimeType === 'video/quicktime' || m.uri.toLowerCase().endsWith('.mov');
  const path = `${myId()}/${id}.${quicktime ? 'mov' : 'mp4'}`;
  await uploadFile('media', path, m.uri, quicktime ? 'video/quicktime' : 'video/mp4');

  // ponytail: frames are extracted on the device, so a modified client could send
  // clean frames with a bad video. Close this with server-side extraction (a worker
  // running ffmpeg) before launch; see PROGRESS.md "Known gaps".
  const duration = m.durationMs ?? 1000;
  for (let i = 0; i < frames; i += 1) {
    const { uri, width } = await VideoThumbnails.getThumbnailAsync(m.uri, { time: Math.floor((duration * i) / frames), quality: 0.7 });
    const frame = await preparePhoto(uri, width, 1024);
    await uploadFile('media', `${path}.frames/${i}.jpg`, frame, 'image/jpeg');
  }
  return path;
}

/** Re-encoded like post photos, so no location data goes along. */
export async function uploadMessagePhoto(conversationId: string, m: PickedMedia) {
  if (DEMO) return `${conversationId}/${m.uri}`;
  const jpeg = await preparePhoto(m.uri, m.width);
  const path = `${conversationId}/${Crypto.randomUUID()}.jpg`;
  await uploadFile('message-photos', path, jpeg, 'image/jpeg');
  return path;
}

export async function deleteMedia(path: string) {
  const frames = path.match(/\.(mp4|mov)$/) ? Array.from({ length: PROOF_FRAMES }, (_, i) => `${path}.frames/${i}.jpg`) : [];
  await supabase.storage.from('media').remove([path, ...frames]);
}

export async function uploadAvatar(uri: string, width: number) {
  if (DEMO) return uri;
  const jpeg = await preparePhoto(uri, width, 512);
  const path = `${myId()}/avatar.jpg`;
  await uploadFile('avatars', path, jpeg, 'image/jpeg', true);
  // The version query busts image caches, since the path never changes.
  return `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
}

const SIGNED_URL_SECONDS = 3600;

/** A signed URL for a private media file, cached a little under its lifetime. */
export function useMediaUrl(path: string | null | undefined, bucket = 'media') {
  return useQuery({
    queryKey: ['media-url', bucket, path],
    enabled: !!path,
    staleTime: (SIGNED_URL_SECONDS - 300) * 1000,
    queryFn: async () => {
      if (DEMO) return demoMediaUrl(path as string);
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path as string, SIGNED_URL_SECONDS);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    retry: false,
  }).data;
}

/** Still image for a post: the photo itself, or a video's first frame. */
export const posterPath = (p: { media_path: string; media_type: MediaType }) =>
  p.media_type === 'video' ? `${p.media_path}.frames/0.jpg` : p.media_path;
