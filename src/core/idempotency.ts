/**
 * Idempotency-key injection for the generated CLI (Phase 0 C4c). The key is
 * resolved ONCE per logical request, BEFORE the retry loop, so every retry
 * of one call carries the SAME key. Auto-generation applies only to POST.
 * Vendored copy of the TS helper — E4: sibling imports only.
 */

export const DEFAULT_IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** `doctorine-cli-<uuid>` — runtime-unique (never hashed into builds). */
export function defaultIdempotencyKey(): string {
  return `doctorine-cli-${crypto.randomUUID()}`;
}

/** Explicit key wins; otherwise auto-generate for POST when a header is set. */
export function resolveIdempotencyKey(
  method: string,
  header: string | null,
  explicitKey?: string,
): string | undefined {
  if (explicitKey !== undefined && explicitKey !== '') return explicitKey;
  if (header === null || header === '') return undefined;
  if (method.toUpperCase() !== 'POST') return undefined;
  return defaultIdempotencyKey();
}

/** Stamp the key onto a header map (returns a new object). */
export function withIdempotencyHeader(
  headers: Readonly<Record<string, string>>,
  header: string | null,
  key: string | undefined,
): Readonly<Record<string, string>> {
  if (header === null || key === undefined) return headers;
  return { ...headers, [header]: key };
}
