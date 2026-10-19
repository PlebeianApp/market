# Provenance index

Date verified locally: 2026-10-19 UTC  
Evidence snapshot: 2026-10-19T16:17:05Z  
Scope: documentation inputs only

This index uses logical lane-relative paths. The referenced evidence is not bundled in this docs-only directory unless explicitly marked `included`. No personal machine path is part of the public checkpoint.

## Authority and normative architecture

| Logical source path | SHA-256 | Status in this checkpoint |
|---|---|---|
| `authority/Plebeian-Apps-LLM-Team-Constitution-v1.1.txt` | `6b653a8834776b820ba36737c5af0fef55951ae279baff96cae948a6d541ed62` | Verified control authority; not bundled |
| `ADR-001-INDEPENDENT-FIPS-AUCTIONS.md` | `ed2c54ba0f44c08d645db8531ed68ab86466825d7e787cd3fec4a8b0fe486437` | Included verbatim; accepted architecture |

The included ADR retains its original `ADR-001` number. It has not been rewritten, summarized in place, or promoted to implementation evidence.

## Payment/FROST lane

| Logical source path | SHA-256 | Meaning |
|---|---|---|
| `payment/evidence/A1-R3-CANDIDATE-SEAL.sha256` | `0ee8df48992dacf8b67cf7955986c9aa2342d913775eeee3d1bb870071956b42` | Hash of the frozen R3 seal file |
| `payment/evidence/R3-POST-EDIT-SOURCE-MANIFEST.sha256` | `5770431449dee667a327275b11ef608fc18e4de42d106647003e830eb6d89fe6` | R3 post-edit source manifest identity recorded by the contract |
| `payment/evidence/A1-R4-PAYMENT-V2-INTEGRATION-CONTRACT.md` | `c219465cb57f12d592b01957e48fac9c9bcaf11a8f7d1b195a47606c6c22763a` | R4 base contract |
| `payment/evidence/A1-R4.1-PAYMENT-V2-RECONCILIATION-CONTRACT.md` | `b5f64918ab91ee128c1891f9576824f6e68bd8bcf53c8489a904789221f2aa06` | Narrow R4.1 successor |
| `payment/evidence/A1-R4.2-PAYMENT-V2-RECONCILIATION-CONTRACT.md` | `e5eee4b0deae9fbcf38e128fe71c221d1c5b061a1cb528ff5e8f069cdfc47019` | Narrow R4.2 successor |
| `payment/evidence/A1-R4.3-PAYMENT-V2-RECONCILIATION-CONTRACT.md` | `b939b5cac0970bfe78d5b41d732b571b318726d044c5b6115fb9c5f5dccfb628` | Accepted delta-only editorial successor; implementation acceptance is separate |
| `payment/evidence/A1-R4.3-ONE-LINE-SEMANTIC.diff` | `f0b0cec5b97451d65a09948d5fc82bb2e6a49303a61310d16efdbec3a48146e0` | Exact R4.3 “six” to “five” correction |
| `payment/evidence/A1-R4.3-IMPLEMENTATION-SEAL.sha256` | `5fadc2dead74655c6c0dc7c34e66b28243d4dea073941600fc7251397a014a07` | Frozen initial implementation; historical WIP, independently `BLOCKED` |
| `payment/evidence/R4.3-POST-EDIT-SOURCE-MANIFEST.sha256` | `25df4b28e5dccca910b8d82e95e60920b1fc5c29c083840dc975d7d6403b7a1c` | Builder-sealed 934-path post-edit source manifest |
| `payment/evidence/A1-R4.3-INDEPENDENT-REVIEW-PACKET.md` | `7274975750340b12ba5572132e75beace552c6d2e5481874eb0e41a34d413537` | Builder-authored packet for independent review; not acceptance |
| `payment/evidence/R4.3-OFFLINE-VALIDATION-COMMANDS.md` | `85017b79bdf706e2fd038d0933f25d1366fa363d1a4aa7f2834de41e15ada0ac` | Builder command/result record; not independent evidence |

R4.3 does not stand alone. Reviewers must read it with R4.2, R4.1, and R4 in that precedence order. Independent A2/A3 review blocked the initial implementation; it may be retained only as historical WIP while a successor repair is active. Do not snapshot the changing repair worktree.

## FIPS/UI lane

| Logical source path | SHA-256 | Meaning |
|---|---|---|
| `fips-ui/seals/A1-CANDIDATE-R5-SEAL.sha256` | `b5ce96136c7db50aec4f59a656e90a09aa130bbfd2d31fceaf71d60ecb9a615e` | Hash of the frozen R5 seal file |
| `fips-ui/review/A1-AUTHENTICATED-INGRESS-R5-REVIEW-PACKET.md` | `03a2e06c5dbce3d9cd2aeccef71a5974aad8c36a7b4b84e5afa531fd2e532b71` | R5 ingress review packet |
| `fips-ui/review/A1-R5-PAYMENT-V2-CONSUMPTION-WORK-PACKET.md` | `6f6d53990f6bf61cc3aa95d703b4c304f60e26f0211248eba23eb6abf09faa7e` | Planning-only consumption/wiring packet |
| `fips-ui/seals/A1-R5-PHASE1-PAYMENT-V2-CONSUMPTION.seal` | `74d7af45d18c7aeb76ed7e1fd55f4080a17588d48c24faf7ce94968d03fafb58` | Frozen Phase 1 historical WIP; independent review `BLOCKED` |
| `fips-ui/handoffs/A1-R5-PHASE1-SOURCE-DELTA-20261019.tar` | `5a7eae6e455c0a81d2a2026caa13aab9ba424967ae508075dfe0ce185465bb69` | Immutable six-file source delta |
| `fips-ui/review/A1-R5-PHASE1-PAYMENT-V2-CONSUMPTION-REVIEW-PACKET.md` | `deaf6fd1fa34418e86746823552743bb69fa71ae4044b66f8e5731f5eaffcd1d` | Builder review packet; not independent acceptance |

The R5 Phase 1 successor proves a named frozen builder candidate/evidence set only. Independent review blocked that implementation for decoder, mint-origin parity, committee-context, and verifier-placement findings. It does not prove FIPS runtime, validator fleet, storage runtime, payment runtime, or production wiring. The active repair worktree is excluded.

## Storage V2 lane

| Logical source path | SHA-256 | Meaning |
|---|---|---|
| `storage/STORAGE-V2-WORK-ORDER-S-A1-RECONCILIATION-BLOCKED-HANDOFF.md` | `4e313a39c2463d6113b01f48638a74e15174b5264230afeddb82235a6e00ab81` | Latest reconciliation handoff; verdict `BLOCKED` |
| `storage/STORAGE-V2-WORK-ORDER-S-A1-RECONCILIATION-BLOCKED.sha256` | `ba54454ffb658ff4cda1f68ca7b96c0a001ad846b767b13ba85a7418536df387` | Hash of the corresponding seal file |

The storage handoff reports 11 focused top-level app tests after that frozen repair. It also records that full adjacent suites, race detection, and vet were not rerun, and that M>1 migration cannot be verified from the retained evidence. M4 repair is now in progress, so this blocked seal is provenance only and supplies no source for assembly.

## Evidence labels used in these docs

- `FROZEN_DECISION`: accepted architecture or contract decision.
- `VERIFIED_LOCAL`: bytes or hashes checked in the documentation workspace.
- `VERIFIED_TEST`: a result recorded by a named lane log for its exact historical candidate.
- `SUPPLIED_CLAIM`: current status supplied by A0/owner but not independently reproduced here.
- `NOT_RUN`: no applicable execution evidence for this checkpoint.

## Packaging rule for the WIP review checkpoint

Pinned blocked source may be published now as historical review evidence when its frozen predecessor base, exact patch/delta, status, and hashes travel together. Keep each lane in a separate evidence directory; do not merge it into a runnable tree or imply acceptance. Preserve source seals unchanged, generate a new publication manifest, do not copy from active worktrees, and do not treat this provenance index as a source manifest. Complete dependency/source closure is required only before claiming reproducibility or an integrated runnable candidate.

