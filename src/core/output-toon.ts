/**
 * Minimal TOON encoder (kernel 0.11.0): array-of-flat-objects → one header
 * row plus values. Nested objects / mixed rows fall back to JSON. Zero deps.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFlat(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && /[\t\n,]/.test(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function columnsOf(rows: readonly Record<string, unknown>[]): readonly string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

/** Encode `[{a,b}, …]` as `a,b\nv1,v2`. Anything else returns null (JSON fallback). */
export function encodeToon(data: unknown): string | null {
  if (!Array.isArray(data) || data.length === 0 || !data.every(isRecord)) return null;
  if (!data.every((row) => Object.values(row).every(isFlat))) return null;
  const columns = columnsOf(data);
  if (columns.length === 0) return null;
  const lines = [
    columns.join(','),
    ...data.map((row) => columns.map((column) => cell(row[column])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}
