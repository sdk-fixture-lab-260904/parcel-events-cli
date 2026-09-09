/** Validate assembled input before OAuth exchange or API transport. */
import type { CliCommandSpec } from './model.js';
import { assertValid, SDKValidationError, type Schema } from './validation.js';
import type { AssembledBody } from './uploads.js';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodyValue(assembled: AssembledBody, original: unknown): unknown {
  const body = assembled.body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (!(body instanceof FormData)) return original;
  const values: Record<string, unknown> = object(original) ? { ...original } : {};
  // Keep original scalar types (FormData has stringified them), adding the
  // actual file objects loaded from file flags for binary schema validation.
  body.forEach((value, key) => { if (typeof value !== 'string') values[key] = value; });
  return values;
}

export function validateRequest(command: CliCommandSpec, values: Readonly<Record<string, unknown>>,
  originalBody: unknown, assembled: AssembledBody): string | null {
  const schema = command.validationSchema;
  if (!object(schema)) return null;
  const input: Record<string, unknown> = {};
  for (const param of command.params) {
    if (param.in !== 'body' && values[param.flag] !== undefined) input[param.flag] = values[param.flag];
  }
  const body = bodyValue(assembled, originalBody);
  if (body !== undefined) input['body'] = body;
  const definitions: Schema = object(schema['$defs']) ? schema['$defs'] : {};
  try { assertValid({ schema, definitions }, input, 'request'); return null; }
  catch (error) {
    if (error instanceof SDKValidationError) return error.message;
    throw error;
  }
}
