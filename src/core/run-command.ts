/**
 * The operation path of the generated CLI (lab B9): one resolved command ×
 * parsed flags → help/schema → execute. Split from `dispatch.ts` for the
 * ≤400-line file cap. Binding, dry-run, retries, paging, and streaming live
 * in `execute.ts` / `execute-live.ts`.
 */
import { flagPresent, flagValue, type ParsedArgv } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import { executeCommand } from './execute.js';
import { commandHelp } from './help.js';
import type { CliCommandSpec, CliIo, CliSpec } from './model.js';
import { CLI_OUTPUT_FORMATS, resolveFormat, writeError, writeJson, writeWarning } from './output.js';
import { wantHuman } from './tty.js';

function paramSupplied(parsed: ParsedArgv, param: CliCommandSpec['params'][number]): boolean {
  if (parsed.flags[param.flag] !== undefined) return true;
  return (param.aliases ?? []).some((alias) => parsed.flags[alias] !== undefined);
}

function withAliases(command: CliCommandSpec, parsed: ParsedArgv): ParsedArgv {
  const flags: Record<string, readonly string[]> = { ...parsed.flags };
  for (const param of command.params) {
    if (flags[param.flag] !== undefined) continue;
    for (const alias of param.aliases ?? []) {
      if (flags[alias] !== undefined) {
        flags[param.flag] = flags[alias] as readonly string[];
        break;
      }
    }
  }
  return { ...parsed, flags };
}

function printExample(command: CliCommandSpec, side: string | undefined, io: CliIo): number {
  if (side !== 'request' && side !== 'response') {
    writeError(io, EXIT_CODES.USAGE, 'example expects request or response');
    return EXIT_CODES.USAGE;
  }
  const text = command.example?.[side] ?? null;
  if (text === null) {
    writeError(io, EXIT_CODES.USAGE, `no ${side} example for "${command.path.join(' ')}"`);
    return EXIT_CODES.USAGE;
  }
  io.stdout(text.endsWith('\n') ? text : `${text}\n`);
  return EXIT_CODES.OK;
}

/** Required-but-absent flags, as `--flag` spellings (USAGE reporting). */
function missingRequired(command: CliCommandSpec, parsed: ParsedArgv): readonly string[] {
  const hasBody = parsed.flags['body'] !== undefined;
  const leaves = command.params.filter((param) => param.bodyPath !== undefined);
  const hasLeaf = leaves.some((param) => paramSupplied(parsed, param));
  const missing = command.params
    .filter((param) => param.required && param.bodyPath === undefined && !paramSupplied(parsed, param))
    .map((param) => `--${param.flag}`);
  const hasFile = command.params.some((param) => param.type === 'file' && paramSupplied(parsed, param));
  if (hasLeaf) {
    for (const leaf of leaves) {
      if (leaf.required && !paramSupplied(parsed, leaf)) missing.push(`--${leaf.flag}`);
    }
  } else if (command.body?.required === true && !hasBody && !hasFile) {
    const requiredLeaves = leaves.filter((param) => param.required);
    if (requiredLeaves.length > 0) missing.push(...requiredLeaves.map((param) => `--${param.flag}`));
    else missing.push('--body');
  }
  return missing;
}

/** Run one resolved operation command (see the module header). */
export async function runCommand(spec: CliSpec, command: CliCommandSpec, parsed: ParsedArgv, io: CliIo): Promise<number> {
  if (command.deprecated) {
    writeWarning(io, `deprecated command "${command.path.join(' ')}"`, {
      command: command.id,
      deprecated: true,
    });
  }
  if (flagPresent(parsed.flags, 'help')) {
    io.stdout(`${commandHelp(spec, command).join('\n')}\n`);
    return EXIT_CODES.OK;
  }
  if (flagPresent(parsed.flags, 'schema')) {
    writeJson(io, command.inputSchema);
    return EXIT_CODES.OK;
  }
  if (flagPresent(parsed.flags, 'example')) {
    return printExample(command, flagValue(parsed.flags, 'example'), io);
  }
  if (command.deprecated && flagPresent(parsed.flags, 'fail-on-deprecated')) {
    writeError(io, EXIT_CODES.FINDINGS, `deprecated command "${command.path.join(' ')}" refused (--fail-on-deprecated)`, {
      command: command.id,
      deprecated: true,
    });
    return EXIT_CODES.FINDINGS;
  }
  const format = resolveFormat(
    flagValue(parsed.flags, 'format'),
    flagPresent(parsed.flags, 'json'),
    flagPresent(parsed.flags, 'jsonl'),
    { human: wantHuman(io), raw: flagPresent(parsed.flags, 'raw') },
  );
  if (format === null) {
    writeError(io, EXIT_CODES.USAGE, `invalid --format (${CLI_OUTPUT_FORMATS.join(' | ')})`);
    return EXIT_CODES.USAGE;
  }
  const bound = withAliases(command, parsed);
  const missing = missingRequired(command, bound);
  if (missing.length > 0) {
    writeError(io, EXIT_CODES.USAGE, `missing required flag(s): ${missing.join(', ')}`, { command: command.id });
    return EXIT_CODES.USAGE;
  }
  return executeCommand({ spec, command, parsed: bound, io, format });
}
