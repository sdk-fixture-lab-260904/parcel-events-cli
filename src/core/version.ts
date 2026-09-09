/**
 * The generated-CLI kernel identity (lab B9, doc 38 §7 W6 pulled forward).
 * `CLI_KERNEL_VERSION` folds into `cliSha`. This file IS vendored into every
 * generated CLI package (the generated `src/cli.ts` stamps it into `--version`).
 */
export const CLI_KERNEL_NAME = 'doctorine-sdk-cli-kernel';
// 0.2.0 (2026-07-23): query-auth dry-run redaction, flag-token value guard,
// --version/--help at any position, base-URL CONFIG validation, stdin --body
// JSON parity, classified response-read failures (lab-moat codex hardening).
// 0.3.0 (2026-07-23): dispatch validates every passed flag against the
// SELECTED command (the parse-time union table is not an acceptance set).
// 0.4.0 (2026-08-17): Phase 0 — dry-run without credentials; file/@path
// uploads; --transform + yaml; retries; --max-items pager; SSE/JSONL
// streaming; fish completions. Additive CliSpec fields (operationKey,
// pagination, stream, retries, idempotencyHeader).
// 0.5.0 (2026-08-18): Phase 1 — --mock, --provenance, deprecation warnings
// + --fail-on-deprecated (FINDINGS 1), speakable leaves, SKILL.md on the
// CLI zip, CliSpec.mockResponse + provenance embed.
// 0.6.0 (2026-08-18): Phase 2 — pager x-drain in --schema, required dotted
// body leaves XOR --body, primary-scheme auth flags + env, webhook
// verify|listen|replay, interrupted kind for 130, catalog + lazy shards.
// 0.7.0 (2026-08-18): full anyOf auth plane, unique per-scheme flags,
// first-satisfied + smallest-group, per-command security override,
// speakable nouns + path-shape disambiguation, acronym-plural kebab.
// 0.8.0 (2026-08-18): auth honesty (declared/proposed/refused/unused),
// gateway-before-vN speakable, OData list/get + path-shape params,
// dotted-tag split, pagination vocabulary, product packaging cliffs
// (not doc-27 400), group --schema, $select flags.
// 0.9.0 (2026-08-18): success-status 2XX/default (derive=IR), $ref/allOf
// collection envelopes, compound path-shape, IR _N / lone verb-api
// speakable, path-noun harvest, singleton-OR foo_legacy env alias.
// 0.10.0 (2026-08-18): find + resolve builtins, index-only root --schema
// (`--full` restores the fat catalog), product README + COMMANDS.md,
// hero SKILL recipe (not commands[0]).
// 0.11.0 (2026-08-18): --format toon, --fields, TTY table default,
// --example request|response, reserved-flag $ aliases (--$format).
// 0.12.0 (2026-08-18): proposed env is {BIN}_TOKEN, oneOf union body
// leaves, collection GET → list, OAuth2 client-credentials exchange.
// 1.0.0 (2026-08-18): profiles + aliases, completion depth 4, npx/install
// README, product-door copy for specs over 20 MiB (local generate).
// 1.1.0 (2026-08-18): --format pretty (stdout only), --raw JSON alias,
// one man page per group, npm pack / file: install proof.
// 1.2.0 (2026-08-18): usage JSON caps at 24 paths (group counts + find
// hint); pretty/table --mock wraps primitive arrays as `{value}` rows.
// 1.3.0 (2026-08-18): hero denylist; env stem drops `data`; Basic SKILL
// honesty; any_of prefers bearer over deprecated query; CLI skips inbound
// webhook/callback event leaves; prerelease resource heads merge into the
// stable sibling.
// 1.4.0 (2026-08-21): `auth status` variables no longer borrow a sibling's
// flag — OAuth2 client id/secret are env-only, so they report no flag and
// their `set` no longer follows the token flag.
// 1.5.0 (2026-09-03): streaming commands force their admitted query/body
// discriminator and preserve a successful JSON fallback response instead of
// silently rendering an empty event list.
// 1.6.0 (2026-09-08): safe write retries and explicit unsafe replay opt-in.
// 1.8.0 (2026-09-08): schema constraints before transport and OpenAPI parameter serialization.
export const CLI_KERNEL_VERSION = '1.8.4';
