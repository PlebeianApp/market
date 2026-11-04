# Five-member fake-sat live rehearsal R1

Status: prepared, not executed. This runbook does not authorize HTTPS
activation, credential creation, fake-sat movement, threshold signing, or a
validator stop/start.

## Readiness gates

Run only after all of the following are true:

1. The exact public origin has a valid certificate in an ordinary browser;
   never bypass a certificate warning.
2. APP and V1-V4 report synchronized clocks. APP must remain within 500 ms of
   the validator median for three bounded samples.
3. All APP services and all four validator/FROST services are active with zero
   restarts. No public listener exists except the separately approved HTTPS
   reverse proxy.
4. Two authority samples at least one second apart are ready at increasing
   heights, with `queuePending=0`; `/api/config` has both browser threshold
   readiness flags true and `recovery_only=false`.
5. The chain contains no earlier auction, bid, funding, displacement, or
   pending operation from this rehearsal.
6. The acceptance-only V2 probe and owner operator match
   `acceptance-release-r1-manifest.json`. Their installation starts no service.
7. Five team members have five distinct isolated browser profiles and five
   distinct NIP-07 test identities. Nobody exports or shares a private key.
   Tab-local demo identities are not acceptance identities.

The operator preflight is:

```text
/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-acceptance-r1/bin/plebeian-friday-r20-acceptance-operator verify-comet \
  --probe-sha256 e509f29f5edadbba037991cec02ca310518439bb23f5faaa36c9fc8158ecb230 \
  --chain-id plebeian-auctions-mvp-20261102 \
  --validators-hash d1936c5e5e9d09d0a96107031ae144068dcc2ad3f1d071e7f8fe871a8aaff773 \
  --validator-addresses F2FEA8935978AF365AF37F9D4EF3CBFAE9A531DA,3983A3511A3403978B2ED1B0D4E320F7D73F8655,F2B6DF0C5E1ED036E50AAC10312E557502E37726,F7F47F1B733CFA53F98368C8587B9FD116D5376F
```

It must report the pinned chain, an authenticated state/commit, at least three
known commit signers, and no unknown signer.

## Roles and exact vector

Assign one seller and bidders A-D. Record only their 64-hex public actors.
Every profile starts with zero unavailable balance and is funded once with
10,000 fake sats.

The seller creates one auction with:

- duration: 600 seconds;
- starting bid: 100 fake sats;
- minimum increment: 100 fake sats;
- reserve: 0;
- no external image is needed.

Expected bids are A=100, B=200, C=300, and D=400. Expected final spendable
balances from zero are seller 10,400; A 10,000; B 10,000; C 10,000; D 9,600.
Their sum must remain exactly 50,000 and every reserved, locked, pending and
unresolved amount must be zero.

## Browser sequence

1. Each member opens only the valid HTTPS origin, connects NIP-07, checks the
   displayed actor, and funds exactly 10,000 fake sats. Stop if actors repeat,
   a signer changes an event, or a wallet is not clean.
2. The seller creates the exact auction, enables approvals only for that
   auction, and keeps the profile connected. Each seller-plan prompt must name
   the expected auction, bidder, amount and unexpired operation.
3. Bidder A submits 100. If the UI reports `seller_plan_pending`, the seller
   services the exact plan and A retries only that retained bid. Wait for an
   admitted committed height.
4. B submits 200 through the same bounded seller-plan sequence. A imports one
   certified full return and must show 10,000 spendable with nothing
   unavailable.
5. C submits 300. B imports one certified full return under the same checks.
6. Wait until the committed remaining time is at most 180 seconds. D submits
   400. C imports one certified full return. The committed auction must show
   exactly one extension and a new end equal to the committed D-bid time plus
   180 seconds, bounded by the configured 1,800-second maximum.
7. Stop seller approvals after the D plan is registered. Do not reload any
   browser profile while its wallet has unresolved work.

No browser action is automatically retried. A retained funding or bid is
recovered only through the UI's exact original operation and amount.

## Threshold evidence

For every admitted bid, retain only sanitized public consensus evidence:

- auction ID, bidder actor, amount, funding operation ID and committed height;
- the receipt digest, committee keyset/version, DKG run, public-package hash,
  roster digest, participant-policy digest and committee signature;
- successful verification of the domain-separated committee signature under
  `026de1d6cb863ef79f5eb6f95298a7740b8bb27ab666cf133a2dc9e089a222155b`;
- the matching bid/funding state and three canonical displacement records.

Never publish Cashu proofs, proof bodies, browser wallet databases, NIP-07
private material, validator keys, signer shares, bearer tokens, or raw
coordinator databases. The consensus receipt proves the 3-of-4 committee
signature but does not reveal the signer subset. If individual participant IDs
are required, use a separately approved on-host sanitizer that emits only the
three IDs and a session digest; do not inspect the coordinator database by
hand and do not claim participant IDs from the signature alone.

## V4 outage and recovery

Stopping and starting V4 are two different mutations and require two fresh,
time-bounded owner approvals. Do not prepare both as one approval.

After the D bid and refund are verified, a fresh `STOP_VALIDATOR_4_ONCE`
approval may be consumed by:

```text
.../plebeian-friday-r20-acceptance-operator validator-4-offline \
  --approval ABSOLUTE_STOP_APPROVAL_JSON \
  --approval-sha256 STOP_APPROVAL_SHA256 \
  --unit-sha256 ff37b56e05c9325c7c92d821a0d73e3b9fcb153c54fcb58482c50e83351e3961
```

Require V4 inactive, V1-V3 online, a new canonical commit with exactly three
known signatures, and continued height advancement. Observe the automatic
close; the runner must not submit a manual close. D must be the 400-sat winner.
The seller then imports exactly one 400-sat payout.

Only after settlement and a distinct `START_VALIDATOR_4_ONCE` approval may the
operator run `validator-4-online` with the same probe/chain/roster pins. Require
an active V4 and a new four-signature canonical commit. The FROST signer is not
stopped by this validator-only fault test.

## Pass and stop conditions

Pass requires five distinct NIP-07 actors, five finalized 10,000-sat fundings,
four verified threshold-signed admissions, three full returns, one 180-second
late extension, automatic close under three-validator finality, one seller
payout, exact 50,000-sat conservation, and a four-signature V4 rejoin.

Stop and preserve state on any changed release pin, clock drift, readiness
failure, signer denial, unknown result, mismatched seller plan, invalid
committee signature, noncanonical commit, unresolved wallet balance, failed
outage/rejoin, or unexpected service restart. Do not delete wallet state,
repeat funding, broaden network access, or restart services to force a pass.
