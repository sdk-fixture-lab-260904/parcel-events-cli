/**
 * SSE + JSONL readers for the CLI kernel (Phase 0 C4b). Copied from the TS
 * kernel parsers; no Stream class — the execute path writes events to stdout
 * or buffers them for `--format json`. `[DONE]` ends SSE. Incomplete trailing
 * SSE events are discarded.
 */

export interface ServerSentEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
  readonly retry?: number;
}

async function* streamLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) yield trimCr(part);
      if (done) {
        if (buffer.length > 0) yield trimCr(buffer);
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function trimCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function splitSseField(line: string): { field: string; value: string } {
  const colon = line.indexOf(':');
  if (colon === -1) return { field: line, value: '' };
  const raw = line.slice(colon + 1);
  return { field: line.slice(0, colon), value: raw.startsWith(' ') ? raw.slice(1) : raw };
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent, void, undefined> {
  let event = '';
  let dataLines: string[] = [];
  let id: string | undefined;
  let retry: number | undefined;
  for await (const line of streamLines(stream)) {
    if (line === '') {
      if (dataLines.length > 0) {
        yield { event: event === '' ? 'message' : event, data: dataLines.join('\n'), id, retry };
      }
      event = '';
      dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue;
    const { field, value } = splitSseField(line);
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value);
  }
}

export async function* parseJsonLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void, undefined> {
  for await (const line of streamLines(stream)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    yield JSON.parse(trimmed) as unknown;
  }
}

export async function* streamEvents(
  response: Response,
  protocol: 'sse' | 'jsonl',
): AsyncGenerator<unknown, void, undefined> {
  const body = response.body;
  if (body === null) throw new Error('Response has no body to stream');
  if (protocol === 'jsonl') {
    yield* parseJsonLines(body);
    return;
  }
  for await (const sse of parseSSE(body)) {
    if (sse.data === '[DONE]') return;
    try {
      yield JSON.parse(sse.data) as unknown;
    } catch {
      yield sse.data;
    }
  }
}
