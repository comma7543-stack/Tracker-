// Runs the worker's ffmpeg pipeline on real files. Skipped where ffmpeg isn't installed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { probe, processVideo } from '../worker/process.mjs';

const hasFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; }
})();

const dir = mkdtempSync(join(tmpdir(), 'worker-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A phone-like clip: MOV with audio, GPS location and a device name in its metadata. */
function phoneClip(name: string, seconds: number) {
  const out = join(dir, name);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=1080x1920:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+37.5665+126.9780/', '-metadata', 'com.apple.quicktime.location.ISO6709=+37.5665+126.9780/',
    '-metadata', 'make=Apple', '-metadata', 'model=iPhone 15', '-metadata', 'creation_time=2026-10-01T09:00:00Z',
    '-movflags', 'use_metadata_tags', out,
  ]);
  return out;
}

describe.skipIf(!hasFfmpeg)('video worker pipeline', () => {
  it('strips location and device metadata, shrinks to 720 wide and pulls frames', async () => {
    const input = phoneClip('in.mov', 3);
    const before = await probe(input);
    expect(JSON.stringify(before.tags)).toMatch(/37\.5665/);

    const result = await processVideo(input, join(dir, 'out'), 4);
    expect(result.ok).toBe(true);
    const after = await probe(result.video);
    const tagText = JSON.stringify(after.tags);
    expect(tagText).not.toMatch(/37\.5665|126\.978|iPhone|Apple|2026-10-01/);
    expect(after.hasAudio).toBe(true);
    expect(after.seconds).toBeGreaterThan(2.5);

    const width = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', result.video]).toString().trim());
    expect(width).toBe(720);
    expect(result.framePaths).toHaveLength(4);
    for (const f of result.framePaths) expect(existsSync(f)).toBe(true);

    // Nothing location-like anywhere in the bytes either.
    const raw = execFileSync('strings', [result.video]).toString();
    expect(raw).not.toMatch(/37\.5665|iPhone/);
  }, 60_000);

  it('turns away files that are too long or not video', async () => {
    const long = phoneClip('long.mov', 97);
    expect(await processVideo(long, join(dir, 'long'), 4)).toMatchObject({ ok: false, error: 'too_long' });
    const fake = join(dir, 'fake.mp4');
    writeFileSync(fake, 'this is not a video');
    expect(await processVideo(fake, join(dir, 'fake'), 4)).toEqual({ ok: false, error: 'unreadable' });
  }, 120_000);
});
