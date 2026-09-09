/**
 * The command-tree walker + built-ins of the generated CLI (lab B9). One
 * `runCli(spec, argv, io)` entry: parse → resolve → dispatch. Built-ins
 * (`help`, `version`, `completion`, `auth`, root `--schema`) are resolved
 * from the SAME CliSpec data as operations — nothing is special-cased into
 * the binary. Every failure is a typed JSON error on stderr + a frozen exit
 * code; the kernel NEVER prompts and NEVER calls `process.exit` itself (the
 * bin entry maps the returned code).
 */
import { RETRY_UNSAFE_REQUESTS_FLAG } from './retries.js';
import { authEnvTemplate, authStatus, specAuthFlagNames } from './auth.js';
import { flagPresent, flagValue, parseArgv, type FlagArity, type ParsedArgv } from './argv.js';
import { bashCompletion, fishCompletion, zshCompletion } from './completion.js';
import { applyProfile, expandArgvAliases, loadCliConfig } from './config.js';
import { EXIT_CODES } from './exit-codes.js';
import { commandHelp, groupHelp, groupSchemaDocument, rootHelp, rootSchemaDocument } from './help.js';
import { findCommands, runFind } from './find.js';
import type { CliCommandSpec, CliIo, CliSpec } from './model.js';
import { CLI_OUTPUT_FORMATS, writeError, writeJson, writeWarning } from './output.js';
import { runResolve } from './resolve.js';
import { CLI_KERNEL_VERSION } from './version.js';
import { runCommand } from './run-command.js';
import { runWebhookLeaf, WEBHOOK_LEAVES, webhookLeafHelp, webhookLeafSchema } from './webhook-dispatch.js';

/** The flags every invocation accepts (unioned with the operation flags, so
 * a value-flag never swallows a command word regardless of position). */
export const ROOT_FLAG_ARITY: Readonly<Record<string, FlagArity>> = {
  help: 'boolean',
  version: 'boolean',
  format: 'value',
  fields: 'value',
  json: 'boolean',
  jsonl: 'boolean',
  raw: 'boolean',
  'dry-run': 'boolean',
  mock: 'boolean',
  example: 'value',
  schema: 'boolean',
  full: 'boolean',
  provenance: 'boolean',
  'fail-on-deprecated': 'boolean',
  'base-url': 'value',
  'timeout-ms': 'value',
  body: 'value',
  'max-items': 'value',
  'max-retries': 'value',
  [RETRY_UNSAFE_REQUESTS_FLAG]: 'boolean',
  transform: 'value',
  secret: 'value',
  convention: 'value',
  signature: 'value',
  'webhook-id': 'value',
  'webhook-timestamp': 'value',
  port: 'value',
  bind: 'value',
  'operation-key': 'value',
  profile: 'value',
};

/** The full arity table: globals + every operation's param flags. The UNION
 *  is required at PARSE time (the parser is single-pass and meets flags
 *  before the command resolves — a value-flag must never swallow a command
 *  word regardless of position); it is NOT an acceptance set — once a
 *  command is selected, `validateCommandFlags` re-checks every passed flag
 *  against THAT command's surface. */
function knownFlags(spec: CliSpec): Record<string, FlagArity> {
  const table: Record<string, FlagArity> = { ...ROOT_FLAG_ARITY };
  for (const flag of specAuthFlagNames(spec)) table[flag] = 'value';
  for (const command of spec.commands) {
    for (const param of command.params) {
      table[param.flag] = 'value';
      for (const alias of param.aliases ?? []) table[alias] = 'value';
    }
  }
  for (const entry of spec.catalog ?? []) {
    for (const flag of entry.flags) table[flag] = 'value';
  }
  return table;
}

/** The flags the SELECTED command accepts: the globals + its own params
 *  (`--body` only when the operation declares a request body). A flag of
 *  ANOTHER command parses fine off the union table but is meaningless here —
 *  silently discarding it would execute a call the invoker never asked for. */
const WEBHOOK_ONLY_FLAGS: readonly string[] = ['secret', 'convention', 'signature', 'webhook-id', 'webhook-timestamp', 'port', 'bind'];
const DISCOVERY_ONLY_FLAGS: readonly string[] = ['full', 'operation-key'];

function commandFlags(spec: CliSpec, command: CliCommandSpec): ReadonlySet<string> {
  const allowed = new Set([...Object.keys(ROOT_FLAG_ARITY), ...specAuthFlagNames(spec)]);
  if (command.body === null) allowed.delete('body');
  const webhookLeaf = command.path[0] === 'webhooks' && WEBHOOK_LEAVES.has(command.path[1] ?? '');
  if (!webhookLeaf) for (const flag of WEBHOOK_ONLY_FLAGS) allowed.delete(flag);
  for (const flag of DISCOVERY_ONLY_FLAGS) allowed.delete(flag);
  for (const param of command.params) {
    allowed.add(param.flag);
    for (const alias of param.aliases ?? []) allowed.add(alias);
  }
  return allowed;
}

/** Every passed flag validated against the selected command; each offender
 *  named, USAGE 2 (never a silent discard). Returns the exit code, or null
 *  when the invocation is clean. */
function validateCommandFlags(spec: CliSpec, command: CliCommandSpec, parsed: ParsedArgv, io: CliIo): number | null {
  const allowed = commandFlags(spec, command);
  const offenders = Object.keys(parsed.flags)
    .filter((flag) => !allowed.has(flag))
    .toSorted();
  if (offenders.length === 0) return null;
  writeError(
    io,
    EXIT_CODES.USAGE,
    `unknown flag(s) for "${command.path.join(' ')}": ${offenders.map((flag) => `--${flag}`).join(', ')}`,
    { command: command.id },
  );
  return EXIT_CODES.USAGE;
}

function printLines(io: CliIo, lines: readonly string[]): void {
  io.stdout(`${lines.join('\n')}\n`);
}

function pathMatch(path: readonly string[], positionals: readonly string[]): boolean {
  return path.length === positionals.length && path.every((word, i) => word === positionals[i]);
}

/** Exact-match one command against the positionals (eager table or catalog). */
async function matchCommand(
  spec: CliSpec,
  positionals: readonly string[],
  io: CliIo,
): Promise<CliCommandSpec | undefined> {
  const eager = spec.commands.find((command) => pathMatch(command.path, positionals));
  if (eager !== undefined) return eager;
  const entry = spec.catalog?.find((item) => pathMatch(item.path, positionals));
  if (entry === undefined || io.loadCommand === undefined) return undefined;
  return io.loadCommand(entry.id);
}

async function resolveHelp(spec: CliSpec, positionals: readonly string[], io: CliIo): Promise<number> {
  if (positionals.length === 0) {
    printLines(io, rootHelp(spec));
    return EXIT_CODES.OK;
  }
  const command = await matchCommand(spec, positionals, io);
  if (command !== undefined) {
    if (command.deprecated) {
      writeWarning(io, `deprecated command "${command.path.join(' ')}"`, {
        command: command.id,
        deprecated: true,
      });
    }
    printLines(io, commandHelp(spec, command));
    return EXIT_CODES.OK;
  }
  const group = groupHelp(spec, positionals[0] as string);
  if (group !== null) {
    printLines(io, group);
    return EXIT_CODES.OK;
  }
  writeError(io, EXIT_CODES.USAGE, `unknown command "${positionals.join(' ')}"`, {
    commands: commandIndex(spec, positionals),
  });
  return EXIT_CODES.USAGE;
}

const USAGE_COMMAND_CAP = 24;

/** Small CLIs dump every path; large CLIs emit group counts + a find hint. */
function commandIndex(spec: CliSpec, query: readonly string[] = []): unknown {
  const rows = spec.commands.length > 0 ? spec.commands : (spec.catalog ?? []);
  if (rows.length <= USAGE_COMMAND_CAP) {
    return rows.map((command) => command.path.join(' ')).toSorted();
  }
  const counts = new Map<string, number>();
  for (const command of rows) {
    const name = command.path[0] ?? '';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const groups = [...counts.entries()]
    .toSorted((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, count]) => ({ name, count }));
  const nearest = query.length === 0 ? [] : findCommands(spec, query, 3).map((hit) => hit.path.join(' '));
  return nearest.length === 0 ? { groups, hint: 'find' } : { groups, hint: 'find', nearest };
}

function resolveCompletion(spec: CliSpec, shell: string | undefined, io: CliIo): number {
  if (shell === 'bash') {
    io.stdout(bashCompletion(spec));
    return EXIT_CODES.OK;
  }
  if (shell === 'zsh') {
    io.stdout(zshCompletion(spec));
    return EXIT_CODES.OK;
  }
  if (shell === 'fish') {
    io.stdout(fishCompletion(spec));
    return EXIT_CODES.OK;
  }
  writeError(io, EXIT_CODES.USAGE, 'completion expects a shell: bash | zsh | fish');
  return EXIT_CODES.USAGE;
}

function resolveAuthCommand(spec: CliSpec, sub: string | undefined, io: CliIo, flags: ParsedArgv['flags']): number {
  if (sub === 'status') return authStatus(spec, io, flags);
  if (sub === 'env') return authEnvTemplate(spec, io);
  writeError(io, EXIT_CODES.USAGE, 'auth expects a subcommand: status | env');
  return EXIT_CODES.USAGE;
}

function printProvenance(spec: CliSpec, io: CliIo): number {
  writeJson(io, spec.provenance);
  return EXIT_CODES.OK;
}

/** Bare invocation / root flags: help, version, provenance, and --schema. */
function resolveRoot(spec: CliSpec, parsed: ParsedArgv, io: CliIo): number {
  if (flagPresent(parsed.flags, 'version')) return printVersion(spec, io);
  if (flagPresent(parsed.flags, 'provenance')) return printProvenance(spec, io);
  if (flagPresent(parsed.flags, 'schema')) {
    writeJson(io, rootSchemaDocument(spec, flagPresent(parsed.flags, 'full')));
    return EXIT_CODES.OK;
  }
  printLines(io, rootHelp(spec));
  return EXIT_CODES.OK;
}

/** `<bin> 1.2.3 (kernel X)` — the one version stamp line. */
function printVersion(spec: CliSpec, io: CliIo): number {
  io.stdout(`${spec.bin} ${spec.version} (kernel ${CLI_KERNEL_VERSION})\n`);
  return EXIT_CODES.OK;
}

/** Route one parsed invocation: built-ins first, then the command tree. The
 * `--version`/`--help` FLAGS are honored at ANY position — an operation path
 * must never swallow them into a live call (`pets list --version` prints the
 * version; `pets list --help` prints the command's help). */
function routeWebhookLeaf(
  spec: CliSpec,
  parsed: ParsedArgv,
  io: CliIo,
  leaf: 'verify' | 'listen' | 'replay',
): Promise<number> | number {
  if (flagPresent(parsed.flags, 'help')) {
    printLines(io, webhookLeafHelp(spec, leaf));
    return EXIT_CODES.OK;
  }
  if (flagPresent(parsed.flags, 'schema')) {
    writeJson(io, webhookLeafSchema(leaf));
    return EXIT_CODES.OK;
  }
  return runWebhookLeaf(spec, leaf, parsed, io);
}

function routeBuiltin(input: {
  readonly spec: CliSpec;
  readonly parsed: ParsedArgv;
  readonly io: CliIo;
  readonly head: string | undefined;
  readonly rest: readonly string[];
}): Promise<number> | number | null {
  const { spec, parsed, io, head, rest } = input;
  if (head === 'help') return resolveHelp(spec, rest, io);
  if (head === 'version') return printVersion(spec, io);
  if (head === 'provenance') return printProvenance(spec, io);
  if (head === 'completion') return resolveCompletion(spec, rest[0], io);
  if (head === 'find') return runFind(spec, parsed, io);
  if (head === 'resolve') return runResolve(spec, parsed, io);
  if (head === 'auth') return resolveAuthCommand(spec, rest[0], io, parsed.flags);
  return null;
}

function route(spec: CliSpec, parsed: ParsedArgv, io: CliIo): Promise<number> | number {
  const [head, ...rest] = parsed.positionals;
  if (flagPresent(parsed.flags, 'version')) return printVersion(spec, io);
  if (flagPresent(parsed.flags, 'provenance')) return printProvenance(spec, io);
  if (head === undefined) return resolveRoot(spec, parsed, io);
  const builtin = routeBuiltin({ spec, parsed, io, head, rest });
  if (builtin !== null) return builtin;
  if (head === 'webhooks' && WEBHOOK_LEAVES.has(rest[0] ?? '') && spec.webhookConvention !== undefined) {
    return routeWebhookLeaf(spec, parsed, io, rest[0] as 'verify' | 'listen' | 'replay');
  }
  if (flagPresent(parsed.flags, 'help')) return resolveHelp(spec, parsed.positionals, io);
  return finishRoute({ spec, parsed, io, head, rest });
}

async function finishRoute(input: {
  readonly spec: CliSpec;
  readonly parsed: ParsedArgv;
  readonly io: CliIo;
  readonly head: string;
  readonly rest: readonly string[];
}): Promise<number> {
  const { spec, parsed, io, head, rest } = input;
  const command = await matchCommand(spec, parsed.positionals, io);
  if (command !== undefined) {
    const refused = validateCommandFlags(spec, command, parsed, io);
    if (refused !== null) return refused;
    return runCommand(spec, command, parsed, io);
  }
  const group = groupHelp(spec, head);
  if (group !== null && rest.length === 0) {
    if (flagPresent(parsed.flags, 'schema')) {
      writeJson(io, groupSchemaDocument(spec, head, flagPresent(parsed.flags, 'full')));
      return EXIT_CODES.OK;
    }
    printLines(io, group);
    return EXIT_CODES.OK;
  }
  writeError(io, EXIT_CODES.USAGE, `unknown command "${parsed.positionals.join(' ')}"`, {
    commands: commandIndex(spec, parsed.positionals),
  });
  return EXIT_CODES.USAGE;
}

async function prepareCli(
  spec: CliSpec,
  argv: readonly string[],
  io: CliIo,
): Promise<{ readonly ok: true; readonly parsed: ParsedArgv; readonly io: CliIo } | { readonly ok: false; readonly code: number }> {
  const config = await loadCliConfig(spec, io);
  const parsed = parseArgv(expandArgvAliases(argv, config.aliases), knownFlags(spec));
  if (!parsed.ok) {
    for (const error of parsed.errors) writeError(io, EXIT_CODES.USAGE, error.message);
    return { ok: false, code: EXIT_CODES.USAGE };
  }
  const applied = applyProfile(io, config, flagValue(parsed.parsed.flags, 'profile'), spec.baseUrlEnv);
  if (!applied.ok) {
    writeError(io, EXIT_CODES.CONFIG, applied.message);
    return { ok: false, code: EXIT_CODES.CONFIG };
  }
  return { ok: true, parsed: parsed.parsed, io: applied.io };
}

/** The generated CLI's single entry point (see the module header). */
export async function runCli(spec: CliSpec, argv: readonly string[], io: CliIo): Promise<number> {
  const ready = await prepareCli(spec, argv, io);
  if (!ready.ok) return ready.code;
  if (flagValue(ready.parsed.flags, 'format') !== undefined) {
    const format = flagValue(ready.parsed.flags, 'format');
    if (format === undefined || !(CLI_OUTPUT_FORMATS as readonly string[]).includes(format)) {
      writeError(io, EXIT_CODES.USAGE, `invalid --format "${format}" (${CLI_OUTPUT_FORMATS.join(' | ')})`);
      return EXIT_CODES.USAGE;
    }
  }
  return route(spec, ready.parsed, ready.io);
}
