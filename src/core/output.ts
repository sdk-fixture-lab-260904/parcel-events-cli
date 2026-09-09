/**
 * Output discipline for the generated CLI (lab B9) — agent-first:
 * machine-readable EVERYTHING. Successful data honors `--format
 * json|jsonl|table` (json is the default — agents are the primary reader;
 * table exists for humans at a TTY). Errors are ALWAYS one single-line JSON
 * object on stderr (`{"kind","message",...}`) with the frozen exit code on
 * the process — never prose an agent must scrape. `--json`/`--jsonl` are
 * boolean aliases for `--format`.
 */
import { errorKindForExitCode } from './exit-codes.js';
import type { CliIo, CliOutputFormat } from './model.js';
import { writePretty } from './output-pretty.js';
import { encodeToon } from './output-toon.js';
import { toYaml } from './yaml.js';

export const CLI_OUTPUT_FORMATS = ['json', 'jsonl', 'pretty', 'table', 'toon', 'yaml'] as const;

/** `--fields a,b,c` → ordered names. Empty / whitespace-only tokens drop. */
export function parseFieldList(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw.split(',').map((field) => field.trim()).filter((field) => field.length > 0);
}

function projectRow(row: unknown, fields: readonly string[]): unknown {
  if (!isRecord(row)) return row;
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = field in row ? row[field] : null;
  return out;
}

/** Project named fields before format. Missing keys become `null`, not USAGE. */
export function projectFields(data: unknown, fields: readonly string[]): unknown {
  if (fields.length === 0) return data;
  return Array.isArray(data) ? data.map((row) => projectRow(row, fields)) : projectRow(data, fields);
}

/** A row of the error envelope written to stderr. */
export function writeError(io: CliIo, exitCode: number, message: string, extra?: Readonly<Record<string, unknown>>): void {
  const envelope: Record<string, unknown> = {
    exitCode,
    kind: errorKindForExitCode(exitCode),
    message,
    ...extra,
  };
  io.stderr(`${JSON.stringify(envelope)}\n`);
}

/** Structured warning on stderr (no exitCode — invoke still proceeds). */
export function writeWarning(io: CliIo, message: string, extra?: Readonly<Record<string, unknown>>): void {
  io.stderr(`${JSON.stringify({ kind: 'warning', message, ...extra })}\n`);
}

/** Pretty-printed JSON value (2-space, key order as given) + newline. */
export function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** jsonl: one JSON value per line — arrays stream item-per-line. */
function writeJsonl(io: CliIo, data: unknown): void {
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) io.stdout(`${JSON.stringify(item)}\n`);
}

/** The union of every row's keys, first-seen order (stable columns). */
function tableColumns(rows: readonly Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

function tableCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** table: an array of flat objects renders as aligned columns; anything
 * else degrades honestly to pretty JSON (never a mangled half-table). */
function asTableRows(data: unknown): unknown {
  if (!Array.isArray(data) || data.length === 0) return data;
  if (data.every(isRecord)) return data;
  if (data.every((item) => item === null || typeof item !== 'object')) {
    return data.map((value) => ({ value }));
  }
  return data;
}

function writeTable(io: CliIo, data: unknown): void {
  const rows = asTableRows(data);
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(isRecord)) {
    writeJson(io, data);
    return;
  }
  const columns = tableColumns(rows);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => tableCell(row[column]).length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  io.stdout(`${line(columns)}\n`);
  io.stdout(`${line(widths.map((width) => '-'.repeat(width)))}\n`);
  for (const row of rows) io.stdout(`${line(columns.map((column) => tableCell(row[column])))}\n`);
}

/** Write a successful response payload in the negotiated format. */
export function writeData(io: CliIo, data: unknown, format: CliOutputFormat): void {
  if (format === 'jsonl') {
    writeJsonl(io, data);
    return;
  }
  if (format === 'table') {
    writeTable(io, data);
    return;
  }
  if (format === 'yaml') {
    io.stdout(toYaml(data));
    return;
  }
  if (format === 'toon') {
    io.stdout(encodeToon(data) ?? `${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  if (format === 'pretty') {
    writePretty(io, data);
    return;
  }
  writeJson(io, data);
}

/** Resolve `--format` + the `--json`/`--jsonl` aliases (alias wins when both
 * are passed — the explicit shorthand is the stronger signal). TTY default
 * is `table` only when `human` is true; pipes stay JSON. */
export function resolveFormat(
  format: string | undefined,
  json: boolean,
  jsonl: boolean,
  opts: { readonly human?: boolean; readonly raw?: boolean } = {},
): CliOutputFormat | null {
  if (jsonl) return 'jsonl';
  if (json || opts.raw === true) return 'json';
  if (format === undefined) return opts.human === true ? 'table' : 'json';
  return (CLI_OUTPUT_FORMATS as readonly string[]).includes(format) ? (format as CliOutputFormat) : null;
}
