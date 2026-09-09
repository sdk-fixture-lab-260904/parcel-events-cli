/**
 * Human stdout renderer for `--format pretty`. Never writes stderr.
 * Deterministic: no clock, locale, or random.
 */
import type { CliIo } from './model.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

function writePrettyTable(io: CliIo, rows: readonly Record<string, unknown>[]): void {
  const columns = columnsOf(rows);
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => cell(row[column]).length)));
  const line = (cells: readonly string[]): string =>
    cells.map((text, index) => text.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  io.stdout(`${line(columns)}\n`);
  io.stdout(`${line(widths.map((width) => '='.repeat(width)))}\n`);
  for (const row of rows) io.stdout(`${line(columns.map((column) => cell(row[column])))}\n`);
}

function writePrettyRecord(io: CliIo, data: Record<string, unknown>): void {
  const keys = Object.keys(data);
  const width = keys.reduce((max, key) => Math.max(max, key.length), 0);
  for (const key of keys) io.stdout(`${key.padEnd(width)}  ${cell(data[key])}\n`);
}

/** Pretty success payload on stdout. Objects → key/value; row arrays → table. */
export function writePretty(io: CliIo, data: unknown): void {
  if (Array.isArray(data) && data.length > 0 && data.every(isRecord)) {
    writePrettyTable(io, data);
    return;
  }
  if (isRecord(data)) {
    writePrettyRecord(io, data);
    return;
  }
  io.stdout(`${JSON.stringify(data, null, 2)}\n`);
}
