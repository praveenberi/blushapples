import { config } from '../config';

/**
 * AI provider abstraction. Routes and UI never talk to a vendor directly: switch AI_PROVIDER
 * or add a class here without touching anything else.
 */
export interface AiEnhanceOptions {
  intensity: 'subtle' | 'natural' | 'medium' | 'strong';
  features: string[];
}

export interface AiProvider {
  name: string;
  available: boolean;
  features: string[];
  enhance(image: Buffer, opts: AiEnhanceOptions): Promise<Buffer>;
}

export const AI_FEATURES = [
  'auto_enhance', 'upscale', 'denoise',
  'skin_tone', 'natural_retouch', 'blemish_removal', 'under_eye', 'reduce_shine', 'teeth_whitening', 'flyaway_hair',
  'eye_makeup', 'eyelashes', 'eyebrows', 'lipstick', 'blush', 'contour', 'highlighter', 'makeup_blend',
  'background_cleanup', 'object_removal', 'background_blur', 'background_replace', 'studio_backdrop',
] as const;

class NoProvider implements AiProvider {
  name = 'none';
  available = false;
  features: string[] = [];
  async enhance(): Promise<Buffer> {
    throw new Error('AI provider not configured');
  }
}

/**
 * Generic HTTP provider: POSTs JSON {image: base64, options} with a bearer key and expects an
 * image/* body or JSON {image: base64}. Put a thin proxy in front of any vendor. Identity and
 * natural-skin constraints are sent on every call.
 */
class HttpProvider implements AiProvider {
  name = 'http';
  available = true;
  features: string[] = [...AI_FEATURES];
  async enhance(image: Buffer, opts: AiEnhanceOptions) {
    const res = await fetch(config.ai.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` },
      body: JSON.stringify({
        image: image.toString('base64'),
        options: { ...opts, constraints: ['preserve_identity', 'preserve_facial_structure', 'keep_skin_texture', 'no_plastic_skin', 'keep_makeup_style'] },
      }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (type.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
    const json: any = await res.json();
    if (!json.image) throw new Error('AI provider returned no image');
    return Buffer.from(json.image, 'base64');
  }
}

export function aiProvider(): AiProvider {
  if (config.ai.provider === 'http' && config.ai.url) return new HttpProvider();
  return new NoProvider();
}
