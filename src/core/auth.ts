/**
 * Auth for the generated CLI: env + per-scheme flags. First fully satisfied
 * anyOf group wins; several satisfied → smallest group; ties keep anyOf
 * order. The kernel NEVER prompts; values are never printed.
 */
import { specAuthFlagNames, schemeFlagNames } from './auth-flags.js';
import { authGroups, groupSchemes, smallestGroup } from './auth-groups.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CliAuthSchemeSpec, CliCommandSpec, CliIo, CliSpec } from './model.js';
import { writeJson } from './output.js';

export interface OauthExchange {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes?: readonly string[];
}

export interface AuthMaterial {
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly oauthExchange?: OauthExchange;
}

export type AuthResolution =
  | { readonly ok: true; readonly material: AuthMaterial }
  | { readonly ok: false; readonly missing: readonly string[] };

export type AuthFlags = Readonly<Record<string, readonly string[]>>;

const EMPTY: AuthMaterial = { headers: {}, query: {} };

function envValue(env: CliIo['env'], name: string): string | null {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
}

function flagValue(flags: AuthFlags | undefined, name: string | undefined): string | null {
  if (name === undefined || flags === undefined) return null;
  const values = flags[name];
  const last = values?.[values.length - 1];
  return last === undefined || last === '' ? null : last;
}

function secretOf(flag: string | undefined, envName: string, env: CliIo['env'], flags: AuthFlags | undefined): string | null {
  return flagValue(flags, flag) ?? envValue(env, envName);
}

function missingOf(flag: string | undefined, envName: string): string {
  return flag === undefined ? envName : `${envName} or --${flag}`;
}

function resolveApiKey(
  scheme: CliAuthSchemeSpec & { type: 'apiKey' },
  env: CliIo['env'],
  flags: AuthFlags | undefined,
): AuthResolution {
  const value = secretOf(scheme.flag, scheme.env, env, flags);
  if (value === null) return { ok: false, missing: [missingOf(scheme.flag, scheme.env)] };
  const credential = scheme.valuePrefix === null ? value : `${scheme.valuePrefix} ${value}`;
  return scheme.in === 'header'
    ? { ok: true, material: { headers: { [scheme.wireName]: credential }, query: {} } }
    : { ok: true, material: { headers: {}, query: { [scheme.wireName]: credential } } };
}

function resolveBearer(
  scheme: { readonly env: string; readonly flag?: string },
  env: CliIo['env'],
  flags: AuthFlags | undefined,
): AuthResolution {
  const value = secretOf(scheme.flag, scheme.env, env, flags);
  if (value === null) return { ok: false, missing: [missingOf(scheme.flag, scheme.env)] };
  return { ok: true, material: { headers: { authorization: `Bearer ${value}` }, query: {} } };
}

function resolveBasic(
  scheme: CliAuthSchemeSpec & { type: 'basic' },
  env: CliIo['env'],
  flags: AuthFlags | undefined,
): AuthResolution {
  const username = secretOf(scheme.flagUsername, scheme.envUsername, env, flags);
  const password = secretOf(scheme.flagPassword, scheme.envPassword, env, flags);
  const missing = [
    ...(username === null ? [missingOf(scheme.flagUsername, scheme.envUsername)] : []),
    ...(password === null ? [missingOf(scheme.flagPassword, scheme.envPassword)] : []),
  ];
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, material: { headers: { authorization: `Basic ${btoa(`${username}:${password}`)}` }, query: {} } };
}

function resolveOauth2(
  scheme: CliAuthSchemeSpec & { type: 'oauth2' },
  env: CliIo['env'],
  flags: AuthFlags | undefined,
): AuthResolution {
  const token = secretOf(scheme.flag, scheme.env, env, flags);
  if (token !== null) return resolveBearer(scheme, env, flags);
  const clientIdEnv = scheme.envClientId;
  const clientSecretEnv = scheme.envClientSecret;
  if (clientIdEnv === undefined || clientSecretEnv === undefined) return resolveBearer(scheme, env, flags);
  const clientId = envValue(env, clientIdEnv);
  const clientSecret = envValue(env, clientSecretEnv);
  if (clientId === null || clientSecret === null) {
    return {
      ok: false,
      missing: [missingOf(scheme.flag, scheme.env), clientIdEnv, clientSecretEnv],
    };
  }
  return {
    ok: true,
    material: {
      headers: {},
      query: {},
      oauthExchange: {
        tokenUrl: scheme.tokenUrl,
        clientId,
        clientSecret,
        ...(scheme.scopes === undefined || scheme.scopes.length === 0 ? {} : { scopes: scheme.scopes }),
      },
    },
  };
}

export function resolveScheme(scheme: CliAuthSchemeSpec, env: CliIo['env'], flags: AuthFlags | undefined): AuthResolution {
  switch (scheme.type) {
    case 'apiKey':
      return resolveApiKey(scheme, env, flags);
    case 'bearer':
      return resolveBearer(scheme, env, flags);
    case 'oauth2':
      return resolveOauth2(scheme, env, flags);
    case 'basic':
      return resolveBasic(scheme, env, flags);
  }
}

function mergeGroup(schemes: readonly CliAuthSchemeSpec[], env: CliIo['env'], flags: AuthFlags | undefined): AuthResolution {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const missing: string[] = [];
  let oauthExchange: AuthMaterial['oauthExchange'];
  for (const scheme of schemes) {
    const resolved = resolveScheme(scheme, env, flags);
    if (!resolved.ok) {
      missing.push(...resolved.missing);
      continue;
    }
    Object.assign(headers, resolved.material.headers);
    Object.assign(query, resolved.material.query);
    if (resolved.material.oauthExchange !== undefined) oauthExchange = resolved.material.oauthExchange;
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, material: { headers, query, ...(oauthExchange === undefined ? {} : { oauthExchange }) } };
}

export function resolveAuth(
  spec: CliSpec,
  env: CliIo['env'],
  flags?: AuthFlags,
  command?: CliCommandSpec,
): AuthResolution {
  if (command?.authUncallable === true) {
    return { ok: false, missing: ['operation security is declared but not modeled'] };
  }
  const groups = authGroups(spec, command);
  if (groups.length === 0) return { ok: true, material: EMPTY };
  const satisfied: (readonly string[])[] = [];
  const missing: string[] = [];
  for (const group of groups) {
    const resolved = mergeGroup(groupSchemes(spec, group), env, flags);
    if (resolved.ok) satisfied.push(group);
    else missing.push(...resolved.missing);
  }
  const chosen = smallestGroup(satisfied);
  if (chosen === undefined) return { ok: false, missing: [...new Set(missing)] };
  return mergeGroup(groupSchemes(spec, chosen), env, flags);
}

export function preferredAuthSchemes(spec: CliSpec, command?: CliCommandSpec): readonly CliAuthSchemeSpec[] {
  const groups = authGroups(spec, command);
  const chosen = smallestGroup(groups);
  return chosen === undefined ? spec.auth : groupSchemes(spec, chosen);
}

export { schemeFlagNames, specAuthFlagNames };

export function schemeEnvNames(scheme: CliAuthSchemeSpec): readonly string[] {
  if (scheme.type === 'basic') return [scheme.envUsername, scheme.envPassword];
  if (scheme.type !== 'oauth2') return [scheme.env];
  return [
    scheme.env,
    ...(scheme.envClientId === undefined ? [] : [scheme.envClientId]),
    ...(scheme.envClientSecret === undefined ? [] : [scheme.envClientSecret]),
  ];
}

export function authEnvNames(spec: CliSpec): readonly string[] {
  return spec.auth.flatMap(schemeEnvNames);
}

interface AuthStatusRow {
  readonly env: string;
  /** Absent when the variable has no flag — OAuth2 client credentials are env-only. */
  readonly flag?: string;
  readonly set: boolean;
  readonly scheme: string;
}

function statusRows(scheme: CliAuthSchemeSpec, io: CliIo, flags: AuthFlags | undefined): readonly AuthStatusRow[] {
  const envs = schemeEnvNames(scheme);
  const flagNames = schemeFlagNames(scheme);
  return envs.map((env, index) => {
    // No borrowing. The former `?? flagNames[0]` fallback labelled the OAuth2
    // client id/secret rows with the token flag and then read that same flag for
    // `set`, so `--<token-flag> x` reported client credentials as satisfied when
    // only the token had been supplied, and two rows claimed one flag name.
    const flag = flagNames[index];
    const envSet = io.env[env] !== undefined && io.env[env] !== '';
    const flagSet = flag !== undefined && flagValue(flags, flag) !== null;
    return { env, ...(flag === undefined ? {} : { flag }), set: envSet || flagSet, scheme: scheme.type };
  });
}

export function authStatus(spec: CliSpec, io: CliIo, flags?: AuthFlags, command?: CliCommandSpec): number {
  const rows = spec.auth.flatMap((scheme) => statusRows(scheme, io, flags));
  const satisfied = resolveAuth(spec, io.env, flags, command).ok;
  writeJson(io, {
    authDeclared: spec.authDeclared,
    authProposed: spec.authProposed ?? false,
    refused: spec.authRefused ?? [],
    unused: spec.authUnused ?? [],
    groups: (spec.authAnyOf ?? []).map((group) => group.join(' + ')),
    satisfied,
    variables: rows,
  });
  return satisfied ? EXIT_CODES.OK : EXIT_CODES.AUTH;
}

export function authEnvTemplate(spec: CliSpec, io: CliIo): number {
  if (spec.auth.length === 0) {
    writeJson(io, { authDeclared: false, exports: [] });
    return EXIT_CODES.OK;
  }
  const lines = authEnvNames(spec).map((name) => `export ${name}=""`);
  writeJson(io, { authDeclared: true, exports: lines });
  return EXIT_CODES.OK;
}
