/**
 * Retry policy + backoff math (doc 38 §3.2 row 4). Vendored copy of the TS
 * kernel's pure functions — E4: the CLI kernel never imports kernels/ts.
 * Backoff is exponential WITHOUT jitter so retry schedules are reproducible.
 */

export type StatusMatcher = number | '4XX' | '5XX';

export interface RetryPolicy {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxElapsedMs: number;
  readonly exponent: number;
  readonly statusCodes: readonly StatusMatcher[];
  readonly retryConnectionErrors: boolean;
}

/** Mirrors the `retries:` defaults in the sdk-config schema, byte for byte. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  maxElapsedMs: 60_000,
  exponent: 2,
  statusCodes: [408, 429, '5XX'],
  retryConnectionErrors: true,
};

export function resolveRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...overrides };
}

export type RetryOutcome = { readonly kind: 'status'; readonly status: number } | { readonly kind: 'connection' };

export interface RetryState {
  readonly attempt: number;
  readonly elapsedMs: number;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
}

const NO_RETRY: RetryDecision = { retry: false, delayMs: 0 };

export function statusMatches(status: number, matcher: StatusMatcher): boolean {
  if (typeof matcher === 'number') return status === matcher;
  switch (matcher) {
    case '4XX':
      return status >= 400 && status < 500;
    case '5XX':
      return status >= 500 && status < 600;
    default:
      return unreachable(matcher);
  }
}

export function isRetryable(policy: RetryPolicy, outcome: RetryOutcome): boolean {
  switch (outcome.kind) {
    case 'connection':
      return policy.retryConnectionErrors;
    case 'status':
      return policy.statusCodes.some((matcher) => statusMatches(outcome.status, matcher));
    default:
      return unreachable(outcome);
  }
}

export function backoffDelayMs(policy: RetryPolicy, retryIndex: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(Math.max(retryAfterMs, 0), policy.maxElapsedMs);
  return Math.min(policy.initialDelayMs * policy.exponent ** retryIndex, policy.maxDelayMs);
}

export function nextRetryDecision(
  policy: RetryPolicy,
  state: RetryState,
  outcome: RetryOutcome,
  retryAfterMs?: number,
): RetryDecision {
  if (!policy.enabled || state.attempt >= policy.maxRetries) return NO_RETRY;
  if (!isRetryable(policy, outcome)) return NO_RETRY;
  const delayMs = backoffDelayMs(policy, state.attempt, retryAfterMs);
  if (state.elapsedMs + delayMs > policy.maxElapsedMs) return NO_RETRY;
  return { retry: true, delayMs };
}

export function parseRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/** `Retry-After` (seconds or HTTP-date) or `retry-after-ms` (milliseconds). */
export function retryAfterFromHeaders(headers: Headers, nowMs: number): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms !== null && /^\d+$/.test(ms.trim())) return Number(ms.trim());
  return parseRetryAfterMs(headers.get('retry-after'), nowMs);
}

function unreachable(value: never): never {
  throw new Error(`unreachable: ${String(value)}`);
}
