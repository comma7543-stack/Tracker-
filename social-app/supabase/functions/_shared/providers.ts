import Anthropic from 'npm:@anthropic-ai/sdk@1';
import { Buffer } from 'node:buffer';
import type { ModelRequest } from './moderation.ts';

// To add a provider, add an entry here and set MODERATION_PROVIDER. It takes a
// ModelRequest and returns the verdict JSON as text. Anything else: throw.
const anthropic = async (req: ModelRequest): Promise<string> => {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), timeout: 60_000 });
  const model = Deno.env.get('MODERATION_MODEL') ?? 'claude-haiku-5-5';
  // Haiku has no server-side refusal fallback, so a refusal there waits for a person.
  const fallback = model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  // deno-lint-ignore no-explicit-any
  const response: any = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    ...fallback,
    system: req.system,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
    messages: [{
      role: 'user',
      content: [
        ...req.images.map((image) => ({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: Buffer.from(image.bytes).toString('base64') },
        })),
        { type: 'text', text: req.text },
      ],
    // deno-lint-ignore no-explicit-any
    }] as any,
  // deno-lint-ignore no-explicit-any
  } as any);

  // A refusal is not an approval. Throwing keeps the post hidden for a person to review.
  if (response.stop_reason !== 'end_turn') throw new Error(`model_stopped:${response.stop_reason}`);
  // deno-lint-ignore no-explicit-any
  const block = response.content.find((b: any) => b.type === 'text');
  if (!block) throw new Error('model_no_text');
  return block.text;
};

const PROVIDERS: Record<string, (req: ModelRequest) => Promise<string>> = { anthropic };

export function callModel(req: ModelRequest) {
  const name = Deno.env.get('MODERATION_PROVIDER') ?? 'anthropic';
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown_provider:${name}`);
  return provider(req);
}
