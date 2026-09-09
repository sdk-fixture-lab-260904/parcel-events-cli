/**
 * Auth flag names derived from the scheme table. Dispatch registers these
 * as global value flags; help and completion list the same set.
 */
import type { CliAuthSchemeSpec, CliSpec } from './model.js';

export function schemeFlagNames(scheme: CliAuthSchemeSpec): readonly string[] {
  if (scheme.type === 'basic') return [scheme.flagUsername ?? 'username', scheme.flagPassword ?? 'password'];
  return [scheme.flag ?? (scheme.type === 'apiKey' ? 'api-key' : 'token')];
}

export function specAuthFlagNames(spec: CliSpec): readonly string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const scheme of spec.auth) {
    for (const flag of schemeFlagNames(scheme)) {
      if (seen.has(flag)) continue;
      seen.add(flag);
      names.push(flag);
    }
  }
  return names;
}
