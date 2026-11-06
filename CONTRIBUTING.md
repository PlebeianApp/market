# Contributing to the fake-sat candidate

## Prerequisites and install

Use an isolated checkout on Linux. Verified tooling for the checks below:
Go 1.23.1 (the actual selected binary, not an older system Go), Bun 1.3.11, Node 24.11.0, Python 3. Rust 1.86+ is required only
for the additional participant gates. Check `GOTOOLCHAIN=local go version` before running the commands. Do not copy another checkout's
`node_modules`, runtime databases, keys or configuration.

```sh
cd cashu-wrapper/ts
bun install --frozen-lockfile --ignore-scripts
cd ../..
```

The lockfile references repository-local Coco archives as well as registry
packages. Keep the archive paths and lockfile intact. These are modified Coco
artifacts, not interchangeable with the similarly named npm releases.
See [provenance](docs/contributors/PROVENANCE.md).

## First checks: no deployed service needed

Run from the repository root:

```sh
(cd cashu-wrapper/ts && bun run test:friday:browser)
(cd cashu-wrapper/ts && bun run test:friday)
(cd cashu-wrapper/ts && bun run typecheck:friday)
(cd cashu-wrapper/ts && bun test demo-friday-mint-read-transport.test.ts demo-friday-trust-read-transport.test.ts poc-friday-browser-entry-recovery.test.ts)
node --test internal/poc/*.test.js
GOWORK=off GOTOOLCHAIN=local go test -mod=readonly ./...
git diff --check
```

Go may need its pinned modules downloaded on the first run. To explicitly
forbid downloads in a populated module cache, add `GOPROXY=off GOSUMDB=off`.
Do not use a broad `bun test` run as the quick-start command: the tree also
contains opt-in live, historical and environment-specific suites.
The Friday suite may exceed Bun's default 5-second per-test timeout on a busy
machine; an explicit `bun run test:friday --timeout 15000` rerun passed here,
with the initial timeout retained in the status record.
The scoped TypeScript check is not a claim that the whole historic tree is
strictly type-clean. Consult the current status for actual outcomes.

## Build the embedded browser and Go site

```sh
(cd cashu-wrapper/ts && bun build poc-friday-browser-entry.ts \
  --target=browser --minify --outfile=../../internal/poc/static/friday-browser.js)
mkdir -p bin
GOWORK=off GOTOOLCHAIN=local go build -mod=readonly -trimpath \
  -o bin/plebeian-auctions-poc .
./bin/plebeian-auctions-poc version
```

`internal/poc/static/friday-browser.js` is intentionally tracked because Go
embeds it. Rebuild and review it alongside TypeScript changes. Other generated
runtime bundles, executables, caches and dependency directories must not be
committed. The Go CLI includes legacy/local demo modes: starting the site
alone does **not** create the current threshold browser topology.

## Additional isolated fake-sat integration

This is an advanced test harness, not a one-command production deployment.
Read `scripts/friday-integrated-frost-comet.sh` before execution. It requires
Linux tools (`setsid`, `timeout`, `ss`, `curl`, `openssl`), free loopback ports,
a local Python virtualenv containing the pinned Nutshell dependencies, and
built Rust participant/inspector binaries:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-poc.txt
bash scripts/friday-rust-gate.sh
bash scripts/friday-integrated-frost-comet.sh
```

The harness generates a disposable mint seed, selects
`MINT_BACKEND_BOLT11_SAT=FakeWallet`, binds to loopback and cleans up its owned
processes and temporary state. Never substitute a real backend or reuse keys.
Its process-level FROST/Comet test is not fresh browser/NIP-07/live acceptance.
Do not publish raw output until checked for proofs, tokens, keys and topology.

## Small, reviewable contributions

1. Branch from this candidate; explain the behavior and trust boundary affected.
2. Add a regression for the failure, cancellation, retry or restart involved.
3. Run the relevant focused tests and the checks above. Report failures/skips.
4. Rebuild the browser asset if its TypeScript inputs changed.
5. Keep real wallets, identities, host inventories, deployment approvals,
   service state, screenshots and operation receipts out of commits.
6. Ask maintainers for review. Passing tests do not authorize a merge, live
   signing ceremony, service restart, mint transaction or deployment.

The `deploy/` tree is historical/pinned operational source. Contributor tests
inspect templates and synthetic fixtures; do not install those units, apply
nginx files or invoke production validators. Public topology values in old
fixtures are not invitations to contact those hosts.
