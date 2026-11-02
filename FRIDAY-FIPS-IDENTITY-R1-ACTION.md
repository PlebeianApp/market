# Friday FIPS identity R1 action boundary

Status: **approval-ready plan only; not executed**.

This stage is deliberately independent of the successor application build. It
installs only the already reviewed FIPS 0.5.2 executables and the reviewed
atomic promotion helper, then creates one local FIPS identity on each of the
four demo validators. It creates no FROST, DKG, signer, Comet, coordinator,
mint, Nostr or browser key and starts no listener or service.

## Exact immutable inputs

| input | source | SHA-256 |
|---|---|---|
| `fips` | `live-bin-friday-candidate-r13/fips` | `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2` |
| `fipsctl` | `live-bin-friday-candidate-r13/fipsctl` | `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3` |
| promotion helper | `scripts/friday-fips-identity-promote.py` | `91ce335a08919a792f8ca8fd7ca0a4424cea8120522b0c30906368e5b2c672a9` |

FIPS is pinned to upstream source revision
`53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`. The helper came from independently
reviewed commit `ba4f3ba314128c205d9c501f7958eeca51852dcf` and is integrated byte-for-byte
at local commit `a8b5372557e0ff298398ca98d910dcd11c082d63`.

The three files are installed root-owned below the new versioned directory
`/opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/`. The two
binaries are mode 0755. The helper and every parent from that release root are
root-owned and not group/world writable; the helper is mode 0700. The helper is
invoked only as:

```text
/usr/bin/python3 -I -S -B \
  /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/scripts/friday-fips-identity-promote.py \
  --staging /var/lib/plebeian-auctions-friday/fips/identity.staging.friday-fips-identity-20261023-r1 \
  --expected-helper-sha256 91ce335a08919a792f8ca8fd7ca0a4424cea8120522b0c30906368e5b2c672a9
```

No PATH lookup, alternate interpreter, `fipsctl --stdout`, `--force`, package
installation or network download is allowed.

## Exact hosts and previously observed state

| slot | host identity | IPv4 | observed Friday state |
|---:|---|---|---|
| 1 | `linode-108175009` | `172.105.64.142` | no Friday account/root/binary/unit/identity/listener |
| 2 | `linode-108236985` | `172.105.95.57` | inert Friday account/roots and matching FIPS binaries; no identity/unit/listener |
| 3 | `linode-108237290` | `172.104.240.217` | no Friday account/root/binary/unit/identity/listener |
| 4 | `linode-108237424` | `172.104.253.247` | no Friday account/root/binary/unit/identity/listener |

The inventory was read-only at 2026-10-23 14:23 UTC. It must be repeated before
this action. Owner-reported provider rules allow peer-restricted UDP 32121, but
this identity stage does not test or use that port.

## One sequential attempt per host

The hosts are processed one at a time. A mismatch stops the entire stage.

1. Revalidate the expected SSH agent fingerprint and pinned host key; then
   record host ID, boot ID, free space, memory, current Friday paths, account,
   units, `fips0`, UDP 32121 listeners, and Wednesday validator PID/restart
   count. Do not inspect environment variables, application data or secrets.
2. On V1/V3/V4 only, create the `plebeian-friday` system group and nologin
   account. Never assume numeric UID/GID equality across hosts. On V2 require
   the existing account and roots to match the recorded owner/mode; do not
   rewrite them. Wednesday paths, users, units and data are excluded.
3. Transfer only the three immutable inputs above over the already pinned SSH
   connection. Install them in the versioned root-owned release, hash them on
   the destination, and stop on any byte, owner, mode or parent-chain mismatch.
4. Require `/var/lib/plebeian-auctions-friday/fips` to be a local,
   non-symlink, `plebeian-friday:plebeian-friday`, mode-0700 directory. Require
   the final `identity` path absent. Refuse **any** existing direct child whose
   name begins `identity.staging.`, not only the intended run name.
5. Require the persistent operator parent
   `/var/lib/plebeian-auctions-friday-operator` to be a root:root mode-0700
   non-symlink directory with a root-controlled, non-writable parent chain.
   Atomically create its distinct direct child
   `fips-identity-generation-20261023-r1` with `mkdir`, root:root mode 0700,
   then fsync the operator parent **before** creating staging or invoking key
   generation. It is the durable operation sentinel from pre-keygen through
   final verification and survives reboot. Separately require root-controlled
   `/run/lock/plebeian-auctions-friday` mode 0700 and the helper's short-lived
   `fips-identity-promotion.lock` absent; do **not** precreate that helper lock.
6. Create exactly
   `/var/lib/plebeian-auctions-friday/fips/identity.staging.friday-fips-identity-20261023-r1`
   as the local service identity, mode 0700, on the same filesystem as the
   final parent. With cleared supplementary groups, no capabilities,
   `no_new_privs`, a minimal environment and `umask 077`, run exactly once:

   ```text
   /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
     keygen -d /var/lib/plebeian-auctions-friday/fips/identity.staging.friday-fips-identity-20261023-r1
   ```

7. After the generator exits, require the staging directory to contain exactly
   `fips.key` and `fips.pub`. Both must be single-link bounded regular files
   owned by the local service account. `fips.key` must be mode 0600 and size
   1..256 bytes. `fips.pub` must be size 1..256 bytes and neither group/world
   writable nor executable. Require one canonical lowercase `npub1` value.
   Run the pinned `fipsctl address -k` separately against `fips.key` and
   `fips.pub`; require the two outputs to be identical canonical lowercase
   IPv6 ULAs beginning `fd`. Record only slot, host ID, public `npub`, ULA and
   the three immutable input hashes. Never print, hash or transfer `fips.key`.
8. Fsync both identity files and the staging directory. Recheck their inodes,
   sizes, owners and modes. Require no Friday service process to be running.
   Invoke the promotion helper exactly as shown above. It creates its own
   root-controlled exclusive promotion lock and performs a same-directory
   `renameat2(RENAME_NOREPLACE)` plus post-rename inode and durability checks.
9. Reopen the final directory without following links and repeat the exact
   entry/owner/mode/size, canonical `npub`, and private/public ULA-equality
   checks. Require staging absent. A helper refusal after rename is an
   uncertain promoted outcome: inspect it; never regenerate or retry.
10. Keep the persistent
    `/var/lib/plebeian-auctions-friday-operator/fips-identity-generation-20261023-r1`
    directory as the permanent root-controlled completion/attempt sentinel.
    On success create and fsync a root-owned mode-0600 `complete.json` inside
    it containing only the public record and input hashes, then fsync the
    operator parent. On failure it has no completion receipt and all
    locks/private state remain for separately approved inspection. This avoids
    reboot loss or a helper-lock unlink/fsync window being mistaken for
    permission to retry.

The service account owns the identity parent, so the action is performed only
with all Friday services absent. The promotion helper permits files up to 64
KiB; this outer action intentionally imposes the stricter 1..256-byte gate and
revalidates after promotion. Freshness comes from the root-controlled
generation sentinel, refusal of every prior staging entry, the fixed unique
staging name and one-attempt rule. The helper itself does not independently
prove freshness.

## Failure, cleanup and exclusions

There is no automatic failure cleanup. On any denial, timeout, disconnect,
unexpected file, hash mismatch, keygen failure, validation failure, rename
refusal, fsync failure or uncertain outcome:

- stop the whole four-host sequence;
- do not delete the persistent generation sentinel or promotion lock;
- do not delete, rename, chmod, chown or regenerate any staging/final identity;
- record only secret-free path/type/owner/mode/inode/process facts; and
- request separate, exact inspection/cleanup approval.

This action does **not** create FROST/DKG/Comet/coordinator/mint/browser keys,
render `fips.yaml`, create `fips0`, start FIPS or any other service, open a
listener, modify a route/firewall/nginx/certificate, initialize a database,
change Wednesday, touch production, push code or activate public funding.

## Evidence required before the following stage

For all four hosts: exact transferred hashes, account name and numeric IDs,
release and identity path metadata, generation-sentinel status, public `npub`,
canonical ULA, private/public derived-address equality, absence of staging and
unexpected entries, absence of Friday processes/listeners, and unchanged
Wednesday PID/restart count. Only then can the four owner-reviewed DKG host pins
be rendered for a separate approval.
