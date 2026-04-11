# Market Event Backup Scripts

Stage-aware operational scripts for backing up and restoring market relay data
as editable NDJSON files.

## Files

- `backup.ts` - fetches market-related events from a stage relay and writes one
  NDJSON file per scope plus `all.ndjson` and `manifest.json`
- `restore.ts` - reads those NDJSON files and republishes the raw signed events
  to a target relay
- `_shared.ts` - shared stage resolution, scope definitions, manifest helpers,
  and publish logic

## Default Scopes

- `app-authored` - every event authored by the app pubkey
- `catalog` - all product and collection events (`30402`, `30405`)
- `lists` - all `30003` list events
- `app-data` - all `30078` app-specific data events
- `orders` - all order and payment events (`14`, `16`, `17`)

These scopes are intentionally broad enough to capture the market data model
from [SPEC.md](/Users/schlaus/workspace/market/SPEC.md) without relying on one
opaque relay dump.

## Backup

```bash
bun run deploy-simple/scripts/market-events/backup.ts --stage staging
bun run deploy-simple/scripts/market-events/backup.ts --stage production
```

Optional overrides:

```bash
bun run deploy-simple/scripts/market-events/backup.ts \
  --stage staging \
  --out-dir deploy-simple/backups/staging-snapshot \
  --scopes app-authored,catalog,orders \
  --since 1773900000
```

Output layout:

- `manifest.json` - stage, relay, app pubkey, counts, and scope file metadata
- `all.ndjson` - deduped union of all backed up events
- `<scope>.ndjson` - one file per selected scope

## Restore

```bash
bun run deploy-simple/scripts/market-events/restore.ts \
  --stage staging \
  --in-dir deploy-simple/backups/market-staging-20260320T000000Z
```

Dry-run restore:

```bash
bun run deploy-simple/scripts/market-events/restore.ts \
  --stage production \
  --in-dir deploy-simple/backups/prod-snapshot \
  --dry-run
```

Restore selected scopes only:

```bash
bun run deploy-simple/scripts/market-events/restore.ts \
  --stage staging \
  --in-dir deploy-simple/backups/staging-snapshot \
  --scopes app-authored,orders
```

By default the restore treats duplicate publish rejections as skipped so reruns
are safe against an already-seeded relay.
