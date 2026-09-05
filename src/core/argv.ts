/**
 * Argument parsing for the generated CLI (lab B9). Deliberately small and
 * total: every input produces a value or a structured `ArgvError` — the
 * parser NEVER throws and NEVER prints (dispatch owns all output). Grammar:
 * `--flag value`, `--flag=value`, bare boolean flags, repeated flags collect
 * in order, `--` ends flag parsing, `-h` is the one sanctioned short flag.
 */

export interface ParsedArgv {
  /** Non-flag words, in order (the command path + stray positionals). */
  readonly positionals: readonly string[];
  /** flag name → every value seen (`['true']` for a bare boolean flag). */
  readonly flags: Readonly<Record<string, readonly string[]>>;
}

export interface ArgvError {
  readonly message: string;
}

/** One flag's expected arity: value-taking flags consume the next word. */
export type FlagArity = 'boolean' | 'value';

type FlagValue =
  | { readonly ok: true; readonly value: string; readonly consumed: boolean }
  | { readonly ok: false };

/**
 * Parse `argv` against the flags the resolved command knows. Unknown flags
 * and missing values are reported, not thrown. `known` maps flag name →
 * arity; a bare word for a `value` flag is an error ("expects a value").
 */
export function parseArgv(
  argv: readonly string[],
  known: Readonly<Record<string, FlagArity>>,
): { readonly ok: true; readonly parsed: ParsedArgv } | { readonly ok: false; readonly errors: readonly ArgvError[] } {
  const state: ParseState = { positionals: [], flags: {}, errors: [], flagsDone: false };
  for (let i = 0; i < argv.length; i += 1) {
    const consumed = parseWord(argv[i] as string, argv[i + 1], known, state);
    if (consumed) i += 1;
  }
  if (state.errors.length > 0) return { ok: false, errors: state.errors };
  return { ok: true, parsed: { positionals: state.positionals, flags: state.flags } };
}

interface ParseState {
  readonly positionals: string[];
  readonly flags: Record<string, string[]>;
  readonly errors: ArgvError[];
  flagsDone: boolean;
}

/** One word of argv: positional, `--`, or a flag. Returns true when the
 * NEXT word was consumed as this flag's value. */
function parseWord(
  word: string,
  next: string | undefined,
  known: Readonly<Record<string, FlagArity>>,
  state: ParseState,
): boolean {
  if (state.flagsDone || word === '-' || !word.startsWith('-')) {
    state.positionals.push(word);
    return false;
  }
  if (word === '--') {
    state.flagsDone = true;
    return false;
  }
  const short = !word.startsWith('--');
  if (short && word !== '-h') {
    state.errors.push({ message: `unknown flag ${word} (only -h is short; use --long-form)` });
    return false;
  }
  const name = short ? 'help' : word.slice(2).split('=')[0] ?? '';
  const arity = known[name];
  if (arity === undefined) {
    state.errors.push({ message: `unknown flag --${name}` });
    return false;
  }
  const inline = word.includes('=') ? word.slice(word.indexOf('=') + 1) : null;
  const taken = takeValue(arity, inline, next);
  if (!taken.ok) {
    state.errors.push({ message: `flag --${name} expects a value` });
    return false;
  }
  state.flags[name] = [...(state.flags[name] ?? []), taken.value];
  return taken.consumed;
}

/** True when `word` is a flag token, never a value (`-h` or any `--long`). */
function isFlagToken(word: string): boolean {
  return word === '-h' || word.startsWith('--');
}

/** Resolve one flag's value: inline `=v`, the next word, or bare `true`. A
 * following FLAG token is never consumed as a value — `--pet-id --dry-run`
 * is "missing value", not "pet-id = --dry-run" (which would EXECUTE with a
 * garbage binding). The explicit `-` stdin marker stays a legal value; a
 * value that genuinely starts with `--` rides the inline `--flag=--value`
 * form. */
function takeValue(arity: FlagArity, inline: string | null, next: string | undefined): FlagValue {
  if (arity === 'boolean') return { ok: true, value: inline ?? 'true', consumed: false };
  if (inline !== null) return { ok: true, value: inline, consumed: false };
  if (next === undefined || isFlagToken(next)) return { ok: false };
  return { ok: true, value: next, consumed: true };
}

/** The single value of a non-repeatable flag (LAST wins — agents append). */
export function flagValue(flags: Readonly<Record<string, readonly string[]>>, name: string): string | undefined {
  const values = flags[name];
  return values === undefined ? undefined : values[values.length - 1];
}

/** True when a boolean flag was passed at all. */
export function flagPresent(flags: Readonly<Record<string, readonly string[]>>, name: string): boolean {
  return flags[name] !== undefined;
}
