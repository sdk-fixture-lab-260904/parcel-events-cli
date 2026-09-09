/**
 * Loopback webhook listener (Phase 2 L3). Default bind 127.0.0.1; JSONL
 * lines; SIGINT → 130; `--timeout-ms` → 124. Verify failure is FINDINGS 1
 * on the line, never 124.
 */
import { flagValue, type ParsedArgv } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CliIo, CliSpec, CliWebhookConvention } from './model.js';
import { writeError } from './output.js';
import { verifyWebhook } from './webhook-verify.js';

export interface ListenSecrets {
  readonly secretOf: (spec: CliSpec, parsed: ParsedArgv, io: CliIo) => string | null;
  readonly conventionOf: (spec: CliSpec, parsed: ParsedArgv) => CliWebhookConvention | null;
}

function headerOf(headers: Readonly<Record<string, string>>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function signatureHeader(convention: CliWebhookConvention, headers: Readonly<Record<string, string>>): string | null {
  if (convention === 'github-hmac-sha256') return headerOf(headers, 'x-hub-signature-256');
  if (convention === 'stripe-v1') return headerOf(headers, 'stripe-signature');
  return headerOf(headers, 'webhook-signature');
}

function bindOpts(
  spec: CliSpec,
  parsed: ParsedArgv,
): { readonly ok: true; readonly host: string; readonly port: number; readonly timeoutMs: number } | { readonly ok: false; readonly code: number; readonly message: string } {
  const host = flagValue(parsed.flags, 'bind') ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    return { ok: false, code: EXIT_CODES.USAGE, message: 'webhooks listen binds 127.0.0.1 only (pass --bind 127.0.0.1)' };
  }
  const port = Number(flagValue(parsed.flags, 'port') ?? '0');
  if (!Number.isInteger(port) || port < 0) {
    return { ok: false, code: EXIT_CODES.USAGE, message: 'invalid --port' };
  }
  return {
    ok: true,
    host,
    port,
    timeoutMs: Number(flagValue(parsed.flags, 'timeout-ms') ?? String(spec.defaultTimeoutMs)),
  };
}

function postHandler(
  io: CliIo,
  secret: string | null,
  convention: CliWebhookConvention | null,
): (request: { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: Uint8Array }) => Promise<{ status: number; body: string }> {
  return async (request) => {
    const raw = new TextDecoder().decode(request.body);
    const verified =
      secret !== null && convention !== null
        ? await verifyWebhook({
            convention,
            rawBody: raw,
            secret,
            signature: signatureHeader(convention, request.headers),
            webhookId: headerOf(request.headers, 'webhook-id'),
            timestamp: headerOf(request.headers, 'webhook-timestamp'),
          })
        : false;
    io.stdout(`${JSON.stringify({ operationKey: 'webhooks.listen', event: request.url, verified, payload: raw })}\n`);
    return { status: 200, body: '{"ok":true}' };
  };
}

/** Listen on loopback and print one JSONL event per POST. */
export async function runWebhookListen(
  spec: CliSpec,
  parsed: ParsedArgv,
  io: CliIo,
  secrets: ListenSecrets,
): Promise<number> {
  if (io.serve === undefined) {
    writeError(io, EXIT_CODES.CONFIG, 'webhooks listen requires a host serve hook');
    return EXIT_CODES.CONFIG;
  }
  const opts = bindOpts(spec, parsed);
  if (!opts.ok) {
    writeError(io, opts.code, opts.message);
    return opts.code;
  }
  const controller = new AbortController();
  let interrupted = false;
  const stop = io.onInterrupt?.(() => {
    interrupted = true;
    controller.abort();
  });
  const timer = opts.timeoutMs > 0 ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
  try {
    const handle = await io.serve({
      host: opts.host,
      port: opts.port,
      signal: controller.signal,
      handler: postHandler(io, secrets.secretOf(spec, parsed, io), secrets.conventionOf(spec, parsed)),
    });
    io.stdout(`${JSON.stringify({ operationKey: 'webhooks.listen', listening: true, host: opts.host, port: handle.port })}\n`);
    await waitAbort(controller.signal);
    await handle.close();
  } catch (error) {
    if (!interrupted && !(error instanceof Error && error.name === 'AbortError')) {
      writeError(io, EXIT_CODES.SERVER, error instanceof Error ? error.message : String(error));
      return EXIT_CODES.SERVER;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    stop?.();
  }
  return interrupted ? EXIT_CODES.INTERRUPTED : EXIT_CODES.TIMEOUT;
}

function waitAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
