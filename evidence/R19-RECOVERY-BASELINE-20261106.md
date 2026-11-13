# R19 recovery baseline — 2026-11-06

## Scope

This baseline records the exact live R19 browser hotfix before the end-to-end MVP recovery project changes payment behavior. It does not authorize or perform live funding, bidding, storage cleanup, journal cleanup, consensus activation, or Catalogue UI deployment.

## Source and release identity

- Recovery branch: `recovery/r19-e2e-mvp`
- R18 source snapshot: `9c66099f78dc995011569e3cb6d1ef4b5a77682c`
- Unchanged embedded `app.js`: `7348a35077a1efab82d55cdf6c57fbab4cf9f31acf62e5a8a6d9e1859db06958`
- Deployed R18 browser bundle: `16934bbd3830881b8b22ba13dfa283c995097bff5d839a32ca230c4c276205c5`
- Deployed R19 browser bundle: `59b7c0fbda549f37b14deed1a0ca12e481cb198be7f8be09974078b90948e0d2` (1,753,186 bytes)
- Deployed R19 site binary: `5ab562fc5f5592483c60738258af2aab8d36fb02091c0da5471062b69172c2a4` (46,738,928 bytes)
- R18 rollback binary: `b10e57405cba0ca920f206519776b2ad8da85915cca5ff6409cfca4961047a0b` (46,625,136 bytes)
- Build tools used for the R19 binary: Bun `1.3.11`; Go `1.23.1 linux/amd64`

## Exact hotfix

R19 changes only the browser Coco client's exact auction-payout comparison from insertion-order `JSON.stringify()` equality to the existing canonical JSON encoder for:

1. payout-selection outputs versus the exact winner request outputs; and
2. the retained recipient capability versus the exact winner capability.

The deployed browser bundle was produced by an exact, hash-gated replacement in the deployed R18 bundle. The TypeScript source carries the equivalent two-line change.

## Verification already completed

- 18 focused browser trust/client tests passed.
- Friday TypeScript type-check passed.
- `go test ./internal/poc` passed.
- R19 chained release verifier passed as the exact service user/group.
- Post-cutover live checks showed the site, authority, and coordinator active with zero restarts, wallet/admission readiness true, recovery-only false, and the public browser bundle matching the pinned R19 hash.

## Reproducibility gap

A clean TypeScript rebuild from this snapshot and the installed lockfile resolved to a semantically related bundle with SHA-256 `41a4d2b0c7f5a1dc3c743592ea1264a903a73396f6859372e7f14b4d1cef270f`, not the deployed R19 hash. The hotfix is therefore reconciled by exact source diff plus exact deployed-bundle derivation, but the deployed R19 binary is not accepted as a reproducible source build.

The next release candidate must:

1. install dependencies from the pinned lockfile in an isolated workspace;
2. build the browser bundle twice from clean source;
3. produce byte-identical bundle hashes;
4. build the site binary twice from those identical inputs; and
5. record all tool versions, inputs, hashes, and test receipts before review or deployment.

## Live acceptance status

R19 has not completed a live bid, outbid return, deterministic close, or seller payout. The MVP remains blocked until one seller and two bidders complete the full fake-sat conservation test with no locked, pending, or unresolved balance.
