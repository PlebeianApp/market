# Friday R13-to-successor DKG and activation sequence

Status: **documentation only; no command in this file is authorized for live
execution.** R13 remains preserved and must not be deployed because its signer
executable pin is incomplete. Source commit
`7bab6f32e7b6c5c2145bbd40b082c0775a30f396` repairs that issue, but a
fresh exact-current build receipt and independent review are still required.

This is the immediate path from inert artifact staging to one fake-funds live
acceptance run. It does not authorize a key, listener, route, unit, database,
certificate, firewall, or remote-file change.

## Evidence identities

- R13 artifact receipt: `FRIDAY-CANDIDATE-R13-BUILD-RECEIPT.json`, SHA-256
  `82951f4e854f2dc5a44f6c625facdc7b90d43334c979b2e3db6709a7a6dab7d6`.
- R13 next-action packet: `FRIDAY-R13-NEXT-ACTION.md`, SHA-256
  `f0b738e46f851999b685bc6ee4dcb54db0b133934fc2aeae125da5b6c898c862`.
- Executable-code commit/tree in that receipt:
  `9cacf094ea508316fe5f34b8847314413bfa9370` /
  `4b71d54c18de7721643f966cbc0809486974f6d0`.
- Artifact-source commit/tree:
  `3ca1b48e8db5a960d2def7e71ec15464042ab794` /
  `4f4eed13c0b243c02a32021d69afd77395fd9b60`.
- Receipt commit: `3f90d83282106c7969c0f0112697d0c52b2d54d7`.
- Next-action documentation commit: `e5ab19bf56c18a70a936f210705a2c279b8770b6`.
- R13 Go binary: SHA-256
  `5e318330a3c9f38b0f3a84214090cf4444240db7a9d887ef37a18debbb8f1bd8`.
  It embeds revision `3ca1b48e8db5a960d2def7e71ec15464042ab794`
  with `vcs.modified=false`.
- Successor signer-pin source commit/tree:
  `7bab6f32e7b6c5c2145bbd40b082c0775a30f396` /
  `b98d3b2e2acd01069eb3f603170bad9284bf4d18` (a new clean build/artifact
  hash is pending).

The Go revision is not a contradiction: `9cacf09` is the executable-code
snapshot; its descendant `3ca1b48` adds only the evidence record. The clean Go
build was made from that descendant, so Go truthfully embeds `3ca1b48` while
the receipt separately names the executable-code tree. The later receipt and
documentation commits do not alter that R13 binary. The signer repair at
`7bab6f32e7b6c5c2145bbd40b082c0775a30f396` does alter executable source and therefore requires a successor
binary/receipt; the R13 signer hash must not be reused.

## Fixed deployment identities and placeholders

| slot | host ID | underlay IPv4 | FIPS public npub | FIPS ULA |
|---:|---|---|---|---|
| 1 | `linode-108175009` | `172.105.64.142` | `%V1_FIPS_NPUB%` | `%V1_FIPS_ULA%` |
| 2 | `linode-108236985` | `172.105.95.57` | `%V2_FIPS_NPUB%` | `%V2_FIPS_ULA%` |
| 3 | `linode-108237290` | `172.104.240.217` | `%V3_FIPS_NPUB%` | `%V3_FIPS_ULA%` |
| 4 | `linode-108237424` | `172.104.253.247` | `%V4_FIPS_NPUB%` | `%V4_FIPS_ULA%` |

The four public FIPS fields remain placeholders until final-host-only identity
creation succeeds. Proposed immutable run values are:

- deployment: `friday-demo-20261023-r13`;
- application run: `friday-demo-20261023-r13-run1`;
- DKG run: `friday-demo-20261023-r13-dkg1`;
- FROST keyset: `friday-demo-frost-keyset-v1`, version `1`;
- state root: `/var/lib/plebeian-auctions-friday`;
- DKG root on every host:
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`;
- common public DKG result:
  `/var/lib/plebeian-auctions-friday/frost/public/dkg-result.json`;
- common public FROST package at each host:
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1/exchange/%DKG_RUN_ID%/participant-1.public.json`.

## Final-host private material

No private value crosses to an operator relay or another host except a
pairwise transport key encrypted/installed at its exact two endpoints.

| material | type | location/owner |
|---|---|---|
| FIPS identity | native jmcorgan/fips private key; public npub and derived ULA only leave host | `fips/identity/fips.key`, local service identity |
| DKG identity | secp256k1 Schnorr private key | `frost/keyset-v1/identity-signing-key.hex`, local service identity |
| DKG transport identity | X25519 private key | `frost/keyset-v1/kex-private-key.hex`, local service identity |
| signer RPC identity | secp256k1 Schnorr private key | `frost/keyset-v1/signer-rpc-identity.key`, local service identity |
| FROST participant state/share | Rust participant private state and nonce journal | `frost/keyset-v1/state`, local service identity |
| Comet node and validator | two Ed25519 private keys per host | that host's single-slot `network` tree |
| coordinator RPC identity | secp256k1 Schnorr private key | V2 only, `coordinator/coordinator-rpc-identity.key` |
| fake mint | Nutshell/FakeWallet mint key and DB | V2 only, Friday mint root |
| browser payment/refund | browser-local Coco/payment keys | browser private IndexedDB; never server provisioned |

Pairwise DKG transport material is endpoint-only:

- V1: pairs `1-2`, `1-3`, `1-4`;
- V2: pairs `1-2`, `2-3`, `2-4`;
- V3: pairs `1-3`, `2-3`, `3-4`;
- V4: pairs `1-4`, `2-4`, `3-4`.

V2 is participant 2 and may hold the three pairs containing participant 2. It
must never hold `1-3`, `1-4`, or `3-4`. The relay sees public records and
recipient-specific encrypted round-two envelopes only. The relay runtime must
run under an identity denied access to every participant-private root.

## Phase A: final successor staging and FIPS identity

Prerequisites:

1. Build the successor signer from a clean commit containing
   `7bab6f32e7b6c5c2145bbd40b082c0775a30f396`, record
   `vcs.modified=false` where applicable, rebuild all exact-current consumers,
   and issue a new artifact receipt. Do not mix R13 signer bytes with successor
   code.
2. Independently review the exact new receipt, signer pin, and the A3 atomic
   promotion helper. A3 owns the helper; it is deliberately not duplicated
   here.
3. Obtain a new action-time approval naming the final release hash, the four
   hosts, the exact helper hash/invocation, and the FIPS identity stage.

Then, and only then, per host:

1. Revalidate pinned SSH agent fingerprint and host key, boot ID, free space,
   Friday path absence/identity, Wednesday PID/restart count, UDP 32121
   listener absence, and `fips0` absence.
2. Install only receipt-pinned role artifacts into a new root-owned versioned
   release. Do not switch `/opt/plebeian-auctions-friday/bin` yet.
3. Use the reviewed promotion helper to take an exclusive root-controlled
   lock, run the pinned `fipsctl keygen -d` once as the local service identity
   under `umask 077`, validate key/public/address agreement, fsync, and
   no-replace-promote the same-filesystem staging directory to
   `fips/identity`.
4. Export only slot, host ID, public npub, ULA, and binary hashes. Preserve a
   failed private staging root for separately approved inspection; never
   retry/regenerate automatically.

The R13 `fipsctl` command exists and has receipt hash
`15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.
The safe promotion command does **not** exist in R13; this phase remains
blocked until A3's helper is reviewed and pinned.

## Phase B: per-host enrollment and owner-pinned DKG manifest

After the four public FIPS records exist, render four exact owner-reviewed host
pin files. Each binds slot, host ID, underlay, FIPS npub/ULA, deployment/run and
keyset identity, signer endpoint `http://[FIPS_ULA]:39101/v1/frost`, fixed
config/state paths, participant binary hash, and inspector hash.

On each final host, one approved command exists in the successor/R13 tool:

```text
plebeian-friday-dkg-enrollment-init init \
  --participant %SLOT% \
  --expected-host-pin-digest %HOST_PIN_SHA256%
```

It atomically creates only that host's DKG identity, X25519 identity, signer
identity, participant config/state root, and public
`exchange/%DKG_RUN_ID%/participant-%SLOT%.host-enrollment.json`. Its only
automatic recovery command is:

```text
plebeian-friday-dkg-enrollment-init recover \
  --participant %SLOT% \
  --expected-host-pin-digest %HOST_PIN_SHA256%
```

Recovery is allowed only when the recorded owner is dead and the complete
staged or final output authenticates exactly. Incomplete, anonymous, torn, or
conflicting state remains locked for manual inspection.

Publicly collect the four host-enrollment records. Render one strict
`PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_MANIFEST_V1` containing the four identities
plus the V2 coordinator public identity. The owner reviews and pins its exact
digest. Install identical `manifest.json` and
`owner-approved-manifest-digest.txt` on all four hosts before any DKG stage.

Two executable gaps block this phase today:

1. no release CLI composes the initial strict manifest from four host
   enrollments and a separately generated V2 coordinator public identity;
2. no release CLI creates the V2-only coordinator RPC private key atomically
   and emits only its Schnorr public identity. The rejected central DKG tool is
   not an acceptable substitute.

## Phase C: public/ciphertext-only 3-of-4 DKG

The host-stage command exists and is fixed:

```text
plebeian-friday-dkg-host %STAGE% --participant %SLOT% --run-id %DKG_RUN_ID%
```

The only stage order is:

1. `enroll` on all four; relay action `enrollment_bundle`; copy the identical
   public `enrollments.bundle.json` to all hosts.
2. `confirm-transport` on all four; relay action `route_confirmations`; give
   each host only its `participant-SLOT.peer-confirmations.bundle.json`.
3. `persist-transport` on all four. Each verifies confirmations and persists
   only its three endpoint pairwise keys in `transport-secrets.json`.
4. `round1` on all four; relay action `round1_bundle`; copy the identical
   public `round1.bundle.json` to all hosts.
5. `round1-agree` on all four; relay action `agreement_bundle`; copy the
   identical public `agreement.bundle.json` to all hosts.
6. `round2` on all four; invoke relay action `round2_bundle` separately for
   recipients 1, 2, 3, and 4. Each recipient gets only its exact encrypted
   `participant-SLOT.round2.bundle.json`; ciphertext is preserved byte-for-byte.
7. `finalize`, then `inspect`, then `attest` on all four. Collect only the four
   public final packages/inspections/attestations.
8. Relay action `compose_authenticated_result` validates the complete
   checkpoint, all four attestations, package/inspection equality and the
   externally pinned manifest digest. Install the exact authenticated V2 result
   and exact common public package on every host.

The relay is a bounded stdin/stdout JSON command; it has no URL or private-root
field. Its actions exist: `enrollment_bundle`, `route_confirmations`,
`round1_bundle`, `agreement_bundle`, `round2_bundle`, and
`compose_authenticated_result`. Exact transfer commands, destination modes,
hash receipts, and the external courier identity still require a reviewed
operator packet. The relay is context-validating but the recipient AEAD, not
the relay, authenticates each encrypted R2 sender.

If a host process dies with its ceremony lock, the only permitted command is:

```text
plebeian-friday-dkg-host recover-lock \
  --participant %SLOT% --run-id %DKG_RUN_ID%
```

It never reruns a Rust stage. It requires a dead exact owner plus a durable
journal and exact already-written evidence; otherwise the lock is preserved.

## Phase D: per-host Comet identities and public genesis

Before Comet key creation, a reviewed tool must render:

- an inert, create-once V2 fake mint database/keyset with NUT-12 valid DLEQ,
  zero fees, and no listener, plus its reviewed public keyset snapshot;
- the strict public `FundingAbortBootstrapV1` derived from the authenticated
  DKG result and the controlled fake mint's active NUT-12 keyset;
- one owner-signed deployment anchor binding chain/run, manifest digest,
  genesis time, final DKG-result hash, FundingAbort bootstrap hash, keyset,
  four host/FIPS/signer identities, and owner approval key.

The R13 Go binary verifies these inputs but does not create/sign either one.
That renderer/signing workflow is a remaining implementation gap.

Once the two public inputs are independently reviewed and approved, the Go
commands exist in this order:

```text
# Once on each host; creates only that host's node/validator keys.
plebeian-auctions-poc init-friday-comet-validator \
  --home /var/lib/plebeian-auctions-friday/network \
  --deployment-anchor %DEPLOYMENT_ANCHOR% \
  --owner-approval-public-key %OWNER_ED25519_PUBLIC_KEY% \
  --slot %SLOT%

# Once in a fresh public assembly root after collecting four public descriptors.
plebeian-auctions-poc assemble-friday-comet \
  --bundle %FRESH_PUBLIC_BUNDLE_ROOT% \
  --validator-public %V1_DESCRIPTOR% \
  --validator-public %V2_DESCRIPTOR% \
  --validator-public %V3_DESCRIPTOR% \
  --validator-public %V4_DESCRIPTOR% \
  --deployment-anchor %DEPLOYMENT_ANCHOR% \
  --frost-final-public %AUTHENTICATED_DKG_RESULT% \
  --funding-abort-bootstrap %FUNDING_ABORT_BOOTSTRAP% \
  --owner-approval-public-key %OWNER_ED25519_PUBLIC_KEY% \
  --test-mint-url %PRIVATE_FAKE_TEST_MINT_URL% \
  --cashu-mint-url https://172.105.95.57

# On each host after the public bundle hash is approved.
plebeian-auctions-poc finalize-friday-comet-validator \
  --home /var/lib/plebeian-auctions-friday/network \
  --bundle %PUBLIC_BUNDLE_ROOT% --slot %SLOT%

# Once after collecting all four exact final acknowledgements.
plebeian-auctions-poc seal-friday-comet-launch \
  --bundle %PUBLIC_BUNDLE_ROOT% \
  --validator-ack %V1_ACK% --validator-ack %V2_ACK% \
  --validator-ack %V3_ACK% --validator-ack %V4_ACK%

# On each host; installs the same four-ack launch seal.
plebeian-auctions-poc install-friday-comet-launch \
  --home /var/lib/plebeian-auctions-friday/network \
  --bundle %PUBLIC_BUNDLE_ROOT% --slot %SLOT%
```

`enable-funding-abort` is a legacy upgrade command and is not part of this
fresh V4 assembly; the V4 genesis is assembled with FundingAbort pins already
bound. Each direct `node` start requires the installed four-ack launch seal.

## Phase E: config, state, and services

Render identical deployment identity and public DKG/Comet facts on all hosts,
but only role-local private paths. Configuration/code are root-owned,
non-symlink paths. Service state is owned only by `plebeian-friday`. Wednesday
roots, units, ports, certificates, databases, and listeners remain untouched.

Network/listener contract:

| process | bind | exposure |
|---|---|---|
| FIPS | UDP `32121` on each underlay | provider-restricted to four IPv4 peers |
| Comet P2P | TCP `27656` on each FIPS ULA | FIPS mesh only |
| Comet RPC | `127.0.0.1:27657` | loopback only |
| signer RPC | TCP `39101` on each FIPS ULA | FIPS mesh only |
| fake mint | TCP `3438` on V2 FIPS ULA | FIPS mesh; public via V2 HTTPS proxy only |
| authority | `127.0.0.1:8181` on V2 | loopback only |
| site | `127.0.0.1:8180` on V2 | loopback only |
| nginx | IPv4 `172.105.95.57:443` | public trusted TLS |

There is no public 80, 27656, 27657, 3438, 39101, 8180, or 8181 listener and
no public IPv6 allowance.

Create-once V2 initialization, after every identity/config hash is approved:

1. revalidate the already initialized, still-inert fake mint keyset bound into
   the Comet genesis; start it only after the FIPS route is ready, and perform
   the real-output canary before public funding;
2. initialize coordinator operations plus independent rollback anchor using
   `plebeian-friday-coordinator init-anchor --application ... --database ...
   --rollback-anchor-database ...`;
3. initialize authority/replay/abort/seller anchors using
   `plebeian-friday-authority init-state --application ...`;
4. initialize the exact seller plan using
   `plebeian-friday-authority init-seller-plan --application ...`;
5. prove the distinct Friday origin/database has zero pre-Friday operations.

Start canaries are bounded and serial: FIPS on four hosts; prove exact ULA and
UDP traversal; validators and 3-of-4 finality; signers and authenticated
enrollment; V2 mint; coordinator; authority; site; nginx last. Public funding
stays disabled until the entire private composition passes.

## Phase F: one exact acceptance run

No current R13 executable drives this exact four-host/browser/FIPS path. A
reviewed current-artifact operator driver or an exact manual evidence packet is
still required. It must execute and retain evidence for this single journey:

1. trusted-HTTPS load and NIP-07 sign-in;
2. actual Coco v2 fake-sat funding and balance/proof identity;
3. exact bid admission committed by 3-of-4 Comet BFT over FIPS;
4. higher competing bid, certified displacement, 3-of-4 FROST plus bidder
   authorization, and verified cooperative refund import into the displaced
   Coco wallet (prompt after consensus/mint completion, not zero-latency);
5. exact anti-sniping extension: 180-second increments, 1,800-second cap;
6. permissionless deterministic close only after consensus deadline;
7. winner payout, Coco import and signed terminal receipt;
8. repeat the required availability check with one validator absent before
   selection; verify 3-of-4 BFT and 3-of-4 FROST are distinct claims;
9. stop one selected FundingAbort signer mid-session and prove fail-stop, then
   resume only when that same signer returns;
10. verify conservation, NUT-07 spent/unspent state, zero fees, exact balances,
    no duplicate terminal effect, restart recovery, and all listener/process
    cleanup identities.

Browser reload with real IndexedDB/NIP-07 discovery/import, live FIPS, live
Comet, live Rust FROST, and exact-current Coco/mint acceptance remain NOT_RUN.

## Rollback boundaries

- Before public admission and before any accepted/unknown operation: stop only
  Friday units in reverse dependency order, keep the distinct Friday origin
  disabled, and retain all create-once identities/state for review.
- After any accepted or unknown operation: do not delete, reset, repoint to
  Wednesday, or disable the Friday mint/recovery dependencies. Switch to the
  reviewed recovery-only mode: reject new funding, bidding, close, faucet, and
  issuance while preserving exact broadcast recovery, FundingAbort, terminal
  settlement/import, seller recovery and acknowledgements until every retained
  operation is terminal.
- Identity mismatch, ambiguous process ownership, torn journal, stale anchor,
  or uncertain external effect: quarantine and inspect; never retry blindly.

Own raises and emergency unilateral timeout refunds remain disabled. A signer
lost after a FundingAbort subset is claimed remains fail-stop until that same
signer returns. This is fake money only and is not a FIPS 140 claim.

## Immediate blockers before the next live approval

1. independent review and clean artifact rebuild for signer-pin commit
   `7bab6f32e7b6c5c2145bbd40b082c0775a30f396`;
2. reviewed A3 no-replace FIPS identity promotion helper and exact invocation;
3. final-host-only V2 coordinator identity initializer;
4. strict initial DKG manifest composer from four public host enrollments;
5. owner-signed Comet deployment-anchor renderer/signing workflow and strict
   FundingAbort bootstrap renderer;
6. exact public/ciphertext courier packet with file hashes/modes and no access
   to private roots;
7. exact-current four-host/browser acceptance driver or equivalently strict
   manual evidence packet.

Until these are implemented, reviewed, rebuilt and separately approved, the
R13 binaries are useful evidence but not an executable deployment packet.
