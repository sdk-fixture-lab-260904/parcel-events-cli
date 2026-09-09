/**
 * Operation execution for the generated CLI (Phase 0): resolve URL / auth /
 * body / files, print a dry-run plan, or hand off to the live retry/page/
 * stream path. Split from `run-command.ts` for the ≤400-line cap.
 */
import { flagPresent, flagValue, type ParsedArgv } from './argv.js';
import { preferredAuthSchemes, resolveAuth, type AuthMaterial } from './auth.js';
import { EXIT_CODES } from './exit-codes.js';
import { runLive } from './execute-live.js';
import { writeMockResponse } from './execute-mock.js';
import { materializeOauth } from './oauth-client-credentials.js';
import { resolveIdempotencyKey, withIdempotencyHeader } from './idempotency.js';
import type { CliCommandSpec, CliIo, CliRetryPolicy, CliSpec, ExecuteCtx } from './model.js';

export type { ExecuteCtx };
import { writeError, writeJson } from './output.js';
import { canReplayRequest, resolveRetryPolicy, RETRY_UNSAFE_REQUESTS_FLAG } from './retries.js';
import { bindRequest, coerceParams, dryRunPlan, type RedactedAuth, type BoundRequest } from './transport.js';
import { bindBodyLeaves } from './bind-body.js';
import { assembleBody, type AssembledBody } from './uploads.js';
import { validateRequest } from './request-validation.js';

function resolveBaseUrl(spec: CliSpec, parsed: ParsedArgv, io: CliIo): string | null {
  const fromFlag = flagValue(parsed.flags, 'base-url');
  if (fromFlag !== undefined && fromFlag !== '') return fromFlag.replace(/\/+$/, '');
  const fromEnv = io.env[spec.baseUrlEnv];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '');
  if (spec.baseUrl !== '') return spec.baseUrl.replace(/\/+$/, '');
  return null;
}

function isAbsoluteHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveTimeout(spec: CliSpec, parsed: ParsedArgv): number | null {
  const raw = flagValue(parsed.flags, 'timeout-ms');
  if (raw === undefined) return spec.defaultTimeoutMs;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function resolveMaxItems(parsed: ParsedArgv): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  const raw = flagValue(parsed.flags, 'max-items');
  if (raw === undefined) return { ok: true, value: null };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { ok: true, value } : { ok: false };
}

export function resolveRetryOverride(
  spec: CliSpec,
  parsed: ParsedArgv,
): { readonly ok: true; readonly policy: CliRetryPolicy } | { readonly ok: false } {
  const raw = flagValue(parsed.flags, 'max-retries');
  if (raw === undefined) return { ok: true, policy: resolveRetryPolicy(spec.retries) };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, policy: resolveRetryPolicy({ ...spec.retries, maxRetries: value }) };
}

function placeholderAuth(spec: CliSpec, command: CliCommandSpec): AuthMaterial {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const scheme of preferredAuthSchemes(spec, command)) {
    if (scheme.type === 'apiKey' && scheme.in === 'header') headers[scheme.wireName] = '***';
    else if (scheme.type === 'apiKey') query[scheme.wireName] = '***';
    else headers['authorization'] = '***';
  }
  return { headers, query };
}

function redactedAuth(spec: CliSpec, command: CliCommandSpec): RedactedAuth {
  const headers: string[] = [];
  const query: string[] = [];
  for (const scheme of preferredAuthSchemes(spec, command)) {
    if (scheme.type === 'apiKey' && scheme.in === 'header') headers.push(scheme.wireName);
    else if (scheme.type === 'apiKey') query.push(scheme.wireName);
    else headers.push('authorization');
  }
  return { headers, query };
}

function parseBody(
  command: CliCommandSpec,
  raw: string,
  origin: 'inline' | 'stdin',
): { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly message: string } {
  const media = command.body?.contentType;
  if (media !== undefined && !media.includes('json') && !media.startsWith('multipart/')
    && media !== 'application/x-www-form-urlencoded') return { ok: true, body: raw };
  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return command.body === null || command.body.contentType.includes('json')
      ? { ok: false, message: `--body${origin === 'stdin' ? ' -' : ''} is not valid JSON` }
      : { ok: true, body: raw };
  }
}

async function readBody(
  command: CliCommandSpec,
  parsed: ParsedArgv,
  io: CliIo,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly message: string }> {
  const raw = flagValue(parsed.flags, 'body');
  if (raw === undefined) return { ok: true, body: undefined };
  if (raw !== '-') return parseBody(command, raw, 'inline');
  if (io.stdin === undefined) return { ok: false, message: '--body - requires stdin (not available)' };
  return parseBody(command, await io.stdin(), 'stdin');
}

interface StreamBindingResult {
  readonly ok: true;
  readonly body: unknown;
  readonly values: Readonly<Record<string, unknown>>;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Force the configured streaming discriminator onto the actual wire plane.
 * IR admission guarantees it names either a declared query parameter or a
 * top-level body property. The CLI deliberately exposes one streaming command,
 * so callers never need a second `--stream true` switch. */
function forceStreamingDiscriminator(
  command: CliCommandSpec,
  values: Readonly<Record<string, unknown>>,
  body: unknown,
): StreamBindingResult | { readonly ok: false; readonly message: string } {
  const discriminator = command.stream?.paramDiscriminator;
  if (discriminator === null || discriminator === undefined) return { ok: true, values, body };
  const query = command.params.find((param) => param.in === 'query' && param.wireName === discriminator);
  if (query !== undefined) return { ok: true, values: { ...values, [query.flag]: true }, body };
  if (command.body === null || (body !== undefined && !isPlainObject(body))) {
    return { ok: false, message: `streaming discriminator "${discriminator}" requires a JSON object body` };
  }
  const inputBody = isPlainObject(body) ? body : {};
  return { ok: true, values, body: { ...inputBody, [discriminator]: true } };
}

function resolveCallAuth(input: {
  readonly spec: CliSpec;
  readonly command: CliCommandSpec;
  readonly io: CliIo;
  readonly dryRun: boolean;
  readonly flags: ExecuteCtx['parsed']['flags'];
}): { readonly ok: true; readonly material: AuthMaterial } | { readonly ok: false; readonly missing: readonly string[] } {
  const auth = resolveAuth(input.spec, input.io.env, input.flags, input.command);
  if (auth.ok) return auth;
  if (input.dryRun) return { ok: true, material: placeholderAuth(input.spec, input.command) };
  return auth;
}

/** Bind + dry-run or live-send one resolved command. */
export async function executeCommand(ctx: ExecuteCtx): Promise<number> {
  const { spec, parsed, io } = ctx;
  const baseUrl = resolveBaseUrl(spec, parsed, io);
  if (baseUrl === null) {
    writeError(io, EXIT_CODES.CONFIG, `no base URL: pass --base-url or set ${spec.baseUrlEnv}`);
    return EXIT_CODES.CONFIG;
  }
  if (!isAbsoluteHttpUrl(baseUrl)) {
    writeError(io, EXIT_CODES.CONFIG, `invalid base URL "${baseUrl}" (expected an absolute http(s) URL)`);
    return EXIT_CODES.CONFIG;
  }
  const timeoutMs = resolveTimeout(spec, parsed);
  if (timeoutMs === null) {
    writeError(io, EXIT_CODES.USAGE, 'invalid --timeout-ms (positive integer milliseconds)');
    return EXIT_CODES.USAGE;
  }
  return bindAndRun({ ctx, baseUrl, timeoutMs });
}

async function bindAndRun(input: {
  readonly ctx: ExecuteCtx;
  readonly baseUrl: string;
  readonly timeoutMs: number;
}): Promise<number> {
  const { ctx, baseUrl, timeoutMs } = input;
  const { spec, parsed, io } = ctx;
  const maxItems = resolveMaxItems(parsed);
  if (!maxItems.ok) {
    writeError(io, EXIT_CODES.USAGE, 'invalid --max-items (positive integer)');
    return EXIT_CODES.USAGE;
  }
  if (maxItems.value !== null && ctx.command.pagination === null && !ctx.command.streaming) {
    writeError(io, EXIT_CODES.USAGE, '--max-items requires a paginated or streaming command (single-shot only)', {
      command: ctx.command.id,
    });
    return EXIT_CODES.USAGE;
  }
  const retries = resolveRetryOverride(spec, parsed);
  if (!retries.ok) {
    writeError(io, EXIT_CODES.USAGE, 'invalid --max-retries (integer ≥ 0)');
    return EXIT_CODES.USAGE;
  }
  const dryRun = flagPresent(parsed.flags, 'dry-run');
  const mock = flagPresent(parsed.flags, 'mock');
  if (ctx.command.inbound === true && !dryRun && !mock) {
    writeError(io, EXIT_CODES.USAGE, 'inbound webhook commands cannot be sent; use webhooks verify|listen|replay', {
      command: ctx.command.id,
    });
    return EXIT_CODES.USAGE;
  }
  const auth = resolveCallAuth({ spec, command: ctx.command, io, dryRun: dryRun || mock, flags: parsed.flags });
  if (!auth.ok) {
    writeError(io, EXIT_CODES.AUTH, `missing credential env var(s): ${auth.missing.join(', ')}`, {
      hint: `run "${spec.bin} auth env" for the export template`,
    });
    return EXIT_CODES.AUTH;
  }
  return sendBound({
    ctx,
    baseUrl,
    timeoutMs,
    maxItems: maxItems.value,
    policy: retries.policy,
    dryRun,
    mock,
    auth: auth.material,
  });
}

async function sendBound(input: {
  readonly ctx: ExecuteCtx;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxItems: number | null;
  readonly policy: CliRetryPolicy;
  readonly dryRun: boolean;
  readonly mock: boolean;
  readonly auth: AuthMaterial;
}): Promise<number> {
  const { ctx, baseUrl, timeoutMs, maxItems, policy, dryRun, mock, auth } = input;
  const { spec, command, parsed, io } = ctx;
  const resolved = await resolveInputs(ctx);
  if (!resolved.ok) {
    writeError(io, EXIT_CODES.USAGE, resolved.message, { command: command.id });
    return EXIT_CODES.USAGE;
  }
  const key = resolveIdempotencyKey(command.httpMethod, spec.idempotencyHeader);
  let request: BoundRequest;
  try {
    request = bindRequest({ command, values: resolved.values, baseUrl,
      auth: { headers: withIdempotencyHeader(auth.headers, spec.idempotencyHeader, key), query: auth.query },
      body: resolved.assembled.body, contentType: resolved.assembled.contentType });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    writeError(io, EXIT_CODES.USAGE, error.message, { command: command.id });
    return EXIT_CODES.USAGE;
  }
  const ready = !dryRun && !mock ? await materializeOauth(auth, io) : { ok: true as const, material: auth };
  if (!ready.ok) { writeError(io, EXIT_CODES.AUTH, ready.message); return EXIT_CODES.AUTH; }
  request = { ...request, headers: { ...request.headers, ...ready.material.headers } };
  const effectivePolicy = canReplayRequest(command.httpMethod, request.headers, spec.idempotencyHeader,
    flagValue(parsed.flags, RETRY_UNSAFE_REQUESTS_FLAG) === 'true') ? policy : { ...policy, enabled: false };
  if (dryRun) {
    writeDryRun(ctx, request, effectivePolicy);
    return EXIT_CODES.OK;
  }
  if (mock) return writeMockResponse(ctx, maxItems);
  return runLive({ ctx, request, timeoutMs, maxItems, policy: effectivePolicy });
}


type ResolvedInputs = { readonly ok: true; readonly values: Readonly<Record<string, unknown>>; readonly assembled: AssembledBody }
  | { readonly ok: false; readonly message: string };

async function resolveInputs(ctx: ExecuteCtx): Promise<ResolvedInputs> {
  const { command, parsed, io } = ctx;
  const coerced = coerceParams(command, parsed.flags);
  if (!coerced.ok) return coerced;
  const jsonBody = await readBody(command, parsed, io);
  if (!jsonBody.ok) return jsonBody;
  const merged = bindBodyLeaves(command, coerced.values, jsonBody.body);
  if (!merged.ok) return merged;
  const streamed = forceStreamingDiscriminator(command, coerced.values, merged.body);
  if (!streamed.ok) return streamed;
  const assembled = await assembleBody(command, streamed.values, streamed.body, io);
  if (!assembled.ok) return assembled;
  const invalid = validateRequest(command, streamed.values, streamed.body, assembled.assembled);
  return invalid === null ? { ok: true, values: streamed.values, assembled: assembled.assembled } : { ok: false, message: invalid };
}


function writeDryRun(ctx: ExecuteCtx, request: BoundRequest, policy: CliRetryPolicy): void {
  const { spec, command, io } = ctx;
  writeJson(io, {
    ...dryRunPlan(request, redactedAuth(spec, command)),
    operationKey: command.operationKey,
    paginated: command.paginated,
    pagination: command.pagination,
    streaming: command.streaming,
    retries: policy,
  });
}
