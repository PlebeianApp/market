# Separated application source preparation

INERT TEMPLATES. No installation, activation, operational keys, DKG, full build,
HTTPS or live payment acceptance occurred in this work. The exact public site
and canonical fake mint origin is `https://139.162.161.233`. Existing compiled
browser assets are predecessor bytes: a newly approved B1 must rebuild the
browser twice; newly accepted B2 artifacts must embed that bundle. Old source741
receipts and its unused B1 approval cannot transfer to this source.

Five hosts/Comet replicas, exactly four voters and FROST participants. V1–V4
hold only their own fresh FIPS, Comet, DKG/signer/KEX identities, shares, nonces
and journals. The application host has a FIPS identity, a distinct non-voting
P2P transport key, app requester identity, isolated FakeWallet mint key and
application records. It has no participant config/state, FROST share/nonces or
validator signing key. Logical DKG relay participant1 is an existing protocol
field, not a share or vote. Each signer still checks its own validated chain.

The app observer replays the actual threshold ABCI application from genesis.
It uses the pinned Comet implementation, four exact node-ID/FIPS peers, loopback
RPC127.0.0.1:27657, no state-sync snapshot and the kv transaction index. Its
public-only nonmember PrivValidator adapter refuses all signing methods. A
compromised app can falsify display or deny service, but its assertions do not
supply committee signatures. FakeWallet is a trusted worthless-token issuer;
this is not a production custody claim.

## Future ordered actions — separate operational authorization required

1. Independently review this frozen source and resulting build artifacts.
   Preserve all old stores and consumed attempts. Obtain real four-host
   rebuild/abandonment/empty-state records and inventory the preserved app disk.
   Never fabricate predecessor abort acknowledgements or private-root seals.
2. Provision five fresh FIPS identities using the existing approved host-key
   procedure. Render role-specific JSON/environment and four-peer FIPS config
   from exact owner pins. Transport and app-only fake mint can be staged before
   completed runtime pins; all other services reject missing pins/placeholders.
   No discovery, public raw RPC or arbitrary signing proxy is introduced.
3. On each validator, obtain an owner-signed PRE_ENROLLMENT permit. The existing
   enrollment executable accepts `separated-init --participant N
   --expected-permit-digest DIGEST` at fixed frost-v3/keyset-v3. Explicit recovery
   is separate; no automatic cleanup. Never enroll a participant on the app.
4. The app-only `plebeian-friday-dkg-deployment separated-init-coordinator`
   reuses the durable requester identity engine at coordinator-v3/runtime. It generates
   no FROST share. This operation has NOT been invoked locally.
5. Independently inspect four public host enrollments and the app requester;
   construct and owner-sign the strict PRE_DKG bootstrap. The canonical public
   message/digest APIs in demo-friday-separated-deployment.ts and Go agree.
   Pin owner public key and full-packet digest in immutable environment input.
   Bootstrap is not proof of completed DKG or genesis. Its provider evidence
   hashes are owner-reviewed declarations, not local provider API verification.
6. Install public bootstrap and predecessor manifest at fixed /etc paths.
   `plebeian-friday-r20-host separated-manifest --participant N
   --expected-bootstrap-digest DIGEST`, then `separated-stage STAGE --participant
   N --expected-bootstrap-digest DIGEST` reuse existing durable host engines.
   Relay only public/ciphertext JSON through plebeian-friday-separated-relay;
   recipients authenticate/decrypt locally. Retain each reviewed request/output
   and digest outside share roots. There is no unattended courier/retry. Final
   composition produces the completed verified separated runtime binding.
7. Complete actual zero-fee FakeWallet mint conformance and review mint public
   identity, denominations, active keyset and DKG/runtime results. The owner
   renderer requires --separated-bootstrap, --separated-runtime-binding,
   --predecessor-manifest, --expected-separated-bootstrap-digest,
   --expected-separated-runtime-digest, --mint-conformance-receipt and
   --mint-conformance-receipt-sha256, alongside existing exact inputs. Final
   owner anchor follows completed DKG AND mint results, BEFORE Comet init/genesis.
8. Reuse validator init, descriptor assembly, finalization and exact four-ack
   launch seal. Assembly receives the separated runtime and exact mint origin.
   Slot checks remain1..4. Transfer only explicit public bundle files to app.
9. App initialization is `plebeian-auctions-poc init-observer --home ROOT
   --bundle PUBLIC_BUNDLE --expected-bundle-digest DIGEST
   --owner-approval-public-key PUB --fips-p2p-listen tcp://[APP_ULA]:27656`.
   Independently pin observer receipt SHA and node ID. Seal public network
   files root-owned with service-group read access; only network-separated/
   observer remains service-writable. App keyset-v3 contains only its exact
   authenticated public package under exchange, never participant private files.
10. Install exact role units. Render signer_dropin() from the target guard into
    root-owned0644 20-separated-state.conf: only keyset-v3 plus that slot's
    separated/node-N. No broad writable parent. Code/config/ancestors must be
    immutable, root-owned and nonsymlink. Existing FIPS preflight reads private
    metadata only. Mint auth DB stays beneath its own writable mint root.
11. After capacity checks and explicit service approval, launch observer using
    --expected-observer-receipt-sha256, never node--slot5. Its startup is not
    readiness. Initialize new anchors using existing reviewed procedures; no
    migration, reset/rebase or clearing unknown pending. Begin browser-ready=
    false and close-trigger=false. Actual FIPS transport, catch-up, advancing
    H/H+1 linkage, tx index/recovery, three signed current signer health replies
    and exact mint evidence must pass before new operations become ready.
12. Install trusted IP HTTPS only after separate certificate/firewall approval.
    Nginx exposes site, allowlisted authority and fake mint, never RPC/signers.
    Rehearse five separate Chiefmonkey/Bekka/Maxime/Hezron/Maximoto Nostr/Coco
    identities: create→fund→bid→outbid refund→anti-snipe→close→settle/import.
    Require actual balances/receipts plus failed/repeated requests; no hardcoded
    status. Public activation and invitations are separate authority.

## Resource and stop gates

Additional full observer replay/state/WAL/blocks/tx-index growth and peak RAM
are UNMEASURED. Proposed observer ceiling1024MiB; aggregate slice cap3072MiB,
MemoryHigh2304MiB on nominal4GiB app host. These fail-stop limits do not prove
fit. No new pruning or state deletion is enabled.

Before actual startup, record free bytes/inodes. Reserve at least4GiB free for
rehearsal (2GiB observer plus2GiB mint/app headroom); measure per-height growth,
peak RSS and cgroup pressure over intended demo duration. Stop new admissions
below2GiB free or100,000 free inodes, on OOM, stalled/catching-up observer,
pin drift or durable uncertainty. Operator checks are mandatory before activation
and during rehearsal; no new daemon/timer is introduced. Use existing recovery-
only controls, preserve state and require reconciliation; never delete a DB/WAL
to resume. Bounded service shutdown/log namespace do not bound chain disk growth.

Units bound memory/tasks and rate-limit a distinct journal namespace. The journal
example caps persistent128MiB/runtime32MiB, retention2days. Reuse nginx resource
limits with distinct log paths. Actual host support/capacity and log enforcement
are unrun. Native HTTP, full observer start/catch-up and real browsers remain
NOT_RUN. Existing relay oversized child-stdin test hit executor EPERM; its failure
is preserved and unresolved, never relabeled pass or retried here.

## R3 account and ownership contract — installation still separately gated

On APP, use three distinct non-root accounts: `plebeian-friday-site` for the
site/API, `plebeian-friday-mint` for Nutshell, and `plebeian-friday` for the
payment-core authority, coordinator worker and executor child. The last three
intentionally share requester identity, SQLite and anchors; splitting them would
require a new IPC contract. FIPS and observer retain the core account in this
bounded revision. This does not claim isolation between payment-core and those
two processes. Validators need only the core account, never site/mint accounts.
No accounts or permissions have been installed by this source preparation.

Every separated unit uses primary group `plebeian-friday-public`. Root-owned
public inputs must be readable via this group: files0640, directories0750 or0755,
with no group/world write and no symlinks. Existing Go/TS exact effective-GID pin
checks are preserved. This public group grants no access to private directories
or files, which remain0700/0600. The guard rejects missing accounts, root IDs,
APP UID aliases and a unit running under the wrong effective UID/GID.

| Path beneath /var/lib/plebeian-auctions-friday | Owner / mode |
| --- | --- |
| shared root, network-separated, separated, separated-inputs | root;0750/0755, public group |
| network-separated public bundle/receipt files | root;0640, public group |
| mint | mint account;0700; mint descendants0600/0700 |
| coordinator-v3 | core;0700; dedicated private init/recovery parent |
| coordinator-v3/runtime | core;0700; requester files0600, DB state private |
| network-separated/observer | core;0700; app observer transport/state private |
| network-separated/validator-N | core;0700; only the local validator slot |
| frost-v3 and frost-v3/keyset-v3 on validators | core;0700; enrollment/shares private |
| frost-v3 and public-only keyset-v3 on APP | root;0750/0755; only authenticated public exchange files |
| separated/node-N | core;0700; signer auxiliary journals |
| fips and fips/identity | core;0700; existing FIPS metadata checks still apply |

The independent `/var/lib/plebeian-auctions-friday-anchor-separated` root is
core-owned0700, with private0600 stores. `/etc/plebeian-auctions-friday/mint.env`
is root-owned0600: systemd loads it only for the mint; the preflight checks its
metadata without reading its secret contents. The site has no writable state
mount. Mint mounts only its own state root. Core units mount runtime plus anchors,
not the shared parent. Requester initialization/recovery runs as core, stages
and locks inside the private `coordinator-v3` parent, and atomically promotes
`runtime`; it must never use the root-owned public shared parent as a lock area.

Before any real initialization, provision the dedicated empty private parent
with exact UID/GID/mode, leaving runtime absent. After the existing Comet init
procedure, seal only public inputs/ancestors root-owned and public-group-readable;
leave observer/validator private leaves core-owned0700. Never recursively chown
or broaden a public tree to satisfy startup checks. Do not change existing state
without its separately reviewed recovery procedure.

Render both `signer_dropin()` and `validator_dropin()` from the fixed guard for
that validator's application JSON. Install them as root-owned0644 exact
`20-separated-state.conf` drop-ins for their respective services. Validator
base units intentionally grant no public-parent writable mount; its checked
slot drop-in grants only `network-separated/validator-N`. Signer grants only
keyset-v3 and the matching auxiliary node-N. Incorrect/missing drop-ins reject
startup. No new installer or account-management framework is introduced.

Local fixtures exercise real path traversal/modes with synthetic UID metadata
and a POSIX permission model. They do not prove kernel cross-UID denial or
systemd namespace behavior. Installed account/group/mode canaries, service
startup, recovery with real operational stores and observer catch-up remain
mandatory runtime gates before activation.
