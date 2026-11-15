# License and notice successor candidate — 2026-11-15

Status: **local review candidate; not published**.

This successor is based on reviewed checkpoint
`0abbf066dd6974bdf95698fd2f0e47f93a96695d` (tree
`1f12bd1dbf14d53bacaca8e92ac4bb5d74a0171c`). The immutable reviewed
checkpoint remains unchanged. This record covers only the isolated
`prep/auctions-maintainer-2026-11-15-license-notices` worktree.

## Maintainer decision now reflected

An authorized Plebeian Apps maintainer approved GPL-3.0-only for
project-controlled original code, including reviewed AI-assisted project code.
Contributors retain their respective copyright unless otherwise agreed. That
decision does not relicense third-party material or establish rights in copied
or imported code.

The candidate adds:

- the GPL-3.0-only text at repository root;
- a contributor copyright and project-stewardship notice;
- GPL-3.0-only declarations for both local Rust packages and the private npm
  package;
- an inbound contribution-license statement;
- exact Coco MIT and `iris-contrib/schema` BSD-3-Clause terms;
- Coco fork, patch, tree and archive provenance, including the deterministic
  fork snapshot and post-pin patch; and
- a bounded notice/archive integrity gate.

## Verification performed on this successor

The following checks ran from the isolated successor without contacting live
services or payment endpoints:

| Check | Result |
| --- | --- |
| `sh scripts/check-publication-notices.sh` | passed |
| `git diff --check` | passed |
| Cargo metadata for both local packages | both report `GPL-3.0-only` |
| `bash scripts/friday-rust-gate.sh` with Cargo/Rust 1.86 offline | passed: 33 participant unit tests, 2 integration tests, inspector tests/build |
| `bun install --frozen-lockfile --offline` | passed from existing cache and repository archives |
| `bun run typecheck:friday` | passed |
| `bun run test:friday:browser` | 158 passed, 0 failed |
| Coco source snapshot plus post-pin patch reconstruction | passed: fork tree `b82bd005d076776ddb529120739632d1708f2bc8`, patched tree `c54a44e4b62889e90668f10ce52c05200ff8ac80` |
| SQLite-Bun declaration conformance | passed: TypeScript check plus 1 runtime test, 24 assertions |
| `bun run test:friday` | 2 pretests passed; restricted run had 409 passed and 2 child-process `EPERM` failures; exact affected file reran outside that sandbox with 8 passed, 0 failed |

The inspector continues to emit the pre-existing non-fatal `dead_code`
warning for `FinalPublicPackage.version`. No product source was changed to
silence it.

## Resolved publication items

1. Project-controlled original-code license: GPL-3.0-only.
2. Local Rust/npm declaration gaps: closed in this successor.
3. Exact Coco MIT text: recovered and hash-bound.
4. Exact `iris-contrib/schema@v0.0.6` BSD-3-Clause-form terms: recovered and
   hash-bound.
5. Direct Coco archive identities and modified-fork lineage: recorded.
6. Modified Coco source availability: the verified deterministic fork snapshot
   and post-pin patch are included and hash-bound in this candidate.
7. SQLite-Bun declaration status: exact bytes are retained as reviewed,
   hand-maintained API metadata and bound to a compile-time/runtime conformance
   test.
8. Sanitized dependency-license evidence: included for 93 Cargo, 58 Go, 18 npm
   and four vendored-archive components, with local workstation paths removed.
9. Browser-bundle npm notices: exact license/NOTICE files from the locked
   installed tree are retained and checksum-bound under
   `third_party/licenses/npm/`.

## Remaining source-branch publication gates

1. **Final outgoing-history security review.** Repeat the recognized secret
   scan, SBOM/license scan and exact remote-ref/identity checks against the
   final commit immediately before a non-force publication.
2. **Remote publication readiness.** Re-read both target branch refs and prove
   the selected ngit signer can authorize the new branch without exporting its
   key.

The outgoing license/notice change adds no Plebeian host address, service
credential or current operational fingerprint in its textual diff. Historical
operational records remain inherited from the already-public parent; this
successor does not certify those records as current or safe operating
instructions.

## Separate release gates

- The sanitized inventory does not itself decide compatibility for every
  possible binary distribution. Recheck the exact linked artifacts and ship
  the bound notices with each release form.
- Live fake-sat acceptance and recovery evidence are not established by this
  licensing candidate.

No push, deployment, live signing, payment action or service mutation was
performed while preparing this successor.
