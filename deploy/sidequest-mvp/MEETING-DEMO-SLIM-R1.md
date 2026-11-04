# Five-person meeting demo — slim path R1

Status: prepared, not executed. This path demonstrates the real four-validator
auction and real 3-of-4 FROST admission flow with fake sats. It intentionally
omits infrastructure fault testing and production-identity provisioning.

## Fastest secure access

1. Finish the existing HTTPS lane for the exact pinned origin
   `https://139.162.161.233`. The browser flow itself rejects HTTP and any
   different origin. Never bypass a certificate warning.
2. Install the separately prepared server-level Basic Auth include with five
   independent accounts named `demo-1` through `demo-5`. Keep the application
   bound to loopback behind the reverse proxy. Follow
   `BASIC-AUTH-OWNER-HANDOFF-R1.md`; no plaintext password belongs in this
   repository or an agent session.
3. Each person opens the valid origin in a separate browser profile or on a
   separate device, authenticates with only their assigned account and selects
   **Use demo identity**. The auction identities are generated locally in the
   tab and are not exported.
4. Keep every demo tab open until its refund or payout is imported. Reloading
   loses that tab's ephemeral identity, so a reloaded profile must stop rather
   than fund again.

The five testers are on separate networks, so source-IP allowlisting is not the
selected access control. The temporary public 443 listener must expose only the
authenticated TLS virtual host; APP ports 8180 and 8181 remain loopback-only.

## Minimal preflight

Immediately before the first funding action, verify:

- the certificate is valid in an ordinary browser and the visible origin is
  exactly `https://139.162.161.233`;
- APP clock remains synchronized and within 500 ms of the validator median;
- APP site, authority, coordinator and observer are active with zero restarts;
- V1-V4 Comet and FROST services are active with zero restarts;
- the four-validator chain is advancing and authority readiness is true in two
  samples at least one second apart;
- the auction state is empty and no queue item or unresolved operation exists;
- `/api/config` reports `threshold_custody=true`, both browser threshold
  readiness flags true and `recovery_only=false`.

Stop if any check differs. Do not restart services or repeat funding to force a
pass.

## Five-minute interaction

Assign one seller and bidders A-D. Record only the short public actor shown by
each tab so duplicate identities are noticed.

1. All five select **Use demo identity** and confirm five different actors.
2. Each funds exactly 10,000 fake sats once.
3. The seller creates one auction with duration 30 seconds, starting bid 100,
   minimum increment 100, reserve 0 and no external image.
4. The seller enables approvals for only that auction and keeps the tab open.
5. A bids 100. If the UI says `seller_plan_pending`, the seller services that
   exact plan and A retries that retained bid once.
6. B bids 200; A imports the certified return and verifies 10,000 spendable.
7. C bids 300; B imports the certified return and verifies 10,000 spendable.
8. D bids 400; C imports the certified return and verifies 10,000 spendable.
9. The seller disables approvals. The late-window rule will put the close about
   180 seconds after the last admitted bid. Let the automatic close run; do not
   submit a manual close.
10. The seller imports the 400-sat payout. D remains the winner.

Expected final spendable balances are seller 10,400; A 10,000; B 10,000;
C 10,000; D 9,600. The total must remain exactly 50,000, with no reserved,
locked, pending or unresolved amount.

## Evidence and stopping rules

For each admitted bid, retain only the public auction ID, bidder actor, amount,
committed height, receipt digest and committee signature verification. This is
the real FROST-backed admission path. Do not export browser storage, Cashu
proofs, Nostr private material, validator keys, signer shares, bearer tokens or
raw coordinator databases.

Stop immediately on a duplicate actor, certificate or origin mismatch, changed
release pin, readiness loss, clock drift, signer denial, unknown result,
mismatched seller plan, invalid committee signature, unresolved wallet state
or unexpected service restart. Preserve all tabs and server state for
diagnosis; do not reload, delete state or repeat funding.

## Deliberately removed for the meeting

These steps add no value to the five-person auction demonstration and are not
prerequisites for it:

- installing the acceptance operator or V2 Comet probe;
- creating the fixed SSH agent or fault-consumption directories;
- provisioning five durable NIP-07 identities;
- extracting the individual FROST signer subset from coordinator state;
- waiting 600 seconds or exercising the full late-extension acceptance vector;
- stopping and rejoining V4;
- testing restart recovery, interrupted actions or repeated-action refusal.

Those remain post-meeting acceptance work. They must not be represented as
having passed merely because this slim demo succeeds.

## Remaining action-time authority

The slim run still requires explicit approval for two separate actions:

1. installing the five-account Basic Auth gate and exposing only its HTTPS
   virtual host once certificate verification is complete; and
2. beginning the five-person run, which issues fake sats and causes real
   committee signatures and auction settlement.

