---
name: parcel-events-cli
description: Agent-first generated API CLI (18 commands).
---

# parcel-events-cli

parcel-events-cli — generated API CLI (sdkSha 0384a833d4d4)

18 command(s). Use `x-operation-key` as the stable id; help words may be speakable.

## Protocol

Operate without scraping `--help`. Frozen exits apply to every step.

1. Search: `parcel-events-cli find <query>` (JSONL)
2. Bind key: `parcel-events-cli resolve --operation-key "<METHOD /path>"`
3. Catalog: `parcel-events-cli --schema` (index; add `--full` for pagination objects)
4. Inspect: `parcel-events-cli <group> <verb> --schema` (stable `x-operation-key`)
5. Plan: `parcel-events-cli <group> <verb> --dry-run` (no credentials)
6. Offline: `parcel-events-cli <group> <verb> --mock` (no network)
7. Live: same argv without `--dry-run` / `--mock`. Auth: `parcel-events-cli auth status`. Auth groups (first satisfied wins; smallest if several): api_key; bearer_token.

## Recipe

```sh
parcel-events-cli find shipments
parcel-events-cli shipments list --schema
parcel-events-cli shipments list --dry-run --base-url https://api.example.test
parcel-events-cli shipments list --mock --base-url https://api.example.test
```

## Operations

| path | key |
| --- | --- |
| `labels create` | `post /v1/labels` |
| `labels retrieve` | `get /v1/labels/{}` |
| `pickups cancel` | `delete /v1/pickups/{}` |
| `pickups create` | `post /v1/pickups` |
| `pickups list` | `get /v1/pickups` |
| `pickups retrieve` | `get /v1/pickups/{}` |
| `rates quote` | `post /v1/rates/quote` |
| `shipments cancel` | `delete /v1/shipments/{}` |
| `shipments create` | `post /v1/shipments` |
| `shipments events list` | `get /v1/shipments/{}/events` |
| `shipments list` | `get /v1/shipments` |
| `shipments retrieve` | `get /v1/shipments/{}` |
| `shipments update` | `patch /v1/shipments/{}` |
| `retrieve` | `get /v1/tracking/{}` |
| `webhook-endpoints create` | `post /v1/webhook-endpoints` |
| `webhook-endpoints list` | `get /v1/webhook-endpoints` |
| `webhook-endpoints remove` | `delete /v1/webhook-endpoints/{}` |
| `webhook-endpoints update` | `patch /v1/webhook-endpoints/{}` |

## Identity

`parcel-events-cli --provenance` prints `sdkSha` / `irSha` / `cliKernelVersion`.
`parcel-events-cli --fail-on-deprecated` exits 1 (findings) on a deprecated command.
