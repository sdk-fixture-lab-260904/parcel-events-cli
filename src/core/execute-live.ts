/**
 * Live send path for the generated CLI (Phase 0): retries, auto-page,
 * SSE/JSONL streaming, then `--transform` + formatted stdout.
 */
import { flagValue } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CliIo, CliRetryPolicy, ExecuteCtx } from './model.js';
import { parseFieldList, projectFields, writeData, writeError } from './output.js';
import { advancePage, pageQueryFromUrl, takeItems, urlFromPageQuery } from './pagination.js';
import { nextRetryDecision, retryAfterFromHeaders, type RetryPolicy } from './retries.js';
import { streamEvents } from './streaming.js';
import { applyTransform } from './transform.js';
import {
  readResponseBody,
  sendRequest,
  type BoundRequest,
  type ExecutionResult,
} from './transport.js';

export interface LiveInput {
  readonly ctx: ExecuteCtx;
  readonly request: BoundRequest;
  readonly timeoutMs: number;
  readonly maxItems: number | null;
  readonly policy: CliRetryPolicy;
}

function nowMs(io: CliIo): number {
  return io.now === undefined ? 0 : io.now();
}

async function sleepMs(io: CliIo, ms: number): Promise<void> {
  if (ms <= 0 || io.sleep === undefined) return;
  await io.sleep(ms);
}

async function sendWithRetry(
  request: BoundRequest,
  io: CliIo,
  timeoutMs: number,
  policy: RetryPolicy,
): Promise<{ readonly response: Response } | { readonly result: ExecutionResult }> {
  const started = nowMs(io);
  let attempt = 0;
  for (;;) {
    const sent = await sendRequest(request, io.fetch, timeoutMs);
    if (!sent.ok) {
      const decision = nextRetryDecision(
        policy,
        { attempt, elapsedMs: nowMs(io) - started },
        { kind: 'connection' },
      );
      if (!decision.retry) return { result: sent.result };
      await sleepMs(io, decision.delayMs);
      attempt += 1;
      continue;
    }
    if (sent.response.ok) return { response: sent.response };
    const retryAfter = retryAfterFromHeaders(sent.response.headers, nowMs(io));
    const decision = nextRetryDecision(
      policy,
      { attempt, elapsedMs: nowMs(io) - started },
      { kind: 'status', status: sent.response.status },
      retryAfter,
    );
    if (!decision.retry) return { result: await readResponseBody(sent.response) };
    await sleepMs(io, decision.delayMs);
    attempt += 1;
  }
}

function writeSuccess(ctx: ExecuteCtx, data: unknown, transform: string | undefined): number {
  let payload = data;
  if (transform !== undefined) {
    const extracted = applyTransform(data, transform);
    if (!extracted.ok) {
      writeError(ctx.io, EXIT_CODES.USAGE, extracted.message);
      return EXIT_CODES.USAGE;
    }
    payload = extracted.value;
  }
  payload = projectFields(payload, parseFieldList(flagValue(ctx.parsed.flags, 'fields')));
  if (payload !== null) writeData(ctx.io, payload, ctx.format);
  return EXIT_CODES.OK;
}

function failResult(io: CliIo, result: ExecutionResult): number {
  writeError(io, result.exitCode, result.error ?? 'request failed', { status: result.status, body: result.data });
  return result.exitCode;
}

async function runOnce(input: LiveInput): Promise<number> {
  const { ctx, request, timeoutMs, policy } = input;
  const sent = await sendWithRetry(request, ctx.io, timeoutMs, policy);
  if ('result' in sent) return failResult(ctx.io, sent.result);
  const result = await readResponseBody(sent.response);
  if (result.error !== null) return failResult(ctx.io, result);
  return writeSuccess(ctx, result.data, flagValue(ctx.parsed.flags, 'transform'));
}

function withPage(request: BoundRequest, url: string, headers: Readonly<Record<string, string>>): BoundRequest {
  return { ...request, url, headers };
}

async function runPager(input: LiveInput): Promise<number> {
  const { ctx, request, timeoutMs, maxItems, policy } = input;
  const binding = ctx.command.pagination;
  if (binding === null || maxItems === null) return runOnce(input);
  const collected: unknown[] = [];
  let current = pageQueryFromUrl(request.url, request.headers);
  for (;;) {
    const pageReq = withPage(request, urlFromPageQuery(current), current.headers);
    const sent = await sendWithRetry(pageReq, ctx.io, timeoutMs, policy);
    if ('result' in sent) return failResult(ctx.io, sent.result);
    const result = await readResponseBody(sent.response);
    if (result.error !== null) return failResult(ctx.io, result);
    const advanced = advancePage(binding, result.data, current);
    collected.push(...advanced.items);
    if (collected.length >= maxItems || advanced.next === null) break;
    current = advanced.next;
  }
  return writeSuccess(ctx, takeItems(collected, maxItems), flagValue(ctx.parsed.flags, 'transform'));
}

async function runStream(input: LiveInput): Promise<number> {
  const { ctx, request, timeoutMs, maxItems, policy } = input;
  const protocol = ctx.command.stream?.protocol;
  if (protocol === undefined) return runOnce(input);
  const sent = await sendWithRetry(request, ctx.io, timeoutMs, policy);
  if ('result' in sent) return failResult(ctx.io, sent.result);
  if (!sent.response.ok) return failResult(ctx.io, await readResponseBody(sent.response));
  if (isJsonResponse(sent.response)) {
    const result = await readResponseBody(sent.response);
    if (result.error !== null) return failResult(ctx.io, result);
    return writeSuccess(ctx, result.data, flagValue(ctx.parsed.flags, 'transform'));
  }
  return pipeStream(ctx, sent.response, protocol, maxItems);
}

function isJsonResponse(response: Response): boolean {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}

async function pipeStream(
  ctx: ExecuteCtx,
  response: Response,
  protocol: 'sse' | 'jsonl',
  maxItems: number | null,
): Promise<number> {
  const transform = flagValue(ctx.parsed.flags, 'transform');
  const live = ctx.format === 'jsonl';
  const buffered: unknown[] = [];
  let count = 0;
  try {
    for await (const event of streamEvents(response, protocol)) {
      const item = transformEvent(event, transform);
      if (!item.ok) {
        writeError(ctx.io, EXIT_CODES.USAGE, item.message);
        return EXIT_CODES.USAGE;
      }
      if (live) writeData(ctx.io, item.value, 'jsonl');
      else buffered.push(item.value);
      count += 1;
      if (maxItems !== null && count >= maxItems) break;
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    writeError(ctx.io, timedOut ? EXIT_CODES.TIMEOUT : EXIT_CODES.SERVER, error instanceof Error ? error.message : String(error));
    return timedOut ? EXIT_CODES.TIMEOUT : EXIT_CODES.SERVER;
  }
  if (!live) return writeSuccess(ctx, buffered, undefined);
  return EXIT_CODES.OK;
}

function transformEvent(event: unknown, transform: string | undefined): { ok: true; value: unknown } | { ok: false; message: string } {
  if (transform === undefined) return { ok: true, value: event };
  return applyTransform(event, transform);
}

/** Retry + page + stream + format one live request. */
export async function runLive(input: LiveInput): Promise<number> {
  if (input.ctx.command.stream?.protocol !== undefined) return runStream(input);
  if (input.ctx.command.pagination !== null && input.maxItems !== null) return runPager(input);
  return runOnce(input);
}
