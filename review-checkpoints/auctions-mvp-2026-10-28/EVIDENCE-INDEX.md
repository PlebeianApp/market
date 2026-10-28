# Sanitized evidence index

Date: 2026-10-28 UTC
Publication state: **DRAFT — NOT PUBLISHED**

This index intentionally omits private filesystem paths, host addresses, operator identities, key material, raw service output and raw logs. It records only public-safe artifact names, full hashes, commit identities, timestamps and claim boundaries.

## Classification

- `PUBLISHED_BASELINE`: already present in the public ngit checkpoint branch.
- `PINNED_LOCAL`: exact local bytes are identified by a full SHA-256, but are not published.
- `CONTENT_PINNED_UNCOMMITTED`: listed source files matched a local content manifest, but no immutable candidate commit exists.
- `NONFROZEN_RUNTIME_OBSERVATION`: read-only evidence from an active system; it may be superseded by later observations.
- `OWNER_SUPPLIED_EXTERNAL_REVIEW`: attributable owner-supplied review report, without independent recomputation by its reviewer.

## Baseline identity

| ID | Classification | Identity | Claim boundary |
|---|---|---|---|
| BASE-1 | `PUBLISHED_BASELINE` | commit `6c022a72e07ae077a70a7e6945184410ff8a7d22`; tree `ab71296fb8953c2e6ed9ad884817c90c5f027671`; 2026-10-19T16:47:33Z | Last published checkpoint; historical blocked evidence, not a runnable release |

## R20 source and review evidence

| ID | Classification | Artifact | SHA-256 / source identity | Claim boundary |
|---|---|---|---|---|
| R20-1 | `PINNED_LOCAL` | `FRIDAY-R20-WEDNESDAY-SHELL-CORE-R4-FILE-MANIFEST-20261028.json` | `6203a751a5ced36f9a978eab71f3906b6f03a402e848dad5766d78b5f6b7af76` | Pins 26 after-images over base commit `ee6172d50fa73b1eb2f8ac37633d595b51a0bf93`; not a commit or build |
| R20-2 | `PINNED_LOCAL` | R2-to-R4 source diff | `0ae452cbcfe14f8b0ba8db8082735e0c35a8939df9cafc0b35c6fd53217ce1ed` | Same 26 paths as the manifest |
| R20-3 | `PINNED_LOCAL` | `FRIDAY-R20-WEDNESDAY-SHELL-CORE-R4-TEST-RECEIPT-20261028.json` | `cb894d9509a4ce2d906e9dbd2dde81496a9ee539995ad2365fd2cba002e3e623` | Focused/local tests only; file recorded 2026-10-28T05:13:42Z; B1/B2 and live actions excluded |
| R20-4 | `PINNED_LOCAL` | `FRIDAY-R20-WEDNESDAY-SHELL-CORE-R4-INDEPENDENT-REVIEW-20261028.json` | `fef8891f11316f3183cc310e949d37819dc53420c292a4e909a3f656a4e6f46f` | Same-environment non-builder review; file recorded 2026-10-28T05:16:56Z; runtime gates remain |
| R20-5 | `PINNED_LOCAL` | `FRIDAY-R20-WEDNESDAY-SHELL-B1-R5-CLAUDE-A0-REVIEW-PACKET-20261028.json` | `d20774a6c9a12bb9ce4a95253ec9912c6882b546186da25d48488a9af1dd217e` | Packet submitted for review, not the external review response |
| R20-6 | `OWNER_SUPPLIED_EXTERNAL_REVIEW` | owner-supplied Claude report plus `CLAUDE-REVIEW-ATTESTATION.md` | source report `a818db4878a318215f070687873b6e7aff9d15d7e2545ec40c46f82815c2660a`, 9,917 bytes; verdict `ACCEPT_SOURCE_AND_B1_PREPARATION` | Claude states all hashes were operator-reported, computed none, ran no tests and touched no server; attributable review only |
| R20-7 | `PINNED_LOCAL` | `FRIDAY-R20-B1-BROWSER-BUNDLE-CONTROLLER-R5-20261028.py` | `7ea79b7fc44642e85348e1e9f36b022cdf92ffe6b223dfa2b07052dc220f63ae` | Controller source only; no B1 run |
| R20-8 | `PINNED_LOCAL` | `FRIDAY-R20-B1-BROWSER-BUNDLE-CONTROLLER-R5-TEST-20261028.py` | `d2bdba80a5fedba57e2c808e1b264f816b29d74e06aec29bc778ef8b6a50dded` | Static/mocked controller tests only |
| R20-9 | `PINNED_LOCAL` | `FRIDAY-R20-B1-BUNDLE-ACTION-R6-PENDING-20261028.json` | `e9b9380bcc9adee3f881d46a8c819191288ff997835c4766e9ee740d66a77baf` | Preparation-only, non-executable record; B1 `NOT_RUN` |
| R20-10 | `PINNED_LOCAL` | `FRIDAY-R20-B2-R5-FULL-BUILD-PLAN-PENDING-20261028.json` | `d74716ef8e3310ffd84a292be37446916d9395047ccf9e7cd5fb6e34b5752a28` | Plan only; B1 receipt/candidate inputs absent; B2 `NOT_RUN` |

### R20 test-output hashes

These hashes come from R20-3. Paths to the private local evidence store are deliberately omitted.

| Suite | Result | Output SHA-256 |
|---|---|---|
| Node UI helpers | `PASS 7/7` | `d6816ac781b0ef0eb1790d586c935dc1b07963d2c0024a17b2cf542deb3ce526` |
| Friday TypeScript typecheck | `PASS` | `a8597896bf2c5398b386d36fa26f5f877206f553effcddad91ff7ea3f6f3218d` |
| Friday browser | `PASS 72/72` | `8077381c9526a1b40ae9663da463884c0365cd0a7b1bb9bbe378686d188109a1` |
| Friday R20 | `PASS 56`, `SKIP 1` root-only case | `7908b5baf97c9f654916298aef35c9b46d324658760a02944689fa6ee099aa06` |
| Focused verbose Go R20 | `PASS` | `ae733da10782233bcbe557096dd75482286ac70fbb301397145c6492d4a531bc` |
| Deployment regression | `PASS 10/10` | `44218f34457d1d6eb3c57fd87a89230ff13cb2eafc252f9dd1236cbac159b5ab` |
| B1 controller mocked/static | `PASS 17/17` | `306130911b10f50c157bdda83c7d51f0739150b80f957cbb624ad883cde6db20` |

## Historical R8 evidence

| ID | Classification | Artifact | SHA-256 / source identity | Claim boundary |
|---|---|---|---|---|
| R8-1 | `PINNED_LOCAL` | `FRIDAY-CANDIDATE-R8-BUILD-RECEIPT.json` | file `c49b103be1d83569e478b3e73f07fd88f11c595c0a8433ade947edd9f5ef2c56`; source commit `0a6796dba29454b0f2657e932cd3a59a80df0943` | Offline build/regression for older source; exact-current privileged FIPS integration, trusted browser/Coco journey and deployment were `NOT_RUN` |

## Separate Wednesday UI/funding candidate

| ID | Classification | Artifact | SHA-256 / source identity | Claim boundary |
|---|---|---|---|---|
| UI-1 | `CONTENT_PINNED_UNCOMMITTED` | sanitized reading of `candidate-content-manifest.txt` | file `ead49ca102ba150bdeded90f0fd503ab79c88b38dffe7c564d97ea2722a09052`; base commit `b6d3604e58d4f9adb58bebd039f3818e27079f66` | 13 candidate source paths matched the manifest when rechecked on 2026-10-28; no immutable candidate commit |
| UI-2 | `PINNED_LOCAL` | `immutable-candidate-proposal.md` | `79f71a6e64ac92f01415da09251306934a3a2556ad748ae1f83706739031eeb7` | Proposal only; no commit, build publication, service restart or deployment |
| UI-3 | `PINNED_LOCAL` | `public-health-checkpoint-2026-10-28T1220Z.md` | `8af3f065a3af7db74aca3efb1c451cc51b73c3cd6adbe08e8ce6917eab9c7792` | Read-only public observation that deployed assets were the legacy baseline, not this candidate |

The original UI manifest contains local paths and public-infrastructure details and must not be published verbatim. This sanitized index is the publication-safe substitute.

## Current Wednesday consensus observations

These are nonfrozen read-only snapshots from an active system. They record state at the stated times and do not predict later state.

| ID | Classification | Artifact | SHA-256 | Observation and boundary |
|---|---|---|---|---|
| RUN-1 | `NONFROZEN_RUNTIME_OBSERVATION` | `wednesday-v1-v3-v4-consensus-diagnostic-20261028.json` | `49c27aaa0ad684c8407a270ed481ca9c4224096eea8d0eee83435413e8c79452` | 2026-10-28T13:52:07Z; three peers each; common last committed height 513632; divergent consensus steps; no mutation |
| RUN-2 | `NONFROZEN_RUNTIME_OBSERVATION` | `wednesday-v1-v3-v4-consensus-diagnostic-interpretation-20261028.json` | `a146d631089c9bca0bd61d4d15348314b85fa9bd3aa22acd2d03f8a1341d5fbd` | Interprets RUN-1 as a peer-connected consensus stall; cause not established |
| RUN-3 | `NONFROZEN_RUNTIME_OBSERVATION` | `wednesday-v2-current-consensus-diagnostic-20261028.json` | `d239a690406e3f7cf5b4ef0ed35433f3f294cb5e67daa5925f7ebaf7c31e9bc4` | 2026-10-28T13:59:27Z; three peers; height 509020; commit step; no mutation |

No restart had occurred as of 2026-10-28T14:30:00Z. A running service, peer count or `catching_up=false` does not establish consensus health.

## Evidence intentionally excluded

- private keys, seeds, credentials, SSH identities and operator fingerprints;
- private filesystem paths and host addresses;
- raw service logs or unbounded diagnostics;
- frozen artifacts from earlier checkpoints that have not changed;
- generated bundles or B1/B2 receipts, because none exist for the exact-current R5 source;
- screenshots, because they are not needed to support this textual checkpoint;
- any claim of real-sat behavior, because real funds remain out of scope.
