# Friday R15 deployment handoff

Date: 2026-10-23 UTC. Status: **exact-current local artifacts built and
offline-tested; the separately approved per-host enrollment stage completed on
all four demo validators; live DKG rounds, Comet, FROST shares, Coco/browser
acceptance and application deployment remain NOT_RUN**.

## Frozen source and artifacts

- Artifact source commit: `15e108acede739312d90291e0dad4b963e6f9117`.
- Artifact source tree: `6b1b18a1b5e26b7ece4d61c9e04b3464fc40101a`.
- Artifact root: `live-bin-friday-candidate-r15/`.
- Receipt: `FRIDAY-CANDIDATE-R15-BUILD-RECEIPT.json`.
- Go main SHA-256: `b584511af77af566752ad21a9528ce36c1dd13dedcb3fe67e6ab45b7322a5280`.
- DKG deployment CLI SHA-256:
  `bf6d9d2db4a855014674668728c35b6b0c5754dab96cb7dab9b5b4c3f6fd413f`.
- Enrollment initializer SHA-256:
  `35f0ea080c3dd4bd73d614032da9d719ee3f2a651c0584cf58a1ece62649f6ad`.
- Browser bundle SHA-256:
  `4190fc9eb63da82cee393b70f5f92013fb9bdd0e23804be846a1c20ae8f18c3c`.

The Go binary embeds the source commit above with `vcs.modified=false`.
Unchanged authority/coordinator/terminal/signer/DKG relay/Rust/FIPS artifacts
are byte-identical carry-forwards enumerated in the receipt; they were not
silently rebuilt or renamed.

## R15 review correction and successor repairs

The R15 artifact receipt remains an immutable record of commit `15e108ac...`;
it is not silently updated by later source repairs. Independent review found
that three original readiness claims required correction:

- Successor repair source commit/tree:
  `467718fd15260a1684f94f3467ccf3746f30abbc` /
  `158e4f3a4846dd96bc32a0ff0a5e647f9d8ea1c4`.
- Local standalone deployment-tool build (not a release artifact): SHA-256
  `2846d65dc50112e607db917b2d08722505462555c15979527c054489066a1434`,
  size 98,550,909, mode 0755.

1. The R15 coordinator initializer did not yet have an atomic staging lock and
   authenticated crash recovery. Its manifest composer trusted self-embedded
   host-pin digests and returned stdout only. A successor source revision now
   uses an owned no-follow lock/staging tree, Linux no-replace promotion,
   dead-owner recovery, four externally supplied ordered pin digests, and
   a receipt-first/manifest-last recoverable pair. Composer repair commit
   `1531a5175df9af7b441f20dfa079e9407974515d` and standalone artifact SHA-256
   `3aebe6a07236fba1d6082812e2b4f8b91c78d9cf0b51331c012af64b0b5558f6`
   are frozen in the R16 review packet. They still require independent review
   before live use.
2. The browser acceptance runner is a fixture-tested **interface harness**.
   No concrete authenticated Comet adapter or host fault-control adapter
   constructs its consensus port, so it is not a live acceptance executable.
   The successor source exposes this status explicitly and does not claim that
   passing mocked ports proves the deployed journey.
3. `plebeian-auctions-poc render-friday-comet-authority` validates the
   authenticated DKG V2 result and external manifest pin, then renders the
   owner-signed Comet deployment anchor and FundingAbort bootstrap. It consumes
   an existing mode-0600 owner approval seed and separately approved controlled
   mint/keyset identity. Neither exists yet; the renderer does not create them.

The per-host enrollment initializer remains independently accepted and is the
only current create-once identity lane proposed for live execution.

The separately reviewed enrollment repair is integrated. Its compiled
standalone binary exercised the actual Bun FFI
`renameat2(RENAME_NOREPLACE)` path against harmless temporary directories:
the destination collision was preserved, the test root was removed, glibc
2.39 was observed and `renameat2@@GLIBC_2.28` is available. Source-only tests
are not being substituted for this compiled receipt.

## Actual local evidence

- Friday TypeScript typecheck: PASS.
- DKG/deployment diagnostic suite: 55/55 tests, 258 assertions.
- Browser/Coco suite: 51/51 tests, 201 assertions.
- Go `./...`: PASS on exact current source.
- Compiled enrollment no-replace FFI canary: PASS.
- `git diff --check`: PASS before this handoff was recorded.

An earlier sandbox run had one child-pipe `EPERM`; the exact current full DKG
suite subsequently passed 55/55 in the ordinary runner. Counts above are kept
separate and are not summed with overlapping focused suites.

On the post-R15 successor repair working tree, the coordinator/composer plus
browser-harness focused tests pass 9/9 with 24 assertions; Friday typecheck
passes; the browser suite passes 52/52 with 202 assertions. The expanded DKG
suite reports 55 passes plus the known sandbox child-pipe `EPERM`; its affected
relay file passes 8/8 with 27 assertions in the ordinary runner. These are
source-repair results, not R15 live evidence or a rebuilt deployment receipt.

## Live state and evidence boundary

The four demo hosts retain one host-local persistent FIPS identity apiece and
the reviewed, stopped mesh artifacts. The most recent bounded mesh campaign
shut every Friday FIPS service down in reverse order. Its strict historical
result remains 11/12 because one V3-to-V1 probe returned FIPS core status
`sub_millisecond`; this supports qualified authenticated reachability, not a
12/12 numeric-RTT pass and not application acceptance. No R15 application
binary, Comet validator, FROST share, mint or browser service has been started
remotely.

The enrollment-only action from commit `2cd3165d` completed once on every
validator under packet SHA-256
`6fc6053b857c56e9ab5fef513b8d6869e8c96ded57ce210cfd9f095f248427e6`.
Each host now has exactly one local DKG identity, encrypted-transport identity
and signer-RPC identity below its protected `keyset-v1` root. Private material
never left the host. The only exported artifacts are the four signed public
enrollments in `deploy/friday/dkg-enrollment-r15/`; their SHA-256 values are:

- participant 1: `6f40bb1694239278615941ee1ef0c9b1ea239180576b9cbb242aa52455081979`
- participant 2: `83f351b1b638aa29e931cbd1e40703885a72c46b080e41c02b58286a94efe513`
- participant 3: `ec93b3cb6a279b1a7b8713d0fa6c2deec2389088beec18b211c612a325253161`
- participant 4: `1bd6349411976adbc341dc67dcf03e76599ebf73f9d0182a145d73d0fe640e2e`

All four compiled no-replace FFI canaries and post-state checks passed. No
Friday listener or service remained, no `fips0` remained, and the observed
Wednesday PID/restart counters were unchanged. The first preflight correctly
refused before mutation because it compared provider host IDs with kernel
hostnames; the corrected binding used the previously authenticated public FIPS
receipt host ID and slot. No uncertain outcome or retry remains.

Wednesday services and data remain untouched. Fake sats only; no production,
FIPS 140 or real-value claim.

## Mandatory private-state separation

Every FIPS identity, Comet validator key, signer key and FROST share stays on
its final host. Each DKG pairwise AEAD key exists at exactly its two endpoints.
V2 is participant 2 and may hold only pairs `1-2`, `2-3` and `2-4`; it must
never receive `1-3`, `1-4` or `3-4`. The coordinator may handle public records
and recipient-specific ciphertext only. The owner rejected centralized
provisioning; it must not be reintroduced for expediency.

## Remaining blockers and honest limitations

- The enrollment-only create-once action is complete. No DKG round, pairwise
  transport export, FROST-share generation, Comet initialization, service start
  or public activation was included.
- The owner approval key and controlled fake-mint/keyset identity do not yet
  exist in the Friday deployment. The renderer intentionally consumes rather
  than creates them.
- The browser runner is bundled and fixture-tested, but a real multi-account
  NIP-07/IndexedDB/Coco session against authenticated Comet over FIPS is
  NOT_RUN. The concrete authenticated Comet and host fault-control acceptance
  adapters are still missing.
- The stopped FIPS mesh must be re-established under a separately approved
  bounded action before any four-host application acceptance.
- Own raises remain disabled. Emergency unilateral timeout refund remains
  disabled. Cooperative certified outbid return is the implemented path.
- One signer absent before subset selection is supported; losing a selected
  signer mid-session remains fail-stop until that signer returns.
- No public activation is authorized. Recovery-only routing must remain
  available for recorded operations if a later staged campaign is rolled back.

## Next literal sequence (not authorized by this handoff)

The combined identity packet remains blocked and superseded. The separate
enrollment-only stage is complete and does not authorize the next stage.

1. Independently review the R16 repaired coordinator/composer source, receipt
   and standalone artifact. It now preserves and exactly recovers an
   interrupted manifest/receipt pair; that claim is not yet independently
   accepted for live use.
2. Request a distinct V2 coordinator-identity and public-manifest composition
   action only after that artifact review.
3. Compose and owner-pin the public enrollment manifest;
   create the separately approved owner/mint/Comet identities; execute the
   recipient-specific encrypted DKG rounds; collect all four authenticated
   final attestations; verify the public package independently on every host.
4. Render the FundingAbort pins and owner-signed Comet anchor from those exact
   identities. Assemble/finalize the public genesis and require the launch
   seal before any validator loads private state.
5. Under a new bounded approval, start FIPS, validators, signers, controlled
   mint and the V2 application with public admission disabled. Run the exact
   browser acceptance journey and the stated signer/validator fault cases.
6. Review sanitized evidence and pending-operation recovery before requesting
   a separate public-activation approval.

On any unknown consensus, mint, DKG or identity outcome: preserve state,
inspect, and do not retry or regenerate. Absence, time and a coordinator-local
journal are never authority to refund or reuse proofs.
