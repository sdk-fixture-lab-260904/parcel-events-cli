/**
 * Filesystem uploads for the CLI kernel (Phase 0 C3). `@path` or a bare
 * path on a `type: 'file'` flag becomes bytes — never a JSON string of the
 * path (Scalar's generated `--image` bug). Multipart uses FormData so fetch
 * stamps the boundary; octet-stream sends the raw bytes.
 */
import type { CliCommandSpec, CliIo } from './model.js';

export function stripAt(raw: string): string {
  return raw.startsWith('@') ? raw.slice(1) : raw;
}

export function isMultipart(contentType: string): boolean {
  return contentType.startsWith('multipart/');
}

export function isOctetStream(contentType: string): boolean {
  return contentType === 'application/octet-stream';
}

export type FileRead =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly path: string }
  | { readonly ok: false; readonly message: string };

export async function readUpload(io: CliIo, raw: string): Promise<FileRead> {
  const path = stripAt(raw);
  if (path === '' || path === '-') return { ok: false, message: `invalid file path "${raw}"` };
  if (io.readFile === undefined) return { ok: false, message: `cannot read file "${path}" (no filesystem)` };
  try {
    const bytes = await io.readFile(path);
    return { ok: true, bytes, path };
  } catch {
    return { ok: false, message: `cannot read file "${path}"` };
  }
}

export interface AssembledBody {
  readonly body: NonNullable<RequestInit['body']> | undefined;
  readonly contentType: string | null;
}

export type AssembleResult =
  | { readonly ok: true; readonly assembled: AssembledBody }
  | { readonly ok: false; readonly message: string };

function fileName(path: string): string {
  const parts = path.split(/[/\\]/u);
  return parts[parts.length - 1] || 'upload';
}

/** Build the wire body from `--body` plus `type: 'file'` params. */
export async function assembleBody(
  command: CliCommandSpec,
  values: Readonly<Record<string, unknown>>,
  jsonBody: unknown,
  io: CliIo,
): Promise<AssembleResult> {
  const files = command.params.filter((param) => param.type === 'file' && param.in === 'body');
  const contentType = command.body?.contentType ?? 'application/json';
  if (files.length === 0) {
    if (jsonBody === undefined) return { ok: true, assembled: { body: undefined, contentType: null } };
    if (typeof jsonBody === 'string' && jsonBody.startsWith('@') && !contentType.includes('json')) {
      const file = await readUpload(io, jsonBody);
      if (!file.ok) return file;
      return { ok: true, assembled: { body: toArrayBuffer(file.bytes), contentType } };
    }
    if (typeof jsonBody === 'string') {
      return { ok: true, assembled: { body: jsonBody, contentType } };
    }
    return { ok: true, assembled: { body: JSON.stringify(jsonBody), contentType } };
  }
  return assembleWithFiles({ command, files, values, jsonBody, io, contentType });
}

async function assembleWithFiles(input: {
  readonly command: CliCommandSpec;
  readonly files: readonly { readonly flag: string; readonly wireName: string }[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly jsonBody: unknown;
  readonly io: CliIo;
  readonly contentType: string;
}): Promise<AssembleResult> {
  const { command, files, values, jsonBody, io, contentType } = input;
  if (isMultipart(contentType) || files.length > 1) {
    return assembleMultipart(files, values, jsonBody, io);
  }
  const first = files[0];
  if (first === undefined) return { ok: true, assembled: { body: undefined, contentType: null } };
  const raw = values[first.flag];
  if (typeof raw !== 'string') {
    return { ok: false, message: `missing file for --${first.flag}` };
  }
  const file = await readUpload(io, raw);
  if (!file.ok) return file;
  return { ok: true, assembled: { body: toArrayBuffer(file.bytes), contentType: command.body?.contentType ?? contentType } };
}

async function assembleMultipart(
  files: readonly { readonly flag: string; readonly wireName: string }[],
  values: Readonly<Record<string, unknown>>,
  jsonBody: unknown,
  io: CliIo,
): Promise<AssembleResult> {
  const form = new FormData();
  if (jsonBody !== undefined && typeof jsonBody === 'object' && jsonBody !== null && !Array.isArray(jsonBody)) {
    for (const [key, value] of Object.entries(jsonBody as Record<string, unknown>)) {
      if (value !== undefined) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  for (const fileParam of files) {
    const raw = values[fileParam.flag];
    if (typeof raw !== 'string') continue;
    const file = await readUpload(io, raw);
    if (!file.ok) return file;
    const blob = new Blob([toArrayBuffer(file.bytes)]);
    form.append(fileParam.wireName, blob, fileName(file.path));
  }
  return { ok: true, assembled: { body: form, contentType: null } };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Dry-run view of a body — FormData becomes a redacted part list. */
export function describeBody(body: RequestInit['body'] | null | undefined): unknown {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  if (body instanceof FormData) return describeFormData(body);
  if (body instanceof Uint8Array) return { bytes: body.byteLength };
  if (body instanceof ArrayBuffer) return { bytes: body.byteLength };
  if (typeof Blob !== 'undefined' && body instanceof Blob) return { bytes: body.size };
  return { bytes: 0 };
}

function describeFormData(form: FormData): readonly Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [];
  form.forEach((value, name) => {
    if (typeof value === 'string') {
      parts.push({ name, kind: 'text', bytes: value.length });
      return;
    }
    parts.push({ name, kind: 'file', filename: value.name, bytes: value.size });
  });
  return parts;
}
