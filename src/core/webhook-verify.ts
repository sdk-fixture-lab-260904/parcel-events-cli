/**
 * Closed webhook signature conventions (Phase 2 L3). Failures all return
 * false — no oracle. Conventions: GitHub HMAC, Standard Webhooks, Stripe v1.
 */
import type { CliWebhookConvention } from './model.js';
import { asBytes, hmacSha256, timingEqual, toBase64, toHex } from './webhook-crypto.js';

const GITHUB_PREFIX = 'sha256=';
const HEX64 = /^[0-9a-f]{64}$/;

export interface VerifyInput {
  readonly convention: CliWebhookConvention;
  readonly rawBody: string | Uint8Array;
  readonly secret: string;
  readonly signature: string | null;
  readonly webhookId?: string | null;
  readonly timestamp?: string | null;
}

async function verifyGithub(raw: string | Uint8Array, secret: string, header: string | null): Promise<boolean> {
  if (header === null || !header.startsWith(GITHUB_PREFIX)) return false;
  const digest = header.slice(GITHUB_PREFIX.length);
  if (!HEX64.test(digest)) return false;
  const expected = toHex(await hmacSha256(secret, asBytes(raw)));
  return timingEqual(expected, digest);
}

async function verifyStandard(input: VerifyInput): Promise<boolean> {
  const id = input.webhookId;
  const timestamp = input.timestamp;
  if (input.signature === null || id === null || id === undefined || timestamp === null || timestamp === undefined) {
    return false;
  }
  const body = typeof input.rawBody === 'string' ? input.rawBody : new TextDecoder().decode(input.rawBody);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const expected = toBase64(await hmacSha256(input.secret, signed));
  const candidates = input.signature.split(' ').flatMap((part) => {
    const [version, value] = part.split(',', 2);
    return version === 'v1' && value !== undefined ? [value] : [];
  });
  return candidates.some((value) => timingEqual(expected, value));
}

async function verifyStripe(raw: string | Uint8Array, secret: string, header: string | null): Promise<boolean> {
  if (header === null) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const eq = part.indexOf('=');
      return eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)];
    }),
  );
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (timestamp === undefined || signature === undefined) return false;
  const body = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  const expected = toHex(await hmacSha256(secret, new TextEncoder().encode(`${timestamp}.${body}`)));
  return timingEqual(expected, signature);
}

/** Verify one delivery. Unknown convention or missing fields → false. */
export async function verifyWebhook(input: VerifyInput): Promise<boolean> {
  switch (input.convention) {
    case 'github-hmac-sha256':
      return verifyGithub(input.rawBody, input.secret, input.signature);
    case 'standard-webhooks':
      return verifyStandard(input);
    case 'stripe-v1':
      return verifyStripe(input.rawBody, input.secret, input.signature);
  }
}

export const CONVENTIONS: readonly CliWebhookConvention[] = ['github-hmac-sha256', 'standard-webhooks', 'stripe-v1'];
