# Proposed live FIPS rollout — exact approval boundary

Status: **planning only; do not execute**. Updated 2026-10-22 UTC.

The owner approved the FIPS objective and live VPS/firewall changes in
principle. This document narrows the future action-time request. It is not
authority to mutate a host, firewall, service or credential. The local unified
payment path is now real but explicitly non-FIPS; no rollout begins until a
separately frozen FIPS candidate passes the isolated lab and the owner approves
the exact final hashes and actions below.

## Exact hosts, and nothing else

| slot | Linode ID | IPv4 | proposed FIPS ULA |
|---|---:|---|---|
| V1 | 108175009 | 172.105.64.142 | fdc4:dc3c:6792:3f67:5b5d:453d:8712:b236 |
| V2 | 108236985 | 172.105.95.57 | fd76:1a7b:b02d:6bd8:54e8:653f:110f:87be |
| V3 | 108237290 | 172.104.240.217 | fd52:1a36:50a9:0faa:3501:ce66:f3b8:7838 |
| V4 | 108237424 | 172.104.253.247 | fd40:fda8:93de:8d8c:2bd1:b243:e607:7b7f |

Production `192.46.234.233` is excluded. V1 HTTPS/site/mint ports and data are
excluded. The last task-local inventory of these four hosts is from 2026-10-20;
current processes, units, listeners, firewall attachments, disk/memory and
installed hashes must be re-verified read-only immediately before a request to
execute. No historical fact is presented as current host state.

## Frozen artifacts required before approval

- jmcorgan/fips 0.5.2 revision
  `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`:
  `/usr/bin/fips` SHA-256
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`
  and `/usr/bin/fipsctl` SHA-256
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.
- A Friday validator/signer/coordinator package built from the final reviewed
  local commit, with exact binary/package SHA-256 values filled in here after
  the isolated lab. The old fix16 validator hash is provenance, not an
  automatically selected Friday payment binary.
- A source and binary manifest proving the exact four-host SignerRPC service,
  FROST participant, public inspector, validator, and evidence collector.
  Null, stale or cross-commit pins are a hard stop.

## Proposed persistent secrets and placement

After exact approval, generate fresh fake-only identities; do not reuse local
lab keys, existing SSH keys, Comet validator keys, Nostr keys or the Wednesday
single committee key.

- one FIPS identity per matching host under
  `/var/lib/plebeian-auctions-friday/fips/`, directory 0700, private key 0600;
- one participant share, nonce/operation journal and distinct SignerRPC
  identity per matching host under
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1/`, owned by a dedicated
  non-login service account, directory 0700/private files 0600;
- only public group/roster/verifying-share metadata on V1 coordinator;
- no private share or nonce copied across hosts, into Git, evidence or chat.

The fresh DKG requires all four hosts. Lost, corrupt or rolled-back signer
state quarantines that signer and requires rotation/re-DKG; restoring an older
share/nonce snapshot is forbidden. Validator online, FIPS online, signer safe
and payment ready remain separate statuses.

## Exact network and firewall delta

Proposed provider ingress on each of V1–V4: UDP 32121 accepted only from these
four `/32`s:

`172.105.64.142/32`, `172.105.95.57/32`,
`172.104.240.217/32`, `172.104.253.247/32`.

No `0.0.0.0/0`, IPv6 public rule, TCP transport rule, public SignerRPC, public
Comet RPC, port 80, new HTTPS rule or admin listener. Preserve each existing SSH source
restriction and inbound-DROP/outbound-ACCEPT policy. V1's dedicated web
firewall must retain its existing SSH, HTTPS and current P2P rules while the
candidate is staged. V2–V4's shared firewall must not gain public HTTPS.

FIPS binds public underlay UDP 32121 only. Inside `fips0`, the blue/green
Friday Comet P2P candidate binds the host's fixed ULA on TCP 27656 and
SignerRPC binds its ULA on TCP 39101. Comet RPC remains
`127.0.0.1:27657`; the Friday site stays on V1 loopback 8180, while the fake
mint binds V1's FIPS ULA on TCP 3438 so participant-local policy can reach it
only through FIPS. Peer ACLs contain exactly the other three FIPS identities.
No clearnet fallback is counted as FIPS evidence. The running Wednesday ports
and data remain unchanged during blue/green validation.

## Bounded service transition

1. Reverify all four hosts and current provider rules read-only. Refuse on a
   conflicting workload, listener, artifact hash or service state.
2. Stage the exact package and fresh fake-only keys without starting services.
   Verify path ownership/mode/hash on every host.
3. Add only the source-restricted UDP 32121 rules. Re-read the complete provider
   rules before any listener starts.
4. Start and authenticate all four FIPS peers. Verify exact peer ACLs,
   encrypted-link counters and no public application port.
5. Migrate validators one at a time, never taking a second validator down
   before the first has caught up and the other three produce canonical
   commits. Bind peers to the four ULAs.
6. Start four SignerRPC services, then perform one fake-only admission and
   terminal recovery with one signer/validator unavailable. Do not touch the
   Wednesday liabilities or real-value endpoints.
7. Only after positive no-fallback evidence, remove/disable direct public
   26656. A transition retaining 26656 temporarily must be labelled migration,
   not completed FIPS.

The validator service may retain its current bounded automatic restart only
after a reviewed FIPS dependency/order policy exists. FROST signer services
must fail closed on journal/epoch/anchor mismatch and must not inherit
validator restart readiness. The historical fix16 `Restart=no` candidate is
not a 24/7 policy and will not be silently substituted.

## Evidence and rollback

Success requires: four exact process/binary/key identities; four authenticated
FIPS peers; advancing underlay and `fips0` counters; application socket
ownership on the ULAs; direct-underlay application refusal; canonical commits
from all four, then three with the designated fourth unavailable; real 3-of-4
FROST; exactly one fake-mint spend/recovery/import; and no secret/bearer bytes
in evidence.

Rollback before direct 26656 removal: stop the new SignerRPC/FIPS services,
restore each validator's previously captured exact config one at a time, prove
four-peer clearnet consensus, then remove only the new UDP 32121 rules and fresh
test-only keys/services. Rollback after direct 26656 removal first restores the
captured source-restricted 26656 rules/configs while at least three validators
remain healthy. Never run two network paths as ambiguous concurrent authority.
Any uncertain provider/service result is checked read-only before retry.

## Exact permission still required

After the local lab passes and final hashes are populated, request one explicit
approval naming: these four Linode IDs/IPs; the exact package and binary hashes;
creation/placement of the fresh FIPS and FROST/SignerRPC identities at the paths
above; UDP 32121 from the four `/32`s; installation/enabling/restarting of the
named four FIPS, validator and signer services; sequential P2P migration;
temporary retention then removal of direct 26656; and the rollback actions.
Until that approval, this manifest authorizes nothing.
