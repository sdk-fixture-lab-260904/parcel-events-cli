/**
 * Optional TOML config for the generated CLI: profiles and aliases.
 * Missing file is not an error. The kernel never prompts and never reads
 * the real homedir unless `HOME` / `XDG_CONFIG_HOME` is on `io.env`.
 */
import type { CliIo, CliSpec } from './model.js';

export interface CliConfigFile {
  readonly aliases: Readonly<Record<string, string>>;
  readonly profiles: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export const EMPTY_CONFIG: CliConfigFile = { aliases: {}, profiles: {} };

function configEnvName(spec: CliSpec): string {
  return spec.baseUrlEnv.replace(/_BASE_URL$/u, '_CONFIG');
}

function defaultConfigPath(bin: string, env: CliIo['env']): string | null {
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg !== '') return `${xdg.replace(/\/+$/u, '')}/${bin}/config.toml`;
  const home = env['HOME'] ?? env['USERPROFILE'];
  if (home !== undefined && home !== '') return `${home.replace(/\/+$/u, '')}/.config/${bin}/config.toml`;
  return null;
}

function configPath(spec: CliSpec, io: CliIo): string | null {
  const fromEnv = io.env[configEnvName(spec)];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return defaultConfigPath(spec.bin, io.env);
}

async function readText(io: CliIo, path: string): Promise<string | null> {
  if (io.readFile === undefined) return null;
  try {
    const bytes = await io.readFile(path);
    if (bytes.length === 0) return null;
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

function unquote(raw: string): string {
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseAssignment(line: string): readonly [string, string] | null {
  const eq = line.indexOf('=');
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  const value = unquote(line.slice(eq + 1).trim());
  if (key.length === 0) return null;
  return [key, value];
}

/** Minimal TOML: `[profile.name]`, `[alias]`, `key = "value"`. */
export function parseConfigToml(text: string): CliConfigFile {
  const aliases: Record<string, string> = {};
  const profiles: Record<string, Record<string, string>> = {};
  let section: 'alias' | `profile.${string}` | null = null;
  for (const raw of text.split(/\r?\n/u)) {
    const line = stripComment(raw).trim();
    if (line.length === 0) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      if (name === 'alias') section = 'alias';
      else if (name.startsWith('profile.') && name.length > 'profile.'.length) section = name as `profile.${string}`;
      else section = null;
      continue;
    }
    const pair = parseAssignment(line);
    if (pair === null || section === null) continue;
    if (section === 'alias') aliases[pair[0]] = pair[1];
    else {
      const profile = section.slice('profile.'.length);
      profiles[profile] = { ...profiles[profile], [pair[0]]: pair[1] };
    }
  }
  return { aliases, profiles };
}

export async function loadCliConfig(spec: CliSpec, io: CliIo): Promise<CliConfigFile> {
  const path = configPath(spec, io);
  if (path === null) return EMPTY_CONFIG;
  const text = await readText(io, path);
  return text === null ? EMPTY_CONFIG : parseConfigToml(text);
}

/** Expand the first non-flag word when it is an alias. One hop only. */
export function expandArgvAliases(
  argv: readonly string[],
  aliases: Readonly<Record<string, string>>,
): readonly string[] {
  const out: string[] = [];
  let expanded = false;
  for (const word of argv) {
    const hit = !expanded && !word.startsWith('-') ? aliases[word] : undefined;
    if (hit !== undefined && hit.trim() !== '') {
      out.push(...hit.trim().split(/\s+/u));
      expanded = true;
      continue;
    }
    out.push(word);
  }
  return out;
}

export type ProfileApply =
  | { readonly ok: true; readonly io: CliIo }
  | { readonly ok: false; readonly message: string };

function overlayFromProfile(
  profile: Readonly<Record<string, string>>,
  baseUrlEnv: string,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const baseUrl = profile['base_url'];
  if (baseUrl !== undefined && baseUrl !== '') out[baseUrlEnv] = baseUrl;
  for (const [key, value] of Object.entries(profile)) {
    if (key === 'base_url' || value === '') continue;
    out[key] = value;
  }
  return out;
}

/** Merge a named profile into env only where the caller has not set a value. */
export function applyProfile(
  io: CliIo,
  config: CliConfigFile,
  name: string | undefined,
  baseUrlEnv: string,
): ProfileApply {
  if (name === undefined || name === '') return { ok: true, io };
  const profile = config.profiles[name];
  if (profile === undefined) return { ok: false, message: `unknown --profile "${name}"` };
  const overlay = overlayFromProfile(profile, baseUrlEnv);
  const env: Record<string, string | undefined> = { ...io.env };
  for (const [key, value] of Object.entries(overlay)) {
    if (env[key] === undefined || env[key] === '') env[key] = value;
  }
  return { ok: true, io: { ...io, env } };
}
