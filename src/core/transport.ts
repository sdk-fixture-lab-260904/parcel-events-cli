import { fetchWithSignal } from './fetch-signal.js';
/**
 * Request binding + execution for the generated CLI (lab B9). Pure functions
 * build the request plan (URL fully bound, headers, body) from the command
 * spec + coerced flag values; the SAME plan is what `--dry-run` prints and
 * what `executeRequest` sends — a dry run is therefore a proof of the exact
 * wire request, not a separate code path. Errors map onto the frozen exit
 * codes (doc 30 §3.7 mirror); the response body is returned uninterpreted
 * (the CLI is a thin, honest wire client — no response-model guessing).
 */
import { EXIT_CODES, exitCodeForStatus, type ExitCode } from './exit-codes.js';
import type { CliCommandSpec, CliParamSpec } from './model.js';
import { describeBody } from './uploads.js';
import { serializeParameter } from './parameter-serialization.js';

/** Fetch body without depending on the DOM `BodyInit` global (generated tsconfig is ES2023 + @types/node). */
export type CliWireBody = NonNullable<RequestInit['body']>;

export interface BoundRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: CliWireBody | null;
}

export type BindingResult =
  | { readonly ok: true; readonly request: BoundRequest }
  | { readonly ok: false; readonly message: string };

function coerceNumber(raw: string, integer: boolean): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || raw.trim() === '') return null;
  return integer && !Number.isInteger(value) ? null : value;
}

/** Coerce one raw flag value to its wire type; `null` = invalid (USAGE). */
export function coerceValue(param: CliParamSpec, raw: string): unknown {
  switch (param.type) {
    case 'string':
      return raw;
    case 'boolean':
      return raw === 'true' || raw === '1' ? true : raw === 'false' || raw === '0' ? false : null;
    case 'number':
    case 'integer':
      return coerceNumber(raw, param.type === 'integer');
    case 'json':
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    case 'file':
      return raw;
  }
}

function appendQuery(search: string[], name: string, value: unknown): void {
  const fragment = serializeParameter(name, value, 'query');
  if (fragment !== '') search.push(fragment);
}

/** The inputs of one request binding (one object — the max-params law). */
export interface BindRequestInput {
  readonly command: CliCommandSpec;
  readonly values: Readonly<Record<string, unknown>>;
  readonly baseUrl: string;
  readonly auth: { readonly headers: Readonly<Record<string, string>>; readonly query: Readonly<Record<string, string>> };
  readonly body: CliWireBody | undefined;
  readonly contentType: string | null;
}

function appendCookie(headers: Record<string, string>, encoded: string): void {
  if (encoded !== '') headers['cookie'] = headers['cookie'] ? `${headers['cookie']}; ${encoded}` : encoded;
}

/** Bind coerced values onto method/URL/headers/body (path params encoded). */
export function bindRequest(input: BindRequestInput): BoundRequest {
  const { command, values, baseUrl, auth, body, contentType } = input;
  let path = command.httpPath;
  const search: string[] = [];
  const headers: Record<string, string> = { ...auth.headers };
  for (const param of command.params) {
    const value = values[param.flag];
    if (value === undefined || param.in === 'body') continue;
    const encoded = serializeParameter(param.wireName, value, param.in, param.serialization);
    if (param.in === 'path') {
      path = path.replaceAll(`{${param.wireName}}`, encoded);
    } else if (param.in === 'query') {
      if (encoded !== '') search.push(encoded);
    } else if (param.in === 'header') {
      headers[param.wireName] = encoded;
    } else {
      appendCookie(headers, encoded);
    }
  }
  for (const [name, value] of Object.entries(auth.query)) appendQuery(search, name, value);
  const query = search.length === 0 ? '' : `${path.includes('?') ? '&' : '?'}${search.join('&')}`;
  if (body !== undefined && contentType !== null) headers['content-type'] = contentType;
  return {
    method: command.httpMethod,
    url: `${baseUrl}${path}${query}`,
    headers,
    body: body === undefined ? null : body,
  };
}

/** Collect + coerce every declared flag value; reports the FIRST bad flag. */
export function coerceParams(
  command: CliCommandSpec,
  flags: Readonly<Record<string, readonly string[]>>,
): { readonly ok: true; readonly values: Record<string, unknown> } | { readonly ok: false; readonly message: string } {
  const values: Record<string, unknown> = {};
  for (const param of command.params) {
    const raw = flags[param.flag];
    if (raw === undefined) continue;
    const coerced = raw.map((entry) => coerceValue(param, entry));
    if (coerced.some((entry, index) => entry === null && !(param.type === 'json' && raw[index]?.trim() === 'null'))) {
      return { ok: false, message: `invalid value for --${param.flag} (expected ${param.type})` };
    }
    values[param.flag] = coerced.length === 1 ? coerced[0] : coerced;
  }
  return { ok: true, values };
}

export interface ExecutionResult {
  readonly exitCode: ExitCode;
  readonly status: number | null;
  /** The parsed JSON body, or the raw text, or null (empty body / dry run). */
  readonly data: unknown;
  readonly error: string | null;
}

/** The credential carriers a dry run redacts (header names + query params). */
export interface RedactedAuth {
  readonly headers: readonly string[];
  readonly query: readonly string[];
}

/** `?api_key=top-secret` → `?api_key=***` — query auth redacts like headers. */
function redactUrlQuery(url: string, names: readonly string[]): string {
  if (names.length === 0) return url;
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;
  const redacted = url
    .slice(qIndex + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        // an undecodable name can never equal a declared wire name — keep it
      }
      return names.includes(decoded) ? `${name}=***` : pair;
    });
  return `${url.slice(0, qIndex)}?${redacted.join('&')}`;
}

/** The `--dry-run` plan: the exact request, auth REDACTED, never sent. */
export function dryRunPlan(request: BoundRequest, redactedAuth: RedactedAuth): Record<string, unknown> {
  const headers: Record<string, string> = { ...request.headers };
  for (const name of redactedAuth.headers) {
    if (headers[name] !== undefined) headers[name] = '***';
  }
  return {
    dryRun: true,
    method: request.method,
    url: redactUrlQuery(request.url, redactedAuth.query),
    headers,
    body: describeBody(request.body),
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export type SendResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly result: ExecutionResult };

/** Send the bound request; do not read the body (streaming / pager own that). */
export async function sendRequest(
  request: BoundRequest,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs: number,
): Promise<SendResult> {
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchWithSignal(fetchFn, request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal,
    }, signal);
    return { ok: true, response };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      result: {
        exitCode: timedOut ? EXIT_CODES.TIMEOUT : EXIT_CODES.SERVER,
        status: null,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function readResponseBody(response: Response): Promise<ExecutionResult> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return {
      exitCode: EXIT_CODES.SERVER,
      status: response.status,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const data = text === '' ? null : (tryParseJson(text) ?? text);
  if (response.ok) return { exitCode: EXIT_CODES.OK, status: response.status, data, error: null };
  return {
    exitCode: exitCodeForStatus(response.status),
    status: response.status,
    data,
    error: `HTTP ${response.status}`,
  };
}

/** Send the bound request via the injected fetch; classify the outcome. */
export async function executeRequest(
  request: BoundRequest,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  timeoutMs: number,
): Promise<ExecutionResult> {
  const sent = await sendRequest(request, fetchFn, timeoutMs);
  return sent.ok ? readResponseBody(sent.response) : sent.result;
}
