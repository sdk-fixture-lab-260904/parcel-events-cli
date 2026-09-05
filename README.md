# parcel-events-cli

Command-line access to the API — JSON out, predictable errors, built for scripts and agents.

18 command(s). Identity: `parcel-events-cli --provenance`.

## Quick start

```sh
npx --package @sdkfixturelab260904/parcel-events-cli parcel-events-cli --help
npm install -g @sdkfixturelab260904/parcel-events-cli
parcel-events-cli shipments list
parcel-events-cli find shipments
```

Development (from this package): `npm run build && node dist/src/cli.js --help`.

## Usage

```sh
parcel-events-cli find <query>                      # search the catalog (JSONL)
parcel-events-cli resolve --operation-key "GET /…"  # bind the stable id
parcel-events-cli <group> <command> [flags]         # call the API
parcel-events-cli <group> <command> --schema        # JSON schema of the command input
parcel-events-cli <group> <command> --dry-run       # print the exact request; send nothing
parcel-events-cli <group> <command> --mock          # schema-shaped example; no network
parcel-events-cli --schema                          # index catalog (add --full for pagination objects)
parcel-events-cli --profile staging <group> <cmd>   # merge ~/.config/parcel-events-cli/config.toml
parcel-events-cli completion bash                   # shell completion (also: zsh | fish)
```

Base URL: `--base-url` → `PARCEL_EVENTS_CLI_BASE_URL` → the spec default.

## Authentication

Credentials come from the environment — the CLI never prompts. Flag overrides env.

| Variable | Used for |
| --- | --- |
| `PARCEL_EVENTS_API_KEY` | API key (header `Parcel-API-Key`) |
| `PARCEL_EVENTS_BEARER_TOKEN` | Bearer token |

`parcel-events-cli auth status` reports which variables are set (values are never printed).
`parcel-events-cli auth env` prints the export template.

Runnable groups (first fully satisfied wins; smallest if several): api_key; bearer_token.

## Webhooks

`parcel-events-cli webhooks verify|listen|replay` verifies inbound signatures.
Secret: `--secret` or `PARCEL_EVENTS_CLI_WEBHOOK_SECRET`. Listen binds 127.0.0.1 and prints JSONL.

## Output

- Success → stdout as JSON (default), or `--format jsonl|pretty|table|toon|yaml` (`--raw` forces JSON)
- Errors → one JSON line on stderr with a stable `kind`
- Slice results → `--transform <dot.path>`

## Command reference

See [COMMANDS.md](./COMMANDS.md) and [SKILL.md](./SKILL.md). Specs over 20 MiB generate locally.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Findings (e.g. `--fail-on-deprecated`) |
| 2 | Usage / bad flags |
| 3 | Config |
| 4 | Auth |
| 5 | Forbidden |
| 6 | Not found |
| 7 | Conflict |
| 8 | Rate limited |
| 9 | Server |
| 10 | Version skew |
| 124 | Timeout |
| 130 | Interrupted |
