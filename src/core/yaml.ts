/**
 * Deterministic YAML writer for `--format yaml`.
 *
 * Codepoint-sorted object keys. No `yaml` npm package (E4).
 */

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function quote(value: string): string {
  if (value === '' || /[:#\n\r\t]|^\s|\s$|^[-?[{|&*!%>@`]|^[0-9]|^(true|false|null)$/iu.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return quote(value);
  return quote(JSON.stringify(value));
}

function writeMapping(value: Record<string, unknown>, depth: number): string[] {
  const keys = Object.keys(value).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (keys.length === 0) return ['{}'];
  const lines: string[] = [];
  for (const key of keys) {
    lines.push(...writeKeyed(key, value[key], depth));
  }
  return lines;
}

function writeKeyed(key: string, value: unknown, depth: number): string[] {
  const prefix = `${indent(depth)}${quote(key)}:`;
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix} []`];
    return [prefix, ...writeSequence(value, depth + 1)];
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${prefix} {}`];
    return [prefix, ...writeMapping(value, depth + 1)];
  }
  return [`${prefix} ${writeScalar(value)}`];
}

function writeSequence(value: unknown[], depth: number): string[] {
  const lines: string[] = [];
  for (const item of value) {
    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${indent(depth)}- []`);
        continue;
      }
      lines.push(`${indent(depth)}-`);
      lines.push(...writeSequence(item, depth + 1));
      continue;
    }
    if (isPlainObject(item)) {
      const nested = writeMapping(item, depth + 1);
      if (nested.length === 1 && !nested[0]!.startsWith(' ')) {
        lines.push(`${indent(depth)}- ${nested[0]}`);
        continue;
      }
      const first = nested[0] ?? '{}';
      lines.push(`${indent(depth)}- ${first.trimStart()}`);
      lines.push(...nested.slice(1));
      continue;
    }
    lines.push(`${indent(depth)}- ${writeScalar(item)}`);
  }
  return lines;
}

export function toYaml(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]\n';
    return `${writeSequence(value, 0).join('\n')}\n`;
  }
  if (isPlainObject(value)) {
    return `${writeMapping(value, 0).join('\n')}\n`;
  }
  return `${writeScalar(value)}\n`;
}
