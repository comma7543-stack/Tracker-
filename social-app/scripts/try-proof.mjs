// Sends a real video through the same goal-proof check the app uses and prints the decision.
// Standalone on purpose: the SDK lives in scripts/node_modules, away from the app's packages.
// Usage: see "Testing goal proof on a real video" in README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moderate } from '../supabase/functions/_shared/moderation.ts';

const FRAMES = 10;

function takeFrames(video, dir) {
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString());
  for (let i = 0; i < FRAMES; i += 1) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String((seconds * i) / FRAMES), '-i', video, '-frames:v', '1', '-vf', 'scale=1024:-2', join(dir, `${i}.jpg`)]);
  }
  console.log(`Took ${FRAMES} frames from ${seconds.toFixed(1)} seconds of video.`);
  return readdirSync(dir).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((f) => join(dir, f));
}

async function main(video, goal, dir) {
  const frames = takeFrames(video, dir);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY first. See README.md. Nothing was sent.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('Run this once first: cd scripts && npm install');
  });
  const client = new Anthropic();
  const model = process.env.MODERATION_MODEL ?? 'claude-haiku-5-5';

  // Same request as supabase/functions/_shared/providers.ts, which only runs on Deno.
  const callModel = async (req) => {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: req.system,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
      messages: [{
        role: 'user',
        content: [
          ...req.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.bytes).toString('base64') } })),
          { type: 'text', text: req.text },
        ],
      }],
    });
    if (response.stop_reason !== 'end_turn') throw new Error(`model_stopped:${response.stop_reason}`);
    return response.content.find((b) => b.type === 'text').text;
  };

  await moderate(
    { id: 'try', kind: 'scroll', media_path: video, media_type: 'video', caption: '', topic: 'Fitness', subtag: 'Gym', goal_proof: true, proof_goal: goal },
    {
      isBad: () => false,
      readHead: async (path) => new Uint8Array(readFileSync(path).subarray(0, 32)),
      readFile: async (path) => new Uint8Array(readFileSync(path)),
      listFrames: async () => frames,
      callModel,
      claim: async () => 'ok',
      apply: async (_id, v) => {
        // The same test as apply_moderation in the database.
        const finished = v.on_topic && !v.violation && v.goal_achieved && v.confidence >= 0.8;
        console.log(`\nGoal: ${goal}\nModel: ${model}\nCertificate: ${finished ? 'YES' : 'NO'}`);
        console.log(`Achieved: ${v.goal_achieved}  Confidence: ${v.confidence}  On topic: ${v.on_topic}  Rule broken: ${v.violation ?? 'none'}`);
        console.log(`AI says: ${v.goal_reason}`);
        return {};
      },
    },
  );
}

const [video, goal] = process.argv.slice(2);
if (!video || !goal) {
  console.error('Usage: npm run try-proof -- path/to/video.mp4 "Run a marathon"');
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'try-proof-'));
try {
  await main(video, goal, dir);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
