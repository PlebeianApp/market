# Current verification and acceptance

Recorded 2026-11-06. Implementation snapshot: `fc86843`; see the source manifest
for per-file hashes and the provenance document for the local source commit.

## Fresh checks in the isolated contributor checkout

- Frozen-lock Bun install with lifecycle scripts disabled: passed.
- Friday browser suite: 131 passed, 0 failed, 486 assertions.
- Friday scoped TypeScript check: passed.
- Node UI/deployment fixture suite: 42 passed, 0 failed.
- Additional mint-read/trust-read/browser-recovery tests: 20 passed, 0 failed.
- Synthetic legacy recipient-pending fixture after sanitization: passed.
- Browser bundle: rebuilt from source, byte-for-byte identical. SHA-256:
  `5a1b1a15ea6a43ac9417c9ed0c48ae7a3a25ad0d3db711b352dfb548cb2bd726`.
- Full Friday rerun with `bun run test:friday --timeout 15000`: 386 passed,
  0 failed, 1,626 assertions. The default-timeout result below still applies.
- Go `./...` with the installed Go 1.23.1 binary: passed offline.
- R20 suite: **57 passed, 1 skipped, 1 failed**. The disposable predecessor
  permission-seal test failed with `process executable inventory could not be
  completed`; its process inspection prerequisite is unavailable here. The
  root-only traversal test was skipped. The fail-closed guard was not weakened
  or bypassed. R20 is not a passing gate for this publication.
- Diff whitespace check: passed.

The first full Friday suite run returned 385 passed and one failure: the
idempotent terminal-operation regression exceeded Bun's default 5-second
budget (5.078 seconds). The identical test passed when rerun alone in 4.592
seconds. This timeout is disclosed rather than treated as a clean initial run.
The explicit 15-second-budget rerun is listed above.

The first Go attempt selected system Go 1.22.2 and was blocked by the module's
Go 1.23.1 requirement. Automatic selection with checksums disabled also failed.
The final attempt uses the already installed Go 1.23.1 binary directly and
forbids network module/checksum retrieval. Install/select the right Go binary
before using the contributor commands.

## Not established by this publication

- Fresh live one-seller/two-bidder acceptance on this exact candidate.
- Visual/NIP-07 browser QA, real mint settlement or deployed-service restarts.
- A fresh Rust gate or isolated full Nutshell/FROST/Comet integration run.
- Production security, cryptographic audit, marketplace compatibility or merge
  readiness. No required remote CI result is implied by local tests.

The public parent recorded a historical five-user acceptance. That is not
acceptance of this newer recovery code. Existing historical status files and
binary hashes remain tied to their original revisions and execution contexts.
No deployment, signing ceremony, public mint transaction, PR or maintainer
message was performed to publish this branch.

## Remaining maintainer work

Review the implementation delta and provenance. Reproduce the focused and
integration gates in an isolated FakeWallet environment, investigate any flaky
or environment-dependent checks, then separately approve and execute staged
visual QA and the fresh fake-sat acceptance journey. Never infer deployment
permission from a contributor branch or passing tests.
