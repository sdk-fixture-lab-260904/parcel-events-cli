/**
 * Pagination locators for the CLI kernel. Pointers are IR `string[]`
 * segments (same grammar as skill `recipe-pagination.ts` `bodyAt`), not
 * the TS kernel's `$`-prefixed strings — the CLI_SPEC stores the IR shape.
 */

export function readPointer(body: unknown, pointer: readonly string[]): unknown {
  let current: unknown = body;
  for (const segment of pointer) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function itemsAt(body: unknown, pointer: readonly string[]): readonly unknown[] {
  const value = readPointer(body, pointer);
  return Array.isArray(value) ? value : [];
}

export function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

export interface PageQuery {
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly url: string;
}

export function withRoleValue(
  current: PageQuery,
  location: string,
  wireName: string,
  value: string | number,
): PageQuery {
  const rendered = String(value);
  if (location === 'header') {
    return { ...current, headers: { ...current.headers, [wireName]: rendered } };
  }
  if (location === 'query') {
    return { ...current, query: { ...current.query, [wireName]: rendered } };
  }
  throw new Error(`pagination role location "${location}" is not covered`);
}

export function readRoleValue(current: PageQuery, location: string, wireName: string): unknown {
  if (location === 'header') return current.headers[wireName];
  if (location === 'query') return current.query[wireName];
  return undefined;
}
