/**
 * Help rendering for the generated CLI (lab B9). Every help surface is also
 * machine-readable: `--help` prints human text; the SAME information is in
 * the root `--schema` document (`{bin, version, commands, globalFlags}`) so
 * agents never scrape prose. Text is wrapped by the caller (dispatch writes
 * the lines verbatim).
 */
import { specAuthFlagNames } from './auth-flags.js';
import { schemeEnvNames } from './auth.js';
import type { CliCatalogEntry, CliCommandSpec, CliSpec } from './model.js';
import { WEBHOOK_LEAVES } from './webhook-dispatch.js';

const WEBHOOK_LEAF_ROWS: readonly CliCatalogEntry[] = [...WEBHOOK_LEAVES].map((leaf) => ({
  id: `webhooks.${leaf}`,
  operationKey: `webhooks.${leaf}`,
  path: ['webhooks', leaf],
  httpMethod: 'POST',
  httpPath: '-',
  flags: ['body', 'secret', 'convention', 'signature', 'webhook-id', 'webhook-timestamp', 'port', 'bind'],
  paginated: false,
  deprecated: false,
  pagination: null,
  stream: null,
  shard: '',
  summary: null,
}));

export function listedCommands(spec: CliSpec): readonly (CliCommandSpec | CliCatalogEntry)[] {
  const base = spec.commands.length > 0 ? spec.commands : (spec.catalog ?? []);
  if (spec.webhookConvention === undefined) return base;
  const taken = new Set(base.filter((row) => row.path[0] === 'webhooks').map((row) => row.path[1] ?? ''));
  return [...base, ...WEBHOOK_LEAF_ROWS.filter((row) => !taken.has(row.path[1] ?? ''))];
}

/** The global flags every command accepts (help + completion + --schema). */
export const GLOBAL_FLAG_ROWS: readonly { readonly flag: string; readonly note: string }[] = [
  { flag: '--format <json|jsonl|pretty|table|toon|yaml>', note: 'output format (TTY default: table; else json)' },
  { flag: '--fields <a,b,c>', note: 'project these keys before format' },
  { flag: '--json / --jsonl / --raw', note: 'force JSON on stdout (--raw is an alias of --json)' },
  { flag: '--example <request|response>', note: 'print the command example and exit' },
  { flag: '--transform <dot.path>', note: 'extract a field from a successful payload' },
  { flag: '--max-items <n>', note: 'drain this many items (paginated / streaming)' },
  { flag: '--max-retries <n>', note: 'override the retry budget (0 = no retry)' },
  { flag: '--dry-run', note: 'print the exact request plan; send nothing' },
  { flag: '--mock', note: 'print a schema-shaped example; send nothing' },
  { flag: '--schema', note: 'print the JSON schema of this command\'s input' },
  { flag: '--full', note: 'with --schema, print the fat catalog (pagination objects)' },
  { flag: '--provenance', note: 'print the embedded .doctorine-sdk.json record' },
  { flag: '--fail-on-deprecated', note: 'refuse deprecated commands (exit 1)' },
  { flag: '--base-url <url>', note: 'override the API base URL' },
  { flag: '--profile <name>', note: 'load ~/.config/{bin}/config.toml profile (or {PREFIX}_CONFIG)' },
  { flag: '--timeout-ms <ms>', note: 'request timeout (exit 124 on breach)' },
  { flag: '--help', note: 'this help' },
  { flag: '--version', note: 'print the version and exit' },
];

function authFlagRow(spec: CliSpec): { readonly flag: string; readonly note: string } | null {
  const flags = specAuthFlagNames(spec);
  if (flags.length === 0) return null;
  return { flag: flags.map((flag) => `--${flag}`).join(' / '), note: 'credentials (override env)' };
}

export function globalFlagRows(spec: CliSpec): readonly { readonly flag: string; readonly note: string }[] {
  const auth = authFlagRow(spec);
  if (auth === null) return GLOBAL_FLAG_ROWS;
  const insertAt = GLOBAL_FLAG_ROWS.findIndex((row) => row.flag.startsWith('--base-url'));
  if (insertAt < 0) return [...GLOBAL_FLAG_ROWS, auth];
  return [...GLOBAL_FLAG_ROWS.slice(0, insertAt), auth, ...GLOBAL_FLAG_ROWS.slice(insertAt)];
}

function usage(spec: CliSpec, command?: CliCommandSpec): string {
  const words = command === undefined ? '<command> [flags]' : `${command.path.join(' ')} [flags]`;
  return `usage: ${spec.bin} ${words}`;
}

/** Root help: the built-ins + every top-level group. */
export function rootHelp(spec: CliSpec): readonly string[] {
  const groups = new Map<string, number>();
  for (const command of listedCommands(spec)) {
    const first = command.path[0] as string;
    groups.set(first, (groups.get(first) ?? 0) + 1);
  }
  const lines = [
    `${spec.bin} ${spec.version} — ${spec.title}`,
    '',
    usage(spec),
    '',
    'built-ins:',
    '  auth status           credential report (JSON; exit 4 when unsatisfied)',
    '  auth env              export template for the credential env vars',
    '  completion <bash|zsh|fish> print the shell completion script',
    '  find <query>          search the catalog (JSONL; no network)',
    '  help [command...]     this help (also: <command> --help)',
    '  provenance            print the embedded provenance JSON',
    '  resolve <operation-key> bind x-operation-key to argv (JSON)',
    '  version               print the version and exit',
    '',
    'command groups:',
    ...[...groups.entries()].toSorted().map(([name, count]) => `  ${name.padEnd(24)} ${count} command(s)`),
    '',
    'global flags:',
    ...globalFlagRows(spec).map((row) => `  ${row.flag.padEnd(32)} ${row.note}`),
    '',
    `exit codes: 0 ok · 1 findings · 2 usage · 3 config · 4 auth · 5 forbidden · 6 not-found`,
    `            7 conflict · 8 rate-limited · 9 server · 10 version-skew · 124 timeout · 130 interrupted`,
  ];
  return lines;
}

const GROUP_HELP_INDEX = 120;

function groupMemberLine(command: CliCommandSpec | CliCatalogEntry): string {
  const summary = 'summary' in command ? command.summary : null;
  return (
    `  ${command.path.slice(1).join(' ').padEnd(24)} ${command.httpMethod.padEnd(7)} ${command.httpPath}` +
    (summary === null ? '' : `  — ${summary}`) +
    (command.deprecated ? '  [DEPRECATED]' : '')
  );
}

function groupSubIndex(members: readonly (CliCommandSpec | CliCatalogEntry)[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const command of members) {
    const key = command.path[1] ?? '(root)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, count]) => `  ${name.padEnd(24)} ${count} command(s)`);
}

/** Group help: the commands under one top-level word. */
export function groupHelp(spec: CliSpec, group: string): readonly string[] | null {
  const members = listedCommands(spec).filter((command) => command.path[0] === group);
  if (members.length === 0) return null;
  const listing =
    members.length > GROUP_HELP_INDEX
      ? [
          `this group has ${members.length} commands — listing a sub-index. Use "${spec.bin} ${group} --schema" for the machine catalog.`,
          '',
          ...groupSubIndex(members),
        ]
      : members.map(groupMemberLine);
  return [
    `${spec.bin} ${group} — ${members.length} command(s)`,
    '',
    ...listing,
    '',
    `run "${spec.bin} ${group} <command> --help" for flags, or "${spec.bin} ${group} --schema" for the group catalog.`,
  ];
}

/** Command help: params, body, and the machine-readable pointers. */
export function commandHelp(spec: CliSpec, command: CliCommandSpec): readonly string[] {
  const lines = [
    `${spec.bin} ${command.path.join(' ')} — ${command.httpMethod} ${command.httpPath}`,
    ...(command.summary === null ? [] : ['', command.summary]),
    ...(command.deprecated ? ['', 'DEPRECATED'] : []),
    '',
    `operationKey: ${command.operationKey}`,
    '',
    usage(spec, command),
  ];
  if (command.params.length > 0) {
    lines.push('', 'flags:');
    for (const param of command.params) {
      lines.push(paramHelpLine(param));
    }
  }
  if (command.body !== null) {
    lines.push(
      '',
      `  --body <json|->             request body (${command.body.contentType})${command.body.required ? ' (required)' : ''}; "-" reads stdin`,
    );
  }
  if (command.paginated) {
    lines.push('', 'note: this command paginates; --schema names x-drain and cursor flags; --max-items drains.');
  }
  if (command.streaming) lines.push('', 'note: this command streams its response; use --jsonl for line output.');
  if (command.example !== undefined) {
    lines.push('', 'example:');
    if (command.example.request !== null) lines.push(command.example.request);
    if (command.example.response !== null) lines.push(command.example.response);
  }
  lines.push('', 'global flags:', ...globalFlagRows(spec).map((row) => `  ${row.flag.padEnd(32)} ${row.note}`));
  return lines;
}

function paramHelpLine(param: CliCommandSpec['params'][number]): string {
  const req = param.required ? ' (required)' : '';
  const aliases = param.aliases ?? [];
  const aliasNote = aliases.length === 0 ? '' : `; alias ${aliases.map((alias) => `--${alias}`).join(', ')}`;
  const flagNote = aliases.length === 0 ? '' : ` (flag: --${param.flag}${aliasNote})`;
  return `  --${param.flag} <${param.type}>`.padEnd(34) + `${param.in} parameter "${param.wireName}"${flagNote}${req}`;
}

function indexRow(command: CliCommandSpec | CliCatalogEntry): Record<string, unknown> {
  return {
    operationKey: command.operationKey,
    path: command.path,
    httpMethod: command.httpMethod,
    httpPath: command.httpPath,
    paginated: command.paginated,
    deprecated: command.deprecated,
  };
}

function commandRow(command: CliCommandSpec | CliCatalogEntry): Record<string, unknown> {
  return {
    id: command.id,
    ...indexRow(command),
    pagination: command.pagination,
    streaming: 'streaming' in command ? command.streaming : command.stream !== null,
    stream: command.stream,
  };
}

function schemaEnvelope(
  spec: CliSpec,
  full: boolean,
  commands: readonly (CliCommandSpec | CliCatalogEntry)[],
): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${spec.bin} command surface`,
    type: 'object',
    'x-bin': spec.bin,
    'x-version': spec.version,
    'x-schema-mode': full ? 'full' : 'index',
    'x-base-url-env': spec.baseUrlEnv,
    'x-auth-env': spec.auth.flatMap(schemeEnvNames),
    'x-auth-any-of': spec.authAnyOf ?? null,
    'x-auth-declared': spec.authDeclared,
    'x-auth-proposed': spec.authProposed ?? false,
    'x-auth-refused': spec.authRefused ?? [],
    'x-auth-unused': spec.authUnused ?? [],
    'x-global-flags': globalFlagRows(spec).map((row) => row.flag),
    'x-retries': spec.retries,
    'x-idempotency-header': spec.idempotencyHeader,
    'x-commands': commands.map(full ? commandRow : indexRow),
  };
}

/** Group `--schema`: index by default; `--full` restores pagination objects. */
export function groupSchemaDocument(spec: CliSpec, group: string, full = false): Record<string, unknown> {
  const members = listedCommands(spec).filter((command) => command.path[0] === group);
  return {
    ...schemaEnvelope(spec, full, members),
    title: `${spec.bin} ${group} command surface`,
    'x-group': group,
  };
}

/** Root `--schema`: thin index by default; `--full` is the fat catalog. */
export function rootSchemaDocument(spec: CliSpec, full = false): Record<string, unknown> {
  return schemaEnvelope(spec, full, listedCommands(spec));
}
