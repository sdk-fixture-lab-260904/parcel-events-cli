/**
 * OR-of-AND auth groups for the generated CLI. When `authAnyOf` is absent
 * the scheme table is one AND group (legacy fixtures). A command may
 * override with its own groups. Empty groups mean the operation is public.
 */
import type { CliAuthSchemeSpec, CliCommandSpec, CliSpec } from './model.js';

export function authGroups(spec: CliSpec, command?: CliCommandSpec): readonly (readonly string[])[] {
  const override = command?.authAnyOf;
  if (override !== undefined) return override;
  if (spec.authAnyOf !== undefined) return spec.authAnyOf;
  const names = spec.auth.map((scheme, index) => scheme.name ?? `__scheme_${index}`);
  return names.length === 0 ? [] : [names];
}

export function schemeByName(spec: CliSpec, name: string): CliAuthSchemeSpec | undefined {
  const byName = spec.auth.find((scheme) => scheme.name === name);
  if (byName !== undefined) return byName;
  const synthetic = name.match(/^__scheme_(\d+)$/);
  if (synthetic === null) return undefined;
  return spec.auth[Number(synthetic[1])];
}

export function groupSchemes(spec: CliSpec, group: readonly string[]): readonly CliAuthSchemeSpec[] {
  return group.flatMap((name) => {
    const scheme = schemeByName(spec, name);
    return scheme === undefined ? [] : [scheme];
  });
}

/** Among groups, prefer the fewest schemes; ties keep input order. */
export function smallestGroup(groups: readonly (readonly string[])[]): readonly string[] | undefined {
  let best: readonly string[] | undefined;
  for (const group of groups) {
    if (best === undefined || group.length < best.length) best = group;
  }
  return best;
}

export function namedAuthSchemes(spec: CliSpec): readonly { name: string; scheme: CliAuthSchemeSpec }[] {
  return spec.auth.map((scheme, index) => ({ name: scheme.name ?? `__scheme_${index}`, scheme }));
}
