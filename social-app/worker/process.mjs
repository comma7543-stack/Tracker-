// The ffmpeg part of the worker, with no network code, so tests/worker.test.ts can
// run it on a real file.
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const MAX_SECONDS = 95; // The app allows 90; a little slack for rounding.
export const MAX_WIDTH = 720;
export const FRAME_WIDTH = 1024;

/** Duration and whether there's a video stream. Throws if ffprobe can't read the file. */
export async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout);
  const video = (info.streams ?? []).find((s) => s.codec_type === 'video');
  return {
    seconds: Number(info.format?.duration ?? video?.duration ?? 0),
    hasVideo: !!video,
    hasAudio: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
    tags: { ...(info.format?.tags ?? {}), ...(video?.tags ?? {}) },
  };
}

/**
 * Re-encodes to H.264 MP4 that streams well on phones, with every piece of metadata
 * dropped (GPS location, device, dates), and pulls `frames` stills spread across it.
 * Returns { ok: false, error } for a file that isn't a usable video.
 */
export async function processVideo(input, outDir, frames = 4) {
  let meta;
  try {
    meta = await probe(input);
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  if (!meta.hasVideo) return { ok: false, error: 'no_video' };
  if (!(meta.seconds > 0)) return { ok: false, error: 'no_duration' };
  if (meta.seconds > MAX_SECONDS) return { ok: false, error: 'too_long', seconds: meta.seconds };

  await mkdir(outDir, { recursive: true });
  const video = join(outDir, 'video.mp4');
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    // Drops global, stream and chapter metadata: this is what removes location.
    '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
    '-vf', `scale='trunc(min(${MAX_WIDTH},iw)/2)*2':-2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
    video,
  ]);

  const framePaths = [];
  for (let i = 0; i < frames; i += 1) {
    // Spread across the clip, and never right at the end where there may be no frame.
    const at = Math.min((meta.seconds * i) / frames, Math.max(meta.seconds - 0.1, 0));
    const out = join(outDir, `${i}.jpg`);
    await run('ffmpeg', [
      '-v', 'error', '-y', '-ss', at.toFixed(2), '-i', video, '-frames:v', '1',
      '-vf', `scale='min(${FRAME_WIDTH},iw)':-2`, '-q:v', '4', '-map_metadata', '-1', out,
    ]);
    framePaths.push(out);
  }
  return { ok: true, video, framePaths, seconds: Math.round(meta.seconds * 10) / 10, hadAudio: meta.hasAudio };
}
