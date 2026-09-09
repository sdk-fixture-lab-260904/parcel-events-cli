/**
 * OAuth2 client-credentials exchange for the generated CLI. Runs only when
 * the scheme carries an absolute token URL. The kernel never reads the
 * clock itself — callers inject `now` (tests use `io.now ?? (() => 0)`).
 */
import type { AuthMaterial } from './auth.js';
import type { CliIo } from './model.js';

export interface OauthCcRequest {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes?: readonly string[];
  readonly fetch: CliIo['fetch'];
  readonly now: () => number;
}

export type OauthCcResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly message: string };

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

const EARLY_REFRESH_MS = 60_000;
const cache = new Map<string, CachedToken>();

function cacheKey(tokenUrl: string, clientId: string): string {
  return `${tokenUrl}\0${clientId}`;
}

function isAbsoluteHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readAccessToken(body: unknown): string | null {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const accessToken = record['access_token'];
  return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
}

function readExpiresIn(body: unknown): number {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const expiresIn = record['expires_in'];
  return typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600;
}

function cachedToken(input: OauthCcRequest): string | null {
  const hit = cache.get(cacheKey(input.tokenUrl, input.clientId));
  if (hit === undefined) return null;
  if (hit.expiresAtMs - EARLY_REFRESH_MS <= input.now()) return null;
  return hit.accessToken;
}

function formBody(input: OauthCcRequest): string {
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.scopes !== undefined && input.scopes.length > 0) form.set('scope', input.scopes.join(' '));
  return form.toString();
}

async function fetchToken(input: OauthCcRequest): Promise<OauthCcResult> {
  const response = await input.fetch(input.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: formBody(input),
  });
  const body = parseJson(await response.text());
  if (!response.ok) return { ok: false, message: `OAuth token endpoint responded ${response.status}` };
  const accessToken = readAccessToken(body);
  if (accessToken === null) {
    return { ok: false, message: 'OAuth token endpoint returned a malformed body (no access_token)' };
  }
  cache.set(cacheKey(input.tokenUrl, input.clientId), {
    accessToken,
    expiresAtMs: input.now() + readExpiresIn(body) * 1000,
  });
  return { ok: true, accessToken };
}

/** Exchange client credentials for a bearer token. Relative URLs are refused. */
export async function exchangeClientCredentials(input: OauthCcRequest): Promise<OauthCcResult> {
  if (!isAbsoluteHttpUrl(input.tokenUrl)) {
    return { ok: false, message: 'OAuth token URL must be an absolute http(s) URL' };
  }
  const cached = cachedToken(input);
  if (cached !== null) return { ok: true, accessToken: cached };
  return fetchToken(input);
}

export type MaterializedAuth =
  | { readonly ok: true; readonly material: AuthMaterial }
  | { readonly ok: false; readonly message: string };

/** Live-only: fill Authorization from a pending client-credentials exchange. */
export async function materializeOauth(material: AuthMaterial, io: CliIo): Promise<MaterializedAuth> {
  const pending = material.oauthExchange;
  if (pending === undefined) return { ok: true, material };
  const exchanged = await exchangeClientCredentials({
    ...pending,
    fetch: io.fetch,
    now: io.now ?? ((): number => 0),
  });
  if (!exchanged.ok) return exchanged;
  return {
    ok: true,
    material: {
      headers: { ...material.headers, authorization: `Bearer ${exchanged.accessToken}` },
      query: material.query,
    },
  };
}
