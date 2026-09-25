# AuctionsDev final deployment preparation

## Safety boundary

The manual workflow has two actions:

- `PREPARE_ONLY` (the default) builds, tests, verifies, and uploads an
  immutable seven-day artifact. It has no host access.
- `ACTIVATE_AUCTIONSDEV` is the only action that enters the GitHub
  `staging` environment. It also requires
  `DUAL_RED_TEAM_CORE_PASS`.

Neither a push nor a final SHA activates anything. The dispatch must identify
the exact final 40-character Market integration SHA, the exact reviewed
40-character Core Git SHA, and the expected installed
artifact-content SHA-256 values for `@cashu/coco-core` and
`@cashu/coco-indexeddb`.

No candidate SHA is embedded in this deployment tooling. In particular, the
blocked Round 9 Core is not accepted or treated as releasable; dispatch inputs
must be the eventually approved Round 10 identity and final integrated Market
identity.

## Immutable runtime contract

The release requires:

- Bun `1.4.2`;
- exactly one physical `@cashu/coco-core` package;
- exactly one physical `@cashu/coco-indexeddb` package;
- exactly one physical `@cashu/cashu-ts@5.0.0-rc.4`;
- CDK `cdk-mintd 0.17.0-rc.0` with its architecture-specific checksum;
- AuctionsDev monetary mode `coco-test`, fake mint mode, and real funds off.

The package gate rejects obsolete rc11/Cashu 2.9.0, Cashu 3.7.1,
cocod/NPC, npubcash, local dependency paths, target-package symlinks,
`NODE_PATH`, and source maps. Development and production installs both use
the frozen committed lockfile and prove `package.json` and `bun.lock`
remain byte-for-byte unchanged.

The Core and IndexedDB values supplied to dispatch are hashes of the installed
package directory contents. The manifest additionally records the exact Cashu
runtime content hash, physical paths, dependency edges, frozen lockfile hash,
and fake-mint checksums.

## Browser producer and offline fresh-wallet verifier

The authoritative browser lifecycle command is:

```sh
bun run test:e2e:coco-auctionsdev-smoke
```

It cold-starts the application from the exact clean checkout, uses only the
local relay and fake mint, executes the browser preflight for the disposable
authenticated test account, and returns the path of the public report. The
deployment-owned wrapper copies only that public report. It does not accept a
pre-existing app server. The smoke result must identify the exact `test`
environment. Its report path may be relative or absolute, but the wrapper
resolves both the lexical path and filesystem real path against the real
checkout root and rejects traversal, outside paths, and symlink escapes before
reading or copying the report.

The authoritative strict offline verifier is separate:

```sh
bun run preflight:auctionsdev:fresh-wallet <public-report.json>
```

It cannot create browser evidence. A wrapper that merely invokes this verifier
cannot satisfy the full public-report schema and is rejected. The compatibility
entrypoint `scripts/run-fresh-auctionsdev-test.ts` remains required, but cannot
replace either authoritative package command with a divergent implementation.

The package verifier fails closed unless the browser-produced report and the
schema-1 verifier result prove:

- a fresh full account/environment namespace;
- zero ambiguous legacy inventory;
- protected seed custody;
- zero starting Coco balance;
- fake mint and no real funds;
- legacy writers disabled with zero active leases.

The public report, bound evidence envelope, and their SHA-256 commitments travel
inside the immutable release. The envelope binds the final Market and Core Git
SHAs, installed Core/IndexedDB content hashes, exact producer/verifier commands,
and clean checkout. Missing, stale, unknown, extra, malformed, or mismatched
evidence prevents packaging and activation.

## Health and process gates

The canonical schema-v2 smoke result must contain all ten passed lifecycle
checks, `appServerColdStart: true`, the exact Market/Core Git identities, and
the exact installed-content hashes. `/api/config` must expose the exact Market
and Core Git SHAs, Core and IndexedDB content
hashes, Cashu runtime version/hash, package identity, Bun/fake-mint versions,
fake/test monetary mode, fresh-wallet commitments, and smoke commitments. The
health checker compares the complete object and verifies fake-mint NUT-4,
NUT-7, and NUT-11.

Activation also verifies that all three PM2 PIDs are running the packaged
executables: the mint must be the packaged `cdk-mintd`, while Market and
ContextVM must both be the packaged Bun `1.4.2`. Each process starts from a
minimal explicit environment allowlist.

## First deployment and rollback

The active path must be a symlink or absent. The candidate and previous
release remain separate immutable directories. Candidate Caddy syntax is
validated before the active file is touched, and an existing Caddyfile is
backed up only if independently valid.

Any failure restores the previous release symlink, processes, and valid Caddy
configuration. On a first deployment with no prior release, candidate
processes are stopped and the active symlink is removed. Failed candidate
files and logs are retained for diagnosis.

## Manual dispatch

Preparation only:

```sh
gh workflow run deploy-auctionsdev.yml \
  -f market_sha=<FINAL_40_CHARACTER_MARKET_SHA> \
  -f core_git_sha=<APPROVED_ROUND_10_CORE_GIT_SHA> \
  -f core_sha256=<FINAL_CORE_CONTENT_SHA256> \
  -f indexeddb_sha256=<FINAL_INDEXEDDB_CONTENT_SHA256> \
  -f fresh_wallet_account_pubkey=<DISPOSABLE_TEST_ACCOUNT_64_HEX_PUBKEY> \
  -f release_action=PREPARE_ONLY \
  -f dual_red_team_core=PENDING \
  -f no_real_funds=NO_REAL_FUNDS
```

Final activation, only after both Red Teams pass and the prepared artifact is
reviewed:

```sh
gh workflow run deploy-auctionsdev.yml \
  -f market_sha=<FINAL_40_CHARACTER_MARKET_SHA> \
  -f core_git_sha=<APPROVED_ROUND_10_CORE_GIT_SHA> \
  -f core_sha256=<FINAL_CORE_CONTENT_SHA256> \
  -f indexeddb_sha256=<FINAL_INDEXEDDB_CONTENT_SHA256> \
  -f fresh_wallet_account_pubkey=<DISPOSABLE_TEST_ACCOUNT_64_HEX_PUBKEY> \
  -f release_action=ACTIVATE_AUCTIONSDEV \
  -f dual_red_team_core=DUAL_RED_TEAM_CORE_PASS \
  -f no_real_funds=NO_REAL_FUNDS
```

## Post-activation smoke contract

The final integration must preserve the canonical package command and may keep
`scripts/run-auctionsdev-coco-smoke.ts` only as a compatibility import of the
same implementation. From a clean checkout of the activated Market SHA, the
post-activation status smoke remains isolated and uses no real funds or public
relay:

```sh
bun run test:e2e:coco-auctionsdev-smoke
```

The schema-v2 result gate requires create, fund, both bids, hard reload
recovery, winner release, seller receipt finalization, settlement, loser
original-send refund, and conservation to pass with fake funds and zero public
relay effects. A result from another checkout, Core SHA, installed graph, or a
reused application server is rejected.

## Inputs and host access still required

Immutable release inputs:

- final integrated Market SHA;
- approved Round 10 Core Git SHA (Round 9 is blocked and forbidden);
- final Core installed-content SHA-256;
- final IndexedDB installed-content SHA-256;
- disposable fresh-test account public key;
- a fresh schema-v2 cold-start smoke result with all ten checks passing;
- dual Red-Team Core pass for activation.

GitHub `staging` secrets used only by the activation job:

- `STAGING_HOST`, `STAGING_USER`, `STAGING_PASSWORD`;
- `STAGING_APP_PRIVATE_KEY`;
- `AUCTIONSDEV_CVM_SERVER_KEY` (or `STAGING_CVM_SERVER_KEY`);
- `AUCTIONSDEV_FAKE_MINT_MNEMONIC`.

The host must provide PM2, Caddy, `curl`, `tar`, `gzip`, and
`sha256sum`, plus the existing operator sudo policy for Caddy validation,
installation, and reload.
