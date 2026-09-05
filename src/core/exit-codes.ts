/**
 * The generated CLI's FROZEN exit-code table (lab B9) — a verbatim mirror of
 * the Doctorine CLI contract (doc 30 §3.7, frozen in
 * `packages/cli-core/src/exit-codes.ts` and
 * `lab:doctorine-baseline/notes/01-our-cli-surface.md` §exit-codes). Codes are
 * a public contract: agents branch on them, so they are appended-only, never
 * reassigned. An agent that scripts `doctorine` and a generated CLI sees the
 * SAME numeric vocabulary for the SAME failure classes.
 */

export const EXIT_CODES = {
  OK: 0,
  FINDINGS: 1,
  USAGE: 2,
  CONFIG: 3,
  AUTH: 4,
  FORBIDDEN: 5,
  NOT_FOUND: 6,
  CONFLICT: 7,
  RATE_LIMITED: 8,
  SERVER: 9,
  VERSION_SKEW: 10,
  TIMEOUT: 124,
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** The stable machine-readable failure taxonomy (doc 30 §3.8 mirror). */
export type CliErrorKind =
  | 'findings'
  | 'usage'
  | 'config'
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'conflict'
  | 'stale_revision'
  | 'rate_limited'
  | 'server'
  | 'timeout'
  | 'interrupted';

const KIND_BY_CODE: Readonly<Record<number, CliErrorKind>> = {
  [EXIT_CODES.FINDINGS]: 'findings',
  [EXIT_CODES.USAGE]: 'usage',
  [EXIT_CODES.CONFIG]: 'config',
  [EXIT_CODES.AUTH]: 'auth',
  [EXIT_CODES.FORBIDDEN]: 'permission',
  [EXIT_CODES.NOT_FOUND]: 'not_found',
  [EXIT_CODES.CONFLICT]: 'conflict',
  [EXIT_CODES.VERSION_SKEW]: 'stale_revision',
  [EXIT_CODES.RATE_LIMITED]: 'rate_limited',
  [EXIT_CODES.SERVER]: 'server',
  [EXIT_CODES.TIMEOUT]: 'timeout',
  [EXIT_CODES.INTERRUPTED]: 'interrupted',
};

/** Map a non-zero exit code to its stable `kind`; unknown codes → `server`. */
export function errorKindForExitCode(code: number): CliErrorKind {
  return KIND_BY_CODE[code] ?? 'server';
}

/**
 * Map an HTTP response status to the frozen typed-failure code — the SAME
 * mapping the Doctorine CLI applies to its own API, so a 429 from any
 * generated CLI is exit 8 everywhere.
 */
export function exitCodeForStatus(status: number): ExitCode {
  switch (status) {
    case 401:
      return EXIT_CODES.AUTH;
    case 403:
      return EXIT_CODES.FORBIDDEN;
    case 404:
      return EXIT_CODES.NOT_FOUND;
    case 409:
      return EXIT_CODES.CONFLICT;
    case 412:
      return EXIT_CODES.VERSION_SKEW;
    case 429:
      return EXIT_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? EXIT_CODES.SERVER : EXIT_CODES.USAGE;
  }
}
