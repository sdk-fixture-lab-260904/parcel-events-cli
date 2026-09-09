/**
 * Completion path tree (kernel 1.0.0): next words up to depth 4, then the
 * selected command's flags. Command words only — never HTTP path blobs.
 */
import { RETRY_UNSAFE_REQUESTS_FLAG } from './retries.js';
import { specAuthFlagNames } from './auth-flags.js';
import { listedCommands } from './help.js';
import type { CliCatalogEntry, CliCommandSpec, CliSpec } from './model.js';

export const COMPLETION_DEPTH = 4;

const GLOBAL_FLAGS = [
  '--base-url',
  '--dry-run',
  '--example',
  '--fail-on-deprecated',
  '--fields',
  '--format',
  '--full',
  '--help',
  '--json',
  '--jsonl',
  '--max-items',
  '--max-retries',
  `--${RETRY_UNSAFE_REQUESTS_FLAG}`,
  '--mock',
  '--operation-key',
  '--profile',
  '--provenance',
  '--raw',
  '--schema',
  '--timeout-ms',
  '--transform',
  '--version',
] as const;

export function completionFlags(spec: CliSpec): readonly string[] {
  const extra = specAuthFlagNames(spec).map((flag) => `--${flag}`);
  return [...GLOBAL_FLAGS, ...extra];
}

function rowsOf(spec: CliSpec): readonly (CliCommandSpec | CliCatalogEntry)[] {
  return listedCommands(spec);
}

export function topLevelWords(spec: CliSpec): readonly string[] {
  const groups = new Set<string>();
  for (const command of rowsOf(spec)) {
    const first = command.path[0];
    if (first !== undefined) groups.add(first);
  }
  return [...groups, 'auth', 'completion', 'find', 'help', 'provenance', 'resolve', 'version'].toSorted();
}

function prefixKey(prefix: readonly string[]): string {
  return prefix.join('\0');
}

export function nextWords(spec: CliSpec, prefix: readonly string[]): readonly string[] {
  if (prefix.length >= COMPLETION_DEPTH) return [];
  const next = new Set<string>();
  for (const command of rowsOf(spec)) {
    if (command.path.length <= prefix.length) continue;
    if (!prefix.every((word, index) => command.path[index] === word)) continue;
    const word = command.path[prefix.length];
    if (word !== undefined) next.add(word);
  }
  return [...next].toSorted();
}

function flagsOf(row: CliCommandSpec | CliCatalogEntry): readonly string[] {
  if ('params' in row) {
    const names = row.params.flatMap((param) => [`--${param.flag}`, ...(param.aliases ?? []).map((alias) => `--${alias}`)]);
    return names.toSorted();
  }
  return row.flags.map((flag) => `--${flag}`).toSorted();
}

export function commandFlagsAt(spec: CliSpec, prefix: readonly string[]): readonly string[] | null {
  const row = rowsOf(spec).find(
    (command) => command.path.length === prefix.length && prefix.every((word, index) => command.path[index] === word),
  );
  return row === undefined ? null : flagsOf(row);
}

/** Unique prefixes of length 0..depth-1 (for static completion tables). */
export function completionPrefixes(spec: CliSpec): readonly (readonly string[])[] {
  const seen = new Set<string>(['']);
  const out: (readonly string[])[] = [[]];
  for (const command of rowsOf(spec)) {
    const limit = Math.min(command.path.length, COMPLETION_DEPTH);
    for (let n = 1; n <= limit; n += 1) {
      const prefix = command.path.slice(0, n);
      const key = prefixKey(prefix);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(prefix);
    }
  }
  return out;
}

export function wordsAfter(spec: CliSpec, prefix: readonly string[]): readonly string[] {
  const selected = commandFlagsAt(spec, prefix);
  const next = nextWords(spec, prefix);
  if (selected === null) return next;
  return [...next, ...selected, ...completionFlags(spec)].toSorted();
}
