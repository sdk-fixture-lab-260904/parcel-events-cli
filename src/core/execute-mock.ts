/**
 * `--mock` output for the generated CLI (Phase 1 L1): after bind, print
 * the emit-time `mockResponse` through `--transform` / `--format` / pager
 * slicing. Never calls fetch. Streaming mocks cap at 1–2 events.
 */
import { flagValue } from './argv.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CliCommandSpec, ExecuteCtx } from './model.js';
import { parseFieldList, projectFields, writeData, writeError } from './output.js';
import { takeItems } from './pagination.js';
import { itemsAt } from './pagination-locators.js';
import { applyTransform } from './transform.js';

function replaceAtPointer(body: unknown, pointer: readonly string[], value: unknown): unknown {
  if (pointer.length === 0) return value;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const [head, ...rest] = pointer;
  if (head === undefined) return body;
  const record = body as Record<string, unknown>;
  return { ...record, [head]: replaceAtPointer(record[head], rest, value) };
}

function slicePage(command: CliCommandSpec, data: unknown, maxItems: number): unknown {
  if (Array.isArray(data)) return takeItems(data, maxItems);
  if (command.pagination === null || data === null || typeof data !== 'object') return data;
  const pointer = command.pagination.response.find((entry) => entry.role === 'items')?.pointer ?? [];
  const items = itemsAt(data, pointer);
  return items.length === 0 ? data : replaceAtPointer(data, pointer, takeItems(items, maxItems));
}

function sliceMock(command: CliCommandSpec, maxItems: number | null): unknown {
  const data = command.mockResponse;
  if (command.streaming) {
    const events = Array.isArray(data) ? data : [data];
    return events.slice(0, Math.min(2, maxItems ?? 2));
  }
  return maxItems === null ? data : slicePage(command, data, maxItems);
}

/** Write the mocked payload honoring `--transform` and `--format`. */
export function writeMockResponse(ctx: ExecuteCtx, maxItems: number | null): number {
  const transform = flagValue(ctx.parsed.flags, 'transform');
  let payload = sliceMock(ctx.command, maxItems);
  if (transform !== undefined) {
    const extracted = applyTransform(payload, transform);
    if (!extracted.ok) {
      writeError(ctx.io, EXIT_CODES.USAGE, extracted.message);
      return EXIT_CODES.USAGE;
    }
    payload = extracted.value;
  }
  writeData(ctx.io, projectFields(payload, parseFieldList(flagValue(ctx.parsed.flags, 'fields'))), ctx.format);
  return EXIT_CODES.OK;
}
