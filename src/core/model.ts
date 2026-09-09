/**
 * The generated-CLI kernel's data model (lab B9). The emitter renders ONE
 * `CliSpec` literal (`src/commands.ts`); the kernel walks it — no per-endpoint
 * code is generated. Every type is JSON-plain so the spec literal needs no
 * functions. The kernel imports ONLY sibling kernel files.
 */

/** How a flag value is coerced before it is bound onto the request. */
export type CliParamType = 'string' | 'number' | 'integer' | 'boolean' | 'json' | 'file';
import type { ParameterSerialization } from './parameter-serialization.js';

export interface CliParamSpec {
  /** The CLI flag name (`--pet-id`), kebab-cased from the wire name. */
  readonly flag: string;
  /** The wire name bound onto the request (path template / query / header / body). */
  readonly wireName: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie' | 'body';
  readonly serialization?: ParameterSerialization;
  readonly required: boolean;
  readonly type: CliParamType;
  /** JSON body path for a promoted required leaf (`['name']` or `['physicalProperties','mass']`). */
  readonly bodyPath?: readonly string[];
  /** Extra `--flag` spellings (e.g. `--$format` for a reserved `--format-query`). */
  readonly aliases?: readonly string[];
}

export interface CliBodySpec {
  readonly required: boolean;
  readonly contentType: string;
}

/** IR pagination binding, JSON-plain (no type graph). */
export interface CliPaginationBinding {
  readonly scheme: string;
  readonly type: 'cursor' | 'cursor_url' | 'offset' | 'page_number' | 'token' | 'single_page' | 'item_cursor';
  readonly request: readonly {
    readonly role: string;
    readonly location: 'query' | 'header' | 'path' | 'body';
    readonly wireName: string;
  }[];
  readonly response: readonly {
    readonly role: string;
    readonly pointer: readonly string[];
  }[];
  readonly itemCursorField?: string;
}

export interface CliStreamingBinding {
  readonly protocol: 'sse' | 'jsonl';
  readonly paramDiscriminator: string | null;
}

export interface CliRetryPolicy {
  readonly enabled: boolean;
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxElapsedMs: number;
  readonly exponent: number;
  readonly statusCodes: readonly (number | '4XX' | '5XX')[];
  readonly retryConnectionErrors: boolean;
}

export interface CliCommandSpec {
  /** The canonical dotted IR path (`pets.list`) — the stable machine id. */
  readonly id: string;
  /** Tier-1 operation_key (doc 07) — rename-stable; help still uses `path`. */
  readonly operationKey: string;
  /** The command words (`['pets', 'list']`) from the resource hierarchy. */
  readonly path: readonly string[];
  readonly summary: string | null;
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly params: readonly CliParamSpec[];
  readonly body: CliBodySpec | null;
  /** The `--schema` document: JSON Schema 2020-12 of the command's input. */
  readonly inputSchema: unknown;
  /** Contract of the actual parameters and assembled body, before transport. */
  readonly validationSchema?: unknown;
  readonly paginated: boolean;
  readonly pagination: CliPaginationBinding | null;
  readonly streaming: boolean;
  readonly stream: CliStreamingBinding | null;
  readonly deprecated: boolean;
  /** Deterministic emit-time example used by `--mock` (no clock / random). */
  readonly mockResponse: unknown;
  /** Help / `--example` snippets (JSON-plain; absent → no example block). */
  readonly example?: { readonly request: string | null; readonly response: string | null };
  /** True when this command is an inbound webhook payload schema (refuse live send). */
  readonly inbound?: boolean;
  /** Operation-level OR-of-AND groups; absent → inherit `CliSpec.authAnyOf`. */
  readonly authAnyOf?: readonly (readonly string[])[];
  /** Spec security names only refused/unknown schemes — live call is AUTH. */
  readonly authUncallable?: boolean;
}

/** The `.doctorine-sdk.json` sidecar, also embedded on `CliSpec`. */
export interface CliProvenance {
  readonly bundleSha: string;
  readonly cliKernelVersion: string;
  readonly configSha: string;
  readonly generator: string;
  readonly generatorVersion: string;
  readonly irSha: string;
  readonly language: 'cli';
  readonly package: { readonly name: string; readonly version: string };
  readonly sdkSha: string;
}

/** One credential source, lowered from the IR auth plane to the env convention. */
export type CliAuthSchemeSpec =
  | {
      readonly name?: string;
      readonly type: 'apiKey';
      readonly in: 'header' | 'query';
      readonly wireName: string;
      readonly env: string;
      readonly valuePrefix: string | null;
      readonly flag?: string;
    }
  | { readonly name?: string; readonly type: 'bearer'; readonly env: string; readonly flag?: string }
  | {
      readonly name?: string;
      readonly type: 'basic';
      readonly envUsername: string;
      readonly envPassword: string;
      readonly flagUsername?: string;
      readonly flagPassword?: string;
    }
  | {
      readonly name?: string;
      readonly type: 'oauth2';
      readonly env: string;
      readonly tokenUrl: string;
      readonly flag?: string;
      /** Present when the scheme can exchange client credentials (absolute token URL). */
      readonly envClientId?: string;
      readonly envClientSecret?: string;
      readonly scopes?: readonly string[];
    };

export type CliWebhookConvention = 'github-hmac-sha256' | 'standard-webhooks' | 'stripe-v1';

export interface CliSpec {
  /** The binary name (`@acme/petstore-cli` → `petstore-cli`). */
  readonly bin: string;
  readonly version: string;
  readonly title: string;
  /** The default environment URL (`''` when the spec declares none). */
  readonly baseUrl: string;
  /** The env var overriding `baseUrl` (`PETSTORE_CLI_BASE_URL`). */
  readonly baseUrlEnv: string;
  /** The IR default request timeout (`--timeout-ms` overrides). */
  readonly defaultTimeoutMs: number;
  readonly retries: CliRetryPolicy;
  readonly idempotencyHeader: string | null;
  /** Every expressible scheme (not a flattened primary-only list). */
  readonly auth: readonly CliAuthSchemeSpec[];
  /** OR-of-AND groups of scheme names. Absent → AND every entry in `auth`. */
  readonly authAnyOf?: readonly (readonly string[])[];
  /** True when the CIM declares schemes or a `security` field. */
  readonly authDeclared: boolean;
  /** Convention bearer proposed because the spec declared no auth vocabulary. */
  readonly authProposed?: boolean;
  /** Declared CIM schemes that schema v1 cannot model. */
  readonly authRefused?: readonly { readonly name: string; readonly typeLabel: string; readonly reason: string }[];
  /** Modeled schemes that appear in no anyOf group. */
  readonly authUnused?: readonly string[];
  readonly provenance: CliProvenance;
  readonly commands: readonly CliCommandSpec[];
  /** Inbound signing convention when the spec declares webhook events. */
  readonly webhookConvention?: CliWebhookConvention | null;
  /** Thin catalog for lazy shards; `commands` stays the eager table when set. */
  readonly catalog?: readonly CliCatalogEntry[];
}

export interface CliCatalogEntry {
  readonly id: string;
  readonly operationKey: string;
  readonly path: readonly string[];
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly flags: readonly string[];
  readonly paginated: boolean;
  readonly deprecated: boolean;
  readonly pagination: CliPaginationBinding | null;
  readonly stream: CliStreamingBinding | null;
  readonly shard: string;
  /** OpenAPI summary when present — `find` scores it; help may omit. */
  readonly summary?: string | null;
}

/** Shared execute context. Lives here so live/mock paths do not import execute.ts (R9). */
export interface ExecuteCtx {
  readonly spec: CliSpec;
  readonly command: CliCommandSpec;
  readonly parsed: {
    readonly positionals: readonly string[];
    readonly flags: Readonly<Record<string, readonly string[]>>;
  };
  readonly io: CliIo;
  readonly format: CliOutputFormat;
}

/** Every host interaction the kernel needs — injected, never global. */
export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** True when stdout is a TTY. Tests leave this unset so piped goldens stay JSON. */
  readonly isTty?: boolean;
  /** Reads `--body -` from stdin; absent → a `--body -` request is USAGE. */
  readonly stdin?: () => Promise<string>;
  /** Reads a filesystem path for `type: 'file'` / `@path` bodies. */
  readonly readFile?: (path: string) => Promise<Uint8Array>;
  /** Retry backoff; tests inject a no-op. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Wall clock for Retry-After HTTP-date + elapsed; tests inject a fake. */
  readonly now?: () => number;
  /** Lazy-load one fat command spec by id (L6). */
  readonly loadCommand?: (id: string) => Promise<CliCommandSpec>;
  /** Bind a loopback HTTP listener (L3). Never used for outbound SSRF. */
  readonly serve?: (opts: CliServeOpts) => Promise<CliServeHandle>;
  /** SIGINT / interrupt hook for listen (maps to exit 130). */
  readonly onInterrupt?: (handler: () => void) => () => void;
}

export interface CliServeOpts {
  readonly host: string;
  readonly port: number;
  readonly handler: (input: CliServeRequest) => Promise<CliServeResponse>;
  readonly signal?: AbortSignal;
}

export interface CliServeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface CliServeResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface CliServeHandle {
  readonly port: number;
  readonly close: () => Promise<void>;
}

export type CliOutputFormat = 'json' | 'jsonl' | 'pretty' | 'table' | 'toon' | 'yaml';
