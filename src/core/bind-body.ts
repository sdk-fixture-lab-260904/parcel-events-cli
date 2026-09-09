/**
 * Body-leaf merge for the generated CLI (Phase 2 C5). Promoted flags XOR
 * `--body`: both present is USAGE. Flags alone deep-set onto a fresh object.
 */
import type { CliCommandSpec } from './model.js';

export type BodyBind =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepSet(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next = target[head];
  const child = isPlainObject(next) ? next : {};
  target[head] = child;
  deepSet(child, rest, value);
}

function leafParams(command: CliCommandSpec): readonly { flag: string; path: readonly string[] }[] {
  return command.params
    .filter((param) => param.bodyPath !== undefined && param.bodyPath.length > 0)
    .map((param) => ({ flag: param.flag, path: param.bodyPath as readonly string[] }));
}

/** Merge promoted body flags with `--body`. Fail-closed when both are set. */
export function bindBodyLeaves(
  command: CliCommandSpec,
  values: Readonly<Record<string, unknown>>,
  jsonBody: unknown,
): BodyBind {
  const leaves = leafParams(command);
  const present = leaves.filter((leaf) => values[leaf.flag] !== undefined);
  if (present.length > 0 && jsonBody !== undefined) {
    return { ok: false, message: 'cannot combine body leaf flags with --body (pass flags or --body, not both)' };
  }
  if (present.length === 0) return { ok: true, body: jsonBody };
  const body: Record<string, unknown> = {};
  for (const leaf of present) deepSet(body, leaf.path, values[leaf.flag]);
  return { ok: true, body };
}
