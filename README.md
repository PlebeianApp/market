# Plebeian auctions — Wednesday fake-money POC

An isolated proof of concept for short Nostr-authenticated auctions backed by
four real CometBFT validators and worthless Cashu proofs from a
Nutshell/FakeWallet mint. It never contacts `relay.plebeian.market`, a real
Lightning backend, or a production wallet.

## What is real

- four distinct CometBFT node keys and four distinct consensus validator keys;
- NIP-07 event signatures for the browser flow;
- Coco v2 wallet operations against Nutshell 0.19.2;
- mint-signed NUT-11 bid locks, a mint spend for the seller payout, and the
  mint-enforced bidder refund branch;
- validator rejection of malformed, replayed, unattested, late, and unfunded
  application transactions;
- live RPC/commit observations in the validator panel.

The application coordinator has one shared secp256k1 key and sees Cashu bearer
proofs. Validators verify its public lock receipt; they do **not** independently
verify Cashu proofs with the mint. This is an explicit POC trust shortcut, not
FROST or threshold custody.

## Focused verification

```bash
env GOWORK=off GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off \
  GOMODCACHE=/tmp/plebeian-poc-modcache GOCACHE="$PWD/.cache/go-build" \
  go test -mod=readonly ./...

cd cashu-wrapper/ts
bun test auction-lock.test.ts coco-rail.refund.test.ts demo-sigall-live-mint.test.ts
```

The sealed UI-level acceptance record is
[`evidence/site-cashu-comet-20261020.json`](evidence/site-cashu-comet-20261020.json),
SHA-256 `da09efa96089fa2e98eb20ec214f7670fe3f0931668511b0e72019389bd921a2`.
An additional actual three-tab browser walkthrough is recorded in
`evidence/browser-cashu-comet-20261020.json`; unlike the API acceptance, it
clicked the disposable Nostr login, faucet, auction, bid, settlement and refund
controls and included a coordinator restart with outstanding locks.

## Local composition

1. Install `requirements-poc.txt` into an isolated virtual environment and
   install the TypeScript dependencies from `cashu-wrapper/ts/bun.lock`.
2. Start Nutshell on `127.0.0.1:3338` with `MINT_BACKEND_BOLT11_SAT=FakeWallet`
   and a new test-only seed. Never use a real Lightning backend.
3. Build the Go binary, then run:

   ```bash
   ./bin/plebeian-auctions-poc local-demo --home .local-run/network --listen 127.0.0.1:8080
   ```

4. Start `cashu-wrapper/ts/poc-coordinator.ts` with `COMMITTEE_KEY_PATH` pointing
   at `.local-run/network/cashu-committee.key` and
   `POC_COORDINATOR_STATE` pointing at a private writable checkpoint path.
5. Put a local TLS reverse proxy in front of `127.0.0.1:8080` if another device
   must access it. The Go site and mint refuse public listeners by design.

See `RUNBOOK.md` and `DEPLOYMENT-PROPOSAL.md` before any VPS work.

## Undeployed Friday Tier 1 candidate

Branch `poc/friday-tier1-2026-10-23` changes only the next demo candidate. It
does not rewrite the evidence or liabilities described above and has not been
deployed.

The Friday path uses already funded, server-held Coco wallets keyed by the
authenticated npub. A bid reserves uniquely allocated value in a durable
application ledger and consensus commits the coordinator's signed non-bearer
reservation receipt. It is a custodial reservation, **not** a NUT-11 or other
mint-enforced bid lock. Seller delivery still transfers actual Nutshell test
proofs through a durable send/receive outbox.

Review `FRIDAY-DEMO-BRIEF.md`, `DECISIONS.md`, `RECOVERY.md`, `STATUS.md`, and
`LIMITATIONS.md` together. The Friday-specific focused commands and the
plan-only reset/seed gates are in `RUNBOOK.md`.

The current local acceptance evidence is
`evidence/friday-site-local-20261021T184957Z-1088127.json` (SHA-256
`90c78ce1a778e0d411b237922c25c417315ece15ba6a65e767fd04ae0813d0e8`).
It is an isolated throwaway run, not deployment approval or production
evidence.

The Go `scenario` command is retained only to reproduce the retired Wednesday
interim-note evidence. It now fails closed unless
`POC_ENABLE_LEGACY_INTERIM=true` is set in a separately isolated historical
run. It is not the Friday acceptance path.
