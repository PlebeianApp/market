# Plebeian Auctions five-member MVP runbook

This runbook is for the separated fake-money deployment only: APP hosts the
website, non-voting observer, authority, coordinator and fake mint; V1–V4 are
the four voting validators and each retains its own FROST share. APP is not a
fifth validator and must not receive a validator key or FROST share.

The demo proves a fake-sat auction journey. It does not establish real-money,
production, federal-FIPS, high-availability or independent-operator safety.

## Build and local verification

Run from the repository root with the pinned/cached toolchain:

```sh
(cd cashu-wrapper/ts && bun run typecheck:friday)
(cd cashu-wrapper/ts && bun run test:friday:browser)
(cd cashu-wrapper/ts && bun run test:friday:v4-service)
(cd cashu-wrapper/ts && bun test coco-rail.funding.test.ts coco-rail.threshold.test.ts)
env GOWORK=off GOTOOLCHAIN=go1.23.1+auto GOPROXY=off \
  GOCACHE=/tmp/plebeian-sidequest-r4-go-cache go test ./...
python3 deploy/friday/separated/test_separated_target.py
python3 deploy/sidequest-mvp/verify-public-inputs.py
(cd cashu-wrapper/ts && bun build poc-friday-browser-entry.ts \
  --target=browser --minify \
  --outfile=../../internal/poc/static/friday-browser.js)
env GOWORK=off GOTOOLCHAIN=go1.23.1+auto GOPROXY=off \
  GOCACHE=/tmp/plebeian-sidequest-r4-go-cache go build -mod=readonly \
  -trimpath -o dist/sidequest/plebeian-auctions-mvp .
./dist/sidequest/plebeian-auctions-mvp version
```

The executable must report `FAKE_MONEY_ONLY`. Building the browser bundle to a
different output basename changes Bun's minified identifiers; reproducibility
comparisons must use the canonical output path above.

## Activation inputs

Do not activate services until the single deployment owner has bound all of:

- a new chain ID and canonical UTC genesis time;
- the accepted fake-mint conformance receipt, canonical mint URL and active
  zero-fee sat keyset;
- the accepted DKG public result and committee key
  `026de1d6cb863ef79f5eb6f95298a7740b8bb27ab666cf133a2dc9e089a222155b`;
- the exact owner-signed deployment anchor;
- matching application, health and browser pins;
- trusted HTTPS for the final APP origin, without certificate-warning bypass;
- normal authority health, an advancing four-validator chain, the automatic
  close trigger and the terminal drain loop.

Do not repeat DKG, re-enable the legacy `/api/cashu/` route, use the interim
faucet, reset payment state, or substitute the APP observer for a validator.

## Five profiles

Use five separate persistent browser profiles or devices with five distinct
NIP-07 public keys. Do not share profiles, wallet storage or private keys.

1. Seller funds 1,000 fake sats and creates a 360-second auction: starting bid
   100, increment 100, reserve 0.
2. Bidder A funds 1,000 and bids 100.
3. Bidder B funds 1,000 and bids 200 after A is the committed leader. A imports
   the exact 100-sat outbid return.
4. Bidder C funds 1,000 and bids 300 after B is the committed leader. B imports
   the exact 200-sat outbid return.
5. Bidder D funds 1,000 and bids 400 inside the final 180 seconds. C imports the
   exact 300-sat return. The committed end must extend from consensus time.
6. Stop validator 4 only under its separate, exact approval. Confirm advancing
   commits with three pinned signatures; do not fault a validator while a
   payment result is unknown.
7. Wait for the automatic close. Do not use `POST /api/close` for this MVP
   acceptance. Bidder D must win at 400 and the seller imports one terminal
   payout.
8. Under a separate start approval, restore validator 4 and wait for it to
   rejoin current commits. Never interpret a configured restart policy as
   evidence of rejoin.

With zero starting balances, the final spendable vector in role order is
`[1400, 1000, 1000, 1000, 600]`; its sum remains 5,000 and every reserved,
locked, pending and unresolved projection is zero. With nonzero starting
balances, add each starting balance to its corresponding entry.

## Acceptance implementation

`runDemoFridayFiveMemberAcceptance` performs the same five-controller journey
through the concrete browser controller ports. It requires five distinct
actors, exact funding increases, three actual return imports, a committed
anti-sniping extension, 3-of-4 close finality, automatic close observation,
one seller import and final five-wallet conservation. It never submits the
manual-close API.

The runner is also exposed in the browser bundle as
`plebeianFridayRunFiveMemberAcceptance`. Cross-profile orchestration remains an
operator responsibility; the function does not copy wallet state or signer
capabilities between profiles.

## Stop rules

On a timeout or lost response, preserve the same profile and operation ID and
read its durable status. Do not mint, bid, import or settle under a fresh ID
until the original outcome is reconciled. Quarantine, pin drift, an unknown
mint effect, fewer than three commit signatures, a missing return, a missing
payout or nonzero final unavailable value is a failed/incomplete demo, not a
reason to weaken a guard.
