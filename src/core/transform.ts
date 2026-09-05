/**
 * Dot-path transform for successful CLI output (Phase 0 C1). Array indices
 * match `/^\d+$/u` — Scalar's generated runtime uses `/^\\d+$/u` (literal
 * backslash + d) and cannot index arrays. A missing path is USAGE, never
 * a silent empty success.
 */

export type TransformResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

const INDEX = /^\d+$/u;

/** Walk `a.b.0.c` over JSON-plain values. */
export function applyTransform(data: unknown, path: string): TransformResult {
  const trimmed = path.trim();
  if (trimmed === '') return { ok: false, message: 'invalid --transform (empty path)' };
  const segments = trimmed.split('.').filter((segment) => segment.length > 0);
  if (segments.length === 0) return { ok: false, message: 'invalid --transform (empty path)' };
  let current: unknown = data;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return { ok: false, message: `--transform path "${trimmed}" not found` };
    }
    if (Array.isArray(current) && INDEX.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return { ok: false, message: `--transform path "${trimmed}" not found` };
  }
  if (current === undefined) return { ok: false, message: `--transform path "${trimmed}" not found` };
  return { ok: true, value: current };
}
