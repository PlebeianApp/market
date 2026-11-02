# Friday R10 next action

Status: **exact-current artifacts are built and regression-tested; the trusted-
HTTPS/FIPS acceptance run and deployment are not approved or run.**

Artifact source is `72ddbd7f08e2a283a37ea1b54c7cc924f71f0a00`, tree
`1c20022e2533c249549415d498b5f79f6d3c6404`. Complete artifact hashes,
toolchains, VCS provenance and test results are in
`FRIDAY-CANDIDATE-R10-BUILD-RECEIPT.json`.

## What R10 adds

- Recovery-only is enforced by both the public Go site and the authority
  service. It rejects new faucet, auction, bid, close, offline-control, funding
  and seller-intent mutations. Recovery routes accept only operation identities
  already found in the exact durable stores.
- Coco persists `coco_send_pending` before a threshold send can reserve proofs.
  A retry resumes the same operation ID and never creates a replacement send.
- If a controlled mint claims NUT-12 but emits missing or invalid DLEQ, the
  operation remains durable and its value remains unavailable. R10 does not
  weaken proof validation or invent a refund capsule from invalid evidence.

## Verified locally

- TypeScript typecheck passed.
- Recovery/Coco focused tests passed 36/36 (138 assertions).
- Browser focused tests passed 46/46 (185 assertions).
- The restricted Friday suite passed 253/255 (999 assertions). Its only two
  failures were OS-child IPC cases refused by the restricted sandbox with
  `EPERM`; the exact affected file passed 6/6 (38 assertions) in the normal
  runner.
- Go all-package tests passed. The Go artifact embeds VCS revision
  `72ddbd7...`, `vcs.modified=false`, and `GOAMD64=v1`.
- The Rust participant passed 21/21. The public inspector test/build passed
  with a zero-test target.
- The committed browser bundle and shipped browser artifact are byte-identical,
  SHA-256 `61c95d91d164fdecc46dceb18075d8ce822e9064e491e56f353e2d25b644140f`.

These are compile and regression results. They are not an exact-current
four-host FIPS run, a normally trusted HTTPS browser/Coco payment run, or a
deployment result.

## Required fresh-store and controlled-mint gates

Friday must use a distinct normally trusted HTTPS origin. V1
`https://172.105.64.142/` remains the Wednesday origin and must never answer for
Friday receipts or mint identity. The current source-compatible proposal is V2
`https://172.105.95.57/`; no certificate has been issued for it.

Before activation, the distinct Friday environment must prove all of the
following:

1. The server database and independent-anchor destinations are absent, then
   created once with exclusive creation. A present, inaccessible or ambiguous
   path is a refusal, not an invitation to reset it.
2. The Friday browser origin has no prior Friday public/private operation store.
   Any record is preserved and activation stops; no pre-R10 record is silently
   loaded, cleared or migrated in place.
3. The mint advertises NUT-12, the pinned active keyset matches the reviewed
   deployment, and a real fake-money canary returns valid DLEQ for every locked
   input before public funding is enabled.
4. A post-swap DLEQ refusal leaves the exact Coco operation recoverable as
   `coco_send_pending` and unavailable. The demo makes no instant-refund claim
   for a malicious or misbehaving mint that cannot supply valid proofs.

## First owner action: restore bounded read-only access

The worker cannot use the historical agent socket from its restricted
environment. In the owner's terminal, unlock only the recorded key without
sharing a passphrase:

```bash
test -S /tmp/plebeian-poc-owner-agent.sock
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh-add -t 14400 /home/maximoto/.ssh/id_ed25519
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh-add -l -E sha256
```

Expected owner-key fingerprint:
`SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34`. Stop if it differs.

Recorded host ED25519 fingerprints, which must independently match the owner's
pinned `known_hosts` before any connection:

| host | fingerprint |
|---|---|
| `172.105.64.142` | `SHA256:gPo3YN+P9EUShH80R80nizQy6QFG0WtU75EFthvhydc` |
| `172.105.95.57` | `SHA256:2BgLKY4VmAFj0lpEr3EdD5Rtl1x/7fcJ6/F2j6/wVS8` |
| `172.104.240.217` | `SHA256:dXtbz59mA2TYzrC3Y7rVUJ4XlxQfD8z1mee07JvBVjY` |
| `172.104.253.247` | `SHA256:DSKpmtS0Iv5PJgqZbsuTndS9MPlazWdYMmtz2nbtcTk` |

Verify locally with `ssh-keygen -F HOST -f
/home/maximoto/.ssh/known_hosts`; never use `ssh-keyscan` as a trust anchor.
Every read-only connection must use this exact shape, one host and one literal
command at a time:

```bash
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=/tmp/plebeian-poc-owner-agent.sock \
  -o UserKnownHostsFile=/home/maximoto/.ssh/known_hosts \
  -o StrictHostKeyChecking=yes \
  -o ConnectTimeout=10 \
  -o ConnectionAttempts=1 \
  -i /home/maximoto/.ssh/id_ed25519 \
  root@HOST -- 'READ_ONLY_COMMAND'
```

Do not scan or replace host keys, copy the private key, forward the agent,
change `known_hosts`, guess another account, bypass a denial, or treat an SSH
error as path absence.

## Bounded read-only inventory

Inventory must discover, not assume:

- host identity, UTC time, OS, resources, routes, IPv6 posture and listeners;
- loaded and installed `plebeian*` unit names. Wednesday's validator is a
  template unit `plebeian-poc-validator@SLOT.service`, not an untemplated name;
- `FragmentPath`, drop-ins, dependencies, environment-file *paths* and service
  state, without printing environment values;
- the installed Python executable/version, the Nutshell/Cashu package source
  and version, mint unit, `mint.env` path, database/anchor paths and unit
  interpreter. Do not print seeds, proofs, database rows or environment values;
- nginx `listen`, `default_server`, `server_name`, include, location, rewrite
  and `proxy_pass` precedence;
- certificate SAN, issuer, fingerprint, public chain path and validity, never a
  TLS private key;
- complete provider-firewall attachments and rules for all four instances;
- present/absent/inaccessible status for every proposed Friday destination.

For destination paths, a failed `stat` is not absence. Confirm that the parent
directory is readable/searchable and that an exact non-glob `find` returns no
entry; otherwise record `ERROR_OR_INACCESSIBLE` and stop that path check.

Required destinations include:

```text
/opt/plebeian-auctions-friday/bin
/etc/plebeian-auctions-friday
/var/lib/plebeian-auctions-friday
/var/lib/plebeian-auctions-friday/network
/var/lib/plebeian-auctions-friday/frost
/var/lib/plebeian-auctions-friday/coordinator
/var/lib/plebeian-auctions-friday/mint
/var/lib/plebeian-auctions-friday/fips
/var/lib/plebeian-auctions-friday-anchor
```

The inventory is blocked if the agent, any host pin, current host identity,
provider firewall, destination classification, nginx precedence, certificate
identity or Wednesday baseline is unavailable.

## Proposed live mapping, pending inventory and approval

- V1 `172.105.64.142`: Friday FIPS, validator and signer only; preserve every
  Wednesday service and the Wednesday HTTPS origin.
- V2 `172.105.95.57`: Friday FIPS, validator, signer, mint, coordinator,
  authority, site and distinct HTTPS proxy.
- V3 `172.104.240.217`: Friday FIPS, validator and signer only.
- V4 `172.104.253.247`: Friday FIPS, validator and signer; designated bounded
  validator-unavailable test target only under a separate confirmation.
- Excluded: `192.46.234.233`, every production host, and all Wednesday paths,
  credentials, identities, state and services.

Proposed ports: FIPS UDP 32121; Comet P2P TCP 27656 over FIPS only; loopback
Comet RPC 27657; FIPS signer TCP 39101; FIPS mint TCP 3438; loopback site 8180;
loopback authority 8181; V2 public IPv4 HTTPS 443.

The V2 firewall proposal must preserve SSH TCP 22 only from
`71.234.107.170/32`, preserve Wednesday TCP 26656 only among the four validator
IPv4 `/32`s, add Friday UDP 32121 only among those four `/32`s, and add public
IPv4 TCP 443 only on V2. Inbound remains DROP and outbound ACCEPT. No IPv6
ingress and no public 80, 27656, 27657, 3438, 39101, 8180 or 8181. No provider
mutation is authorized by this document.

## Exact-current acceptance path

One retained, reviewed run must prove without certificate-warning bypass:

1. Nostr login and separate fake-money payment/refund keys;
2. actual Coco v2 fake-sat funding with valid NUT-12 DLEQ inputs;
3. exact bid preparation, browser authorization and authenticated Comet commit;
4. 3-of-4 BFT finality over jmcorgan/fips, distinct from 3-of-4 FROST signing;
5. higher bid, certified cooperative outbid return, mint completion, Coco import
   and acknowledgement;
6. anti-sniping extension from committed block time;
7. close, winner settlement, seller import and receipt;
8. reserve-unmet return;
9. validator-confirmed pre-admission FundingAbort cancellation and return;
10. one validator unavailable while 3-of-4 BFT continues;
11. a selected abort signer unavailable before selection still permits a
    healthy deterministic 3-of-4 subset; a selected signer lost after durable
    root claim fails closed and resumes only when that same signer returns;
12. browser reload, real IndexedDB recovery, NIP-07 discovery and once-only
    import/ack;
13. public refusal of every internal RPC, mint, signer, site and authority port;
14. recovery-only blocks every new mutation while a named retained operation
    still completes and imports exactly once;
15. cleanup proves only positively identified ephemeral objects were removed.

## Recovery-only rollback

Before funding, stop only Friday routes/units and leave Wednesday untouched.
After any funding or ambiguous operation, set
`POC_FRIDAY_RECOVERY_ONLY=true` in both the Friday site and authority
environments, validate the exact configs, and restart only those two Friday
units under a future exact action approval. The browser must report not ready;
new public mutations must return conflict/refusal; exact durable funding
status, FundingAbort, terminal read/import/ack and pre-issued seller-plan
recovery remain available. Keep the same V2 TLS origin, mint/keysets, state,
anchors and logs until all operations are terminal.

Never repoint Friday to Wednesday, start a replacement mint/keyset, delete
state/keys, rely on a UI flag alone, or retry an uncertain payment blindly.

## Remaining owner actions

After inventory and an independently reviewed rendered packet, owner approval
is still required for:

1. one exact-current bounded local privileged FIPS/HTTPS acceptance run;
2. V2-only firewall changes proven not to expose another node or create an
   unprotected interval;
3. a distinct V2 normally trusted certificate and its root-only key/renewal
   state. The V1 ACME approval does not cover V2;
4. generation and exact per-role placement of fresh fake-only FIPS, Comet,
   validator, FROST, signer, coordinator and mint identities;
5. staging the exact R10 bytes, create-once databases and independent anchors,
   then starting only the reviewed Friday units in dependency order;
6. the bounded V4-unavailable test, public route activation and any live
   recovery-only transition or rollback.

An interrupted, denied or uncertain action must be inspected before retry.

## Disclosed limitations

- FundingAbortV1 is validator-confirmed cooperative pre-admission cancellation;
  emergency unilateral timeout refund is not composed.
- Own raises remain disabled pending full-pool/stable-key continuity.
- A mint quote lost before a durable operation ID is known is not recovered.
- Invalid post-swap DLEQ from the controlled mint is preserved as an unavailable
  durable operation, not automatically compensated.
- Selected-signer loss after durable FROST root claim is fail-closed; no signer
  is substituted into that transcript.
- This is fake money, one operator, coordinator-trusted proof verification and
  jmcorgan/fips transport. It is not FIPS 140 compliance or real-value ready.

Historical note: a local loopback slice around 04:39 UTC created ephemeral
keys/listeners outside a later exact hold. Its evidence remains a scope
deviation, not authorization, trusted-HTTPS/FIPS evidence, or a basis to repeat
that run.
