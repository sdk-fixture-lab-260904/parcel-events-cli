/**
 * `find` built-in (kernel 0.10.0): score the catalog in-process. No network.
 * Tokens split on `/`, whitespace, `.`, `_`, `-`. Weights: path 3, key 2,
 * summary 1. Sort score desc, then operationKey asc. Default cap 25.
 */
import { flagValue, type ParsedArgv } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import { listedCommands } from './help.js';
import type { CliCatalogEntry, CliCommandSpec, CliIo, CliSpec } from './model.js';
import { writeError } from './output.js';

const DEFAULT_LIMIT = 25;
const SPLIT = /[\s./_-]+/u;

export interface FindHit {
  readonly score: number;
  readonly path: readonly string[];
  readonly operationKey: string;
  readonly method: string;
  readonly httpPath: string;
  readonly summary: string | null;
  readonly deprecated: boolean;
}

function tokensOf(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(SPLIT)
    .filter((token) => token.length > 0);
}

function queryTokens(words: readonly string[]): readonly string[] {
  return words.flatMap((word) => tokensOf(word));
}

function summaryOf(command: CliCommandSpec | CliCatalogEntry): string | null {
  if ('summary' in command && command.summary !== undefined && command.summary !== null) {
    return command.summary;
  }
  return null;
}

function scoreCommand(command: CliCommandSpec | CliCatalogEntry, query: readonly string[]): number {
  if (query.length === 0) return 0;
  const pathTokens = new Set([
    ...command.path.flatMap((word) => tokensOf(word)),
    ...tokensOf(command.httpPath),
    ...tokensOf(command.httpMethod),
  ]);
  const keyTokens = new Set(tokensOf(command.operationKey));
  const summaryTokens = new Set(tokensOf(summaryOf(command) ?? ''));
  let score = 0;
  for (const token of query) {
    if (pathTokens.has(token)) score += 3;
    if (keyTokens.has(token)) score += 2;
    if (summaryTokens.has(token)) score += 1;
  }
  return score;
}

function toHit(command: CliCommandSpec | CliCatalogEntry, score: number): FindHit {
  return {
    score,
    path: command.path,
    operationKey: command.operationKey,
    method: command.httpMethod,
    httpPath: command.httpPath,
    summary: summaryOf(command),
    deprecated: command.deprecated,
  };
}

export function findCommands(
  spec: CliSpec,
  query: readonly string[],
  limit: number,
): readonly FindHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  return listedCommands(spec)
    .map((command) => toHit(command, scoreCommand(command, tokens)))
    .filter((hit) => hit.score > 0)
    .toSorted((a, b) => (b.score !== a.score ? b.score - a.score : a.operationKey < b.operationKey ? -1 : 1))
    .slice(0, limit);
}

function parseLimit(raw: string | undefined): { readonly ok: true; readonly value: number } | { readonly ok: false } {
  if (raw === undefined) return { ok: true, value: DEFAULT_LIMIT };
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? { ok: true, value } : { ok: false };
}

/** `cli find <query…>` — JSONL hits on stdout. Empty query is USAGE. */
export function runFind(spec: CliSpec, parsed: ParsedArgv, io: CliIo): number {
  const query = parsed.positionals.slice(1);
  if (query.length === 0) {
    writeError(io, EXIT_CODES.USAGE, 'find expects a query (e.g. find droplets)');
    return EXIT_CODES.USAGE;
  }
  const limit = parseLimit(flagValue(parsed.flags, 'max-items'));
  if (!limit.ok) {
    writeError(io, EXIT_CODES.USAGE, 'find --max-items must be a positive integer');
    return EXIT_CODES.USAGE;
  }
  for (const hit of findCommands(spec, query, limit.value)) {
    io.stdout(`${JSON.stringify(hit)}\n`);
  }
  return EXIT_CODES.OK;
}
