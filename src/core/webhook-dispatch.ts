/**
 * `webhooks verify | listen | replay` leaves (Phase 2 L3). Routed before
 * resource commands. Secret is `<BIN>_WEBHOOK_SECRET` or `--secret`.
 */
import { flagValue, type ParsedArgv } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CliIo, CliSpec, CliWebhookConvention } from './model.js';
import { writeError, writeJson } from './output.js';
import { CONVENTIONS, verifyWebhook } from './webhook-verify.js';
import { runWebhookListen } from './webhook-listen.js';

export const WEBHOOK_LEAVES: ReadonlySet<string> = new Set(['verify', 'listen', 'replay']);

/** Machine `--schema` for a reserved webhook leaf (not an HTTP command). */
export function webhookLeafSchema(leaf: string): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `webhooks ${leaf}`,
    type: 'object',
    'x-operation-key': `webhooks.${leaf}`,
    properties: {
      body: { type: 'string', 'x-flag': 'body', 'x-body-escape': true },
      secret: { type: 'string', 'x-flag': 'secret' },
      convention: { type: 'string', 'x-flag': 'convention' },
      signature: { type: 'string', 'x-flag': 'signature' },
      'webhook-id': { type: 'string', 'x-flag': 'webhook-id' },
      'webhook-timestamp': { type: 'string', 'x-flag': 'webhook-timestamp' },
      port: { type: 'integer', 'x-flag': 'port' },
      bind: { type: 'string', 'x-flag': 'bind' },
    },
  };
}

/** Human help for a reserved webhook leaf. */
export function webhookLeafHelp(spec: CliSpec, leaf: string): readonly string[] {
  return [
    `${spec.bin} webhooks ${leaf}`,
    '',
    `usage: ${spec.bin} webhooks ${leaf} [flags]`,
    '',
    'flags: --secret --convention --signature --webhook-id --webhook-timestamp --body --port --bind --timeout-ms',
  ];
}

function secretOf(spec: CliSpec, parsed: ParsedArgv, io: CliIo): string | null {
  const fromFlag = flagValue(parsed.flags, 'secret');
  if (fromFlag !== undefined && fromFlag !== '') return fromFlag;
  const envName = `${spec.bin.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_')}_WEBHOOK_SECRET`;
  const fromEnv = io.env[envName];
  return fromEnv === undefined || fromEnv === '' ? null : fromEnv;
}

function conventionOf(spec: CliSpec, parsed: ParsedArgv): CliWebhookConvention | null {
  const raw = flagValue(parsed.flags, 'convention') ?? spec.webhookConvention ?? null;
  if (raw === null) return null;
  return (CONVENTIONS as readonly string[]).includes(raw) ? (raw as CliWebhookConvention) : null;
}

async function rawBody(parsed: ParsedArgv, io: CliIo): Promise<{ ok: true; body: string } | { ok: false; message: string }> {
  const inline = flagValue(parsed.flags, 'body');
  if (inline === undefined) return { ok: false, message: '--body is required (JSON or - for stdin)' };
  if (inline !== '-') return { ok: true, body: inline };
  if (io.stdin === undefined) return { ok: false, message: '--body - requires stdin (not available)' };
  return { ok: true, body: await io.stdin() };
}

async function verifyLeaf(spec: CliSpec, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const secret = secretOf(spec, parsed, io);
  if (secret === null) {
    writeError(io, EXIT_CODES.AUTH, `missing webhook secret: ${spec.bin.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_')}_WEBHOOK_SECRET or --secret`);
    return EXIT_CODES.AUTH;
  }
  const convention = conventionOf(spec, parsed);
  if (convention === null) {
    writeError(io, EXIT_CODES.CONFIG, 'webhook convention unknown; pass --convention github-hmac-sha256|standard-webhooks|stripe-v1');
    return EXIT_CODES.CONFIG;
  }
  const body = await rawBody(parsed, io);
  if (!body.ok) {
    writeError(io, EXIT_CODES.USAGE, body.message);
    return EXIT_CODES.USAGE;
  }
  const verified = await verifyWebhook({
    convention,
    rawBody: body.body,
    secret,
    signature: flagValue(parsed.flags, 'signature') ?? null,
    webhookId: flagValue(parsed.flags, 'webhook-id') ?? null,
    timestamp: flagValue(parsed.flags, 'webhook-timestamp') ?? null,
  });
  writeJson(io, { verified, convention, operationKey: 'webhooks.verify' });
  return verified ? EXIT_CODES.OK : EXIT_CODES.FINDINGS;
}

/** Route one webhook leaf. Verify failures are FINDINGS 1, never TIMEOUT 124. */
export async function runWebhookLeaf(
  spec: CliSpec,
  leaf: 'verify' | 'listen' | 'replay',
  parsed: ParsedArgv,
  io: CliIo,
): Promise<number> {
  if (leaf === 'verify' || leaf === 'replay') return verifyLeaf(spec, parsed, io);
  return runWebhookListen(spec, parsed, io, { secretOf, conventionOf });
}
