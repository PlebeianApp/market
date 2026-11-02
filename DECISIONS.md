# Friday Demo Decisions

## Target change: payment and networking integration

The owner has superseded the earlier “Tier 1 only; FROST/FIPS deferred” target.
Friday now targets real bidder-plus-committee Cashu `SIG_ALL`, a FROST 3-of-4
committee, and validator P2P over jmcorgan/fips. This does **not** retroactively
turn the custodial-reservation checkpoint into threshold custody, accept the
sealed full-payment candidate, or authorize live key/network changes.

The exact integration decisions and approval gates are recorded in
`FRIDAY-FROST-FIPS-INTEGRATION-INVENTORY.md`; bounded owner choices and impacts
are in `FRIDAY-FROST-FIPS-DECISION-PACKET.md`. Until those gates are resolved,
the correct status is NO-GO for the integrated target.

## Remaining owner choice: emergency refund race

The ordinary outbid path does **not** wait for an emergency deadline. Once a
replacement bid is committed and certified, the exact full-pool return that
the bidder pre-signed at admission is queued for 3-of-4 committee approval and
mint execution. An offline displaced bidder therefore does not have to return
to co-sign. “Prompt” still means after consensus finality, signer availability,
the mint response and recipient import; no fixed number of seconds is promised.

The proposed unilateral escape path is separate. Its locktime is
`original auction end + 1,800 seconds maximum extension + 900 seconds recovery
budget` (2,700 seconds after the original end). The committee stops admitting
new MAIN work 300 seconds before that locktime. This deadline cannot revoke a
MAIN signature that was already produced: after locktime, an already signed
MAIN and the bidder's REFUND may race, and Cashu accepts the first valid spend.
The other branch must reconcile as already spent and must never pay again.

The exact owner choice still required is: **accept that disclosed first-spend
race for worthless demo tokens, or leave unilateral emergency refund disabled.**
No implementation may claim REFUND priority. Until that choice is explicit,
the persistent Friday queue exposes only cooperative outbid return, winner
payout and reserve-unmet return and fails closed on emergency execution.

## A2 correction decisions

- `CheckTx` has no proposed block timestamp, so it uses only the last committed
  consensus time for advisory admission. It never substitutes the signed
  event's client-controlled timestamp. `PrepareProposal`, `ProcessProposal`
  and `FinalizeBlock` repeat the full transition with the block time and remain
  authoritative for eligibility and closing.
- Mint HTTP has a bounded aborting transport (default five seconds, test-only
  configurable from 250–30,000 ms). A timeout cancels the underlying fetch;
  the durable operation stays unavailable and is resumed by the same ID.
- The coordinator refuses an active sat keyset with a nonzero input fee. Fee
  evidence comes from the mint's active keyset inspection, not harness config.
- Global conservation is measured at one coordinator observation point. A
  transfer is assigned to exactly one sender-held, recoverable-transit,
  recipient-pending or paid/spendable bucket; pending faucet value is counted
  only after its exact balance increase is observed.
- Crash markers are available only when a known failpoint and a dedicated
  `/tmp/plebeian-friday-crash.*` directory are both configured. They contain no
  keys or bearer proofs. The harness must SIGKILL only the marker's exact PID,
  wait/reap it, and persist the owned-process manifest.
- These decisions are implemented in the post-`2803b48` working tree. Several
  focused and end-to-end tests passed, but the subprocess crash matrix still
  fails its intermediate conservation assertion after `send_prepare`; see
  `STATUS.md`. They are not an accepted aggregate candidate.

1. **Custodial reservations replace per-bid NUT-11 locks in the lower-level
   checkpoint only.** The coordinator
   holds real zero-fee test Cashu backing and signs non-bearer reservation
   receipts. Consensus identities stay distinct from the single application
   committee signer. This decision does not satisfy the newly requested FROST
   payment target and must not be presented as its implementation.
2. **Committed time is authoritative.** Event `created_at` remains signature
   and skew metadata; it is not auction time.
3. **Minimum increment defaults to 100 fake sats.** A valid next bid is at least
   `max(startingBid, highBid+minimumIncrement)`.
4. **Late bids extend by three minutes, capped at thirty minutes.** The exact
   formula is recorded in `FRIDAY-DEMO-BRIEF.md`.
5. **Own raises reserve the delta.** The old reservation is not released before
   the replacement commits. Competing-wallet bids reserve their full amount.
6. **No-sale releases all backing.** Reserve unmet and no-bid closes do not pay
   the seller.
7. **Outbox before network.** Every funding, payout and receive intent is
   durably recorded before a mint call. Unknown outcomes are unavailable and
   joined by the same operation identity or left blocked.
8. **Verified mint features only.** Existing Nutshell 0.19.2 evidence advertises
   NUT-04/07/09 and does not advertise NUT-13/19. No design may silently depend
   on the latter.
9. **No remote admin mutation.** The deployed `serve` mode continues to reject
   `/api/admin/offline`; local operator scripts may target only V4 and are not
   authority to stop it live.
10. **Legacy state is preserved.** Existing Wednesday NUT-11 liabilities and
    evidence retain a distinct `legacy` funding mode and their old coordinator
    recovery routes. New auctions require `custodial_reservation_v1`; the two
    funding paths cannot be mixed. The interim note faucet is disabled by
    default, and reset/seed tooling never converts or wipes legacy records.
11. **Persistent wallet adapter is pinned to the existing core source.** The
    registry SQLite adapter's nominal version matched but its actual repository
    contracts did not. The Friday candidate uses a reviewed local bundle from
    Coco commit `60b7b070393eaad8746cb74a03c42017186da647`, exactly matching the
    already vendored core, with recorded artifact hashes and no `node_modules`
    patch.
12. **Uncertain incoming value is unavailable.** A lost faucet response cannot
    enlarge reservable backing, and a seller cannot spend received proofs until
    the payout result is durably checkpointed. Wallet mutations that would
    make those balance observations ambiguous are serialized or refused.
13. **Admission signatures use one frozen prehashed BIP-340 message.** Rust,
    TypeScript and Go all sign or verify
    `SHA256("COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1" || receipt_digest)`
    directly. Rust must use its prehash verifier for this 32-byte protocol
    digest; applying the generic message verifier would hash it again and
    break cross-language interoperability. Admission and Cashu disposition
    commands remain separate domains.

## Browser funding authorization boundary

- NIP-07 signs only a canonical Nostr event (kind 28647). The event binds the
  authenticated network/chain, auction, amount, mint origin, funding operation,
  exact bundle/return-package/Cashu-SIG_ALL digests, exact bidder return
  signature, expiry and the public keys of a separate payment/refund keypair.
  It is not described or used as arbitrary Cashu signing.
- Separate browser-memory secp256k1 payment and refund keys prove possession
  over the exact Nostr funding intent. The payment helper does not accept an
  arbitrary digest: it constructs Nutshell's SIG_ALL digest from the exact
  input secrets and output blinded points, then signs it. Neither private key
  is sent to the server, exported by the demo helper or used as the Nostr
  identity.
- The same-origin API is loopback-only behind the site proxy and captures its
  trusted terminal source, private prepared reader and rollback health at
  construction. Browser input cannot supply consensus, signer, mint, reader or
  anchor capabilities. Terminal work is pulled from durable authenticated
  history; there is no public terminal-mutation route.
- Funding remains disabled after successful event validation. A separate V4
  receipt now carries the complete Nostr authorization and is validated by
  TypeScript, Go and Rust against one frozen public-only golden vector. V3's
  raw actor Schnorr signature remains unchanged and is not relabelled as
  NIP-07 support. Activation still requires the approved custody boundary and
  a fresh real Nutshell/Comet/FROST/FIPS run of the exact final artifacts.

The remaining UX choice is recovery/cross-device storage of the client payment
key. This build uses browser memory only, consistent with deferred cross-device
wallet work. The cooperative outbid return remains available while the bidder
is offline because its exact return package is pre-signed at admission. A page
reload loses the local payment key and prevents a new bid/raise until the
browser prepares new funded backing; it does not authorize server key custody.

There is also a custody-boundary choice that must be explicit before enabling
the browser route: Nutshell's SIG_ALL message contains the input proof secrets.
Local exact-package signing therefore requires the browser to receive and hold
the bidder's bearer inputs during preparation. Keeping all proofs exclusively
server-held would instead require the browser to sign an opaque server digest,
which this design refuses because it cannot independently identify the Cashu
spend. Funding remains disabled until the owner accepts client-held preparation
for worthless demo proofs or approves another independently verifiable design.
