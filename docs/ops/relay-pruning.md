# Relay Pruning and Disk Safety Runbook

This runbook defines a safe, maintainer-approved approach for keeping the
Plebeian Market relay host lean without accidentally deleting user data.

## Investigation Snapshot — September 11, 2026

Read-only staging checks found 29 GiB available on the 79 GiB root filesystem
(62% used), with approximately 17 GiB in the search index, 4.1 GiB in raw events,
and 2.2 GiB in the system journal. There was no immediate disk shortage in this
snapshot. Historical disk growth was not measured.

The relay reported version `d9947f799f32`. Systemd recorded 39 cumulative
automatic restarts, with the current process running since September 8 at
17:30:29 UTC. At 17:30:23 UTC the kernel explicitly killed `market-relay` for
global memory exhaustion after approximately 3.4 GiB anonymous resident memory
on a 3.8 GiB VPS. Earlier restarts had the same OOM evidence. These are memory
failures; the snapshot does not establish which allocation path caused them.

The deployed source uses Bleve's dynamic mapping and skips closing both
backends because its close helper checks the wrong method signature. It also
deletes the search directory on missing metadata without rebuilding old events.
The storage-preservation fixes and compact mapping have local regression tests;
actual staging savings and elimination of memory failures require an explicit
rollout and observation under representative traffic.

## Immediate Ops Rule

Until disk pressure is resolved:

- Do not run non-essential deploys.
- Do not delete raw relay events without explicit maintainer approval.
- Prefer read-only inventory and safe cleanup before any relay-data pruning.
- Treat `/var/lib/market-relay/raw` as source-of-truth relay data.
- Treat `/var/lib/market-relay/search` as a pruning candidate only after rebuild behavior is verified.

## Data Boundaries

### Preserve by default

Raw relay event store:

    /var/lib/market-relay/raw

This contains stored relay events and must not be deleted as part of routine cleanup.

### Candidate only after verification

Search index:

    /var/lib/market-relay/search

This may be rebuildable from raw events, but do not delete it until maintainers
verify the relay can safely rebuild it and the rebuild procedure is documented.

### Safe cleanup candidates

These are safer first targets when disk is tight:

- systemd journal retention
- apt package cache and apt lists
- failed deploy leftovers in `/tmp`
- stale deploy staging files in `/home/deployer`
- old non-live release directories after symlink validation

### Inspect first, never blind prune

- Docker volumes
- Docker images
- Docker build cache
- Docker storage under `/var/lib/docker`
- relay raw data
- relay search index

Do not manually delete files under `/var/lib/docker`. Use Docker-aware
inspection and cleanup commands only after confirming what is unused.

## Read-Only Disk Inventory

Configure host access locally, outside the repository. Prefer an SSH config
alias that uses a dedicated deploy key and keeps operator-specific host, user,
IP, and key-path details out of committed runbooks.

Example local SSH config entry:

    Host market-relay-staging
      HostName <staging-hostname-or-ip>
      User <ssh-user>
      IdentityFile ~/.ssh/<dedicated-deploy-key>
      IdentitiesOnly yes
      StrictHostKeyChecking yes

Do not commit operator-specific private-key paths, raw VPS IPs, or examples that
disable host key checking.

Use this before any cleanup:

A helper script is also available for the same read-only inventory:

    scripts/ops/relay-disk-report.sh market-relay-staging

The script requires a local SSH config alias and does not perform cleanup.

    ssh market-relay-staging '
    set -u

    df -hT
    df -i

    sudo du -xhd1 /var/lib 2>/dev/null | sort -h | tail -30 || true
    sudo du -sh \
      /var/lib/market-relay \
      /var/lib/market-relay/raw \
      /var/lib/market-relay/search \
      2>/dev/null || true

    du -sh /tmp /tmp/deploy-package 2>/dev/null || true
    du -sh /home/deployer/deploy-package /home/deployer/*.tar.gz /home/deployer/Caddyfile.staging 2>/dev/null || true
    du -sh /home/deployer/releases/* 2>/dev/null | sort -h || true

    docker system df || true
    sudo journalctl --disk-usage || true
    if command -v lsof >/dev/null 2>&1; then
      sudo lsof +L1 2>/dev/null | sort -k7 -n | tail -20 || true
    else
      echo "lsof not installed; skipping deleted-open-file check"
    fi
    sudo systemctl status market-relay --no-pager || true
    '

Do not inspect `.env` files or secrets as part of disk cleanup.

## Deploy Safety Thresholds

Recommended operational thresholds:

- Under 2 GB free on `/`: avoid deploys unless urgent.
- Under 1 GB free on `/`: treat deploys as high-risk.
- Under 500 MB free on `/`: stop and recover disk before deploys.

These thresholds are operational guidance, not a replacement for monitoring.

## Safe Cleanup Order

Prefer this order:

1. Journal vacuum to a bounded size.
2. Apt cache cleanup when no package manager is active.
3. Failed deploy leftovers in `/tmp`.
4. Stale deploy staging files in `/home/deployer`.
5. Old non-live release directories after validating live symlinks.
6. Docker inspection with Docker-aware commands, not manual deletion.
7. Search index reset or rebuild only after explicit verification.
8. Raw event retention policy only after explicit maintainer agreement.

## Backup Before Relay Pruning

Before any relay-data pruning, take a protocol-level backup of market events when possible:

    bun run deploy-simple/scripts/market-events/backup.ts --stage staging
    bun run deploy-simple/scripts/market-events/backup.ts --stage production

These backups cover market-scoped events, not necessarily every raw relay event.

Do not write large backups to the same nearly-full disk. Before backing up relay
data, confirm that the destination is off-box or on a separate partition and has
enough free space for the expected backup size.

For full raw relay backups, maintainers must define a separate off-box backup
procedure. Do not copy large raw databases onto the same nearly-full disk.

## Search Index Reset/Rebuild Policy

Deleting `/var/lib/market-relay/search` is not allowed by default.

Before allowing it, maintainers must verify:

- raw events remain intact in `/var/lib/market-relay/raw`
- the relay can recreate a valid search index from raw data
- the service restart or rebuild sequence is documented
- the rollback procedure is documented
- enough free disk exists for the rebuild
- rebuild time and expected downtime are estimated on representative data
- the expected downtime is acceptable

Until then, search-index deletion requires explicit maintainer approval.

## Raw Event Retention Policy

Raw event pruning is a separate policy decision.

Preserve by default:

- app-authored events
- product/catalog events
- order/payment/receipt events
- current market protocol events
- events needed for user, account, or business continuity

Potential future pruning categories, only after maintainer agreement:

- spam
- malformed events
- unsupported non-market kinds
- old non-market noise
- expired data, if expiration semantics are explicit

Raw event deletion may erase relay history and should never happen as an
implicit disk cleanup step.

## Offline Compact Index Rebuild

The relay now provides `--rebuild-search-to <new-directory>`. This is an
explicit maintenance operation, never part of an ordinary deploy or startup.
Install and verify the compatible relay binary first, preserving the existing
index. The current dependency remains pinned and supports both index mappings.

Before rebuilding:

1. Agree a maintenance window. The relay must remain stopped while its BoltDB
   file is read; do not bypass the database lock or copy a live BoltDB file with
   ordinary filesystem tools.
2. Verify a complete, consistent raw-event backup off the VPS. The market-event
   export described above is not a complete raw-event backup.
3. Allow space for the current index and its replacement at the same time, plus
   at least 2 GiB free. The command checks the reserve between batches, but
   compaction can allocate additional space. Small-fixture savings do not
   establish the full-data size, memory requirement, or rebuild duration.
4. Record service state, restart history, disk allocation, and representative
   raw-event IDs/search queries. Historical `NRestarts` are not automatically
   cleared by this procedure; the staging installer may refuse activation
   until the previous failures have been investigated.

The following example assumes the documented default paths and that neither
`search-compact` nor `search-before-compact` already exists. Run the rebuild as
the service user. These commands stop/start the service and write a new index:

```bash
sudo systemctl stop market-relay
GOMEMLIMIT=1GiB /usr/local/bin/market-relay \
  --rebuild-search-to /var/lib/market-relay/search-compact
```

The command reports the count after all raw events have been decoded, indexed,
and the index has closed successfully. It never skips corrupt raw records.
On failure, keep using the old index; do not activate output containing
`.rebuild-incomplete`. Output from an interrupted/failed run is retained for
inspection, and a retry must use another new directory.

After a successful rebuild, while the relay is still stopped, a maintainer may
activate the replacement by renaming directories on the same filesystem:

```bash
set -e
test -d /var/lib/market-relay/search-compact
test ! -e /var/lib/market-relay/search-compact/.rebuild-incomplete
test ! -e /var/lib/market-relay/search-before-compact
mv -T /var/lib/market-relay/search /var/lib/market-relay/search-before-compact
mv -T /var/lib/market-relay/search-compact /var/lib/market-relay/search
sudo systemctl start market-relay
```

Check local NIP-11, representative raw-event lookups and searches, restart/OOM
history, memory, and disk growth before declaring the migration successful.
Keep the previous index until full-data verification is complete. Deleting that
backup is a separate approved cleanup step, not an automatic deploy action.

Binary rollback can keep the compact index: its fields are compatible with the
old backend. The retained old index is a snapshot of search state before the
switch; after new events arrive, blindly restoring it would omit those events
from search even though they remain in the raw store. Any index rollback after
new writes requires reconciliation against the current raw store.

## Non-Goals

This runbook does not:

- delete raw relay events
- prune Docker volumes
- reset the search index automatically
- restart the relay
- define a final raw-event retention policy
