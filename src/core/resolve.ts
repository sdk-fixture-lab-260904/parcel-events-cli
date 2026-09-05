/**
 * `resolve` built-in (kernel 0.10.0): bind an `x-operation-key` to argv
 * without scraping help. Missing key is NOT_FOUND 6 with a `find` hint.
 */
import { flagValue, type ParsedArgv } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import { listedCommands } from './help.js';
import type { CliCatalogEntry, CliCommandSpec, CliIo, CliSpec } from './model.js';
import { writeError, writeJson } from './output.js';

export interface ResolveHit {
  readonly operationKey: string;
  readonly path: readonly string[];
  readonly requiredFlags: readonly string[];
  readonly optionalFlags: readonly string[];
  readonly paginated: boolean;
  readonly deprecated: boolean;
  readonly schemaRef: string;
}

function fromCommand(spec: CliSpec, command: CliCommandSpec): ResolveHit {
  const required = command.params.filter((param) => param.required).map((param) => param.flag);
  const optional = command.params.filter((param) => !param.required).map((param) => param.flag);
  if (command.body !== null && command.body.required) required.push('body');
  else if (command.body !== null) optional.push('body');
  return {
    operationKey: command.operationKey,
    path: command.path,
    requiredFlags: required,
    optionalFlags: optional,
    paginated: command.paginated,
    deprecated: command.deprecated,
    schemaRef: `${spec.bin} ${command.path.join(' ')} --schema`,
  };
}

function fromEntry(spec: CliSpec, entry: CliCatalogEntry): ResolveHit {
  return {
    operationKey: entry.operationKey,
    path: entry.path,
    requiredFlags: [],
    optionalFlags: entry.flags,
    paginated: entry.paginated,
    deprecated: entry.deprecated,
    schemaRef: `${spec.bin} ${entry.path.join(' ')} --schema`,
  };
}

function keyOf(parsed: ParsedArgv): string | undefined {
  const flagged = flagValue(parsed.flags, 'operation-key');
  if (flagged !== undefined && flagged.length > 0) return flagged;
  const rest = parsed.positionals.slice(1).join(' ').trim();
  return rest.length > 0 ? rest : undefined;
}

async function loadMatch(
  spec: CliSpec,
  key: string,
  io: CliIo,
): Promise<CliCommandSpec | CliCatalogEntry | undefined> {
  const eager = spec.commands.find((command) => command.operationKey === key);
  if (eager !== undefined) return eager;
  const listed = listedCommands(spec).find((command) => command.operationKey === key);
  if (listed === undefined) return undefined;
  if ('params' in listed) return listed;
  if (io.loadCommand === undefined) return listed;
  return io.loadCommand(listed.id);
}

/** `cli resolve --operation-key "get /v2/droplets"` (positional key also ok). */
export async function runResolve(spec: CliSpec, parsed: ParsedArgv, io: CliIo): Promise<number> {
  const key = keyOf(parsed);
  if (key === undefined) {
    writeError(io, EXIT_CODES.USAGE, 'resolve expects --operation-key or a positional key');
    return EXIT_CODES.USAGE;
  }
  const match = await loadMatch(spec, key, io);
  if (match === undefined) {
    writeError(io, EXIT_CODES.NOT_FOUND, `unknown operation-key "${key}"`, {
      hint: `run "${spec.bin} find …" to search the catalog`,
    });
    return EXIT_CODES.NOT_FOUND;
  }
  writeJson(io, 'params' in match ? fromCommand(spec, match) : fromEntry(spec, match));
  return EXIT_CODES.OK;
}
