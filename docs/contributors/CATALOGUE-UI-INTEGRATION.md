# Catalogue UI integration candidate

## Scope

This isolated candidate adapts the visual language of Chiefmonkey's Perplexity
Computer mockup into the existing R20 Auctions browser flow. It does not import
the mockup's simulation engine or claim that its conceptual features exist.

Base candidate:

- branch: `contrib/auctions-mvp-recovery-2026-11-06`
- commit: `41c7098e13fb8854abf5e304653d91ca18e23d0b`
- integration branch: `codex/catalogue-ui-integration`

The public recovery branch and the untouched recovery worktree were fetched and
rechecked on 2026-11-09. Both still resolve to the base commit above, so this UI
is not sitting on an older public snapshot.

Reference inspected:

- <https://www.perplexity.ai/computer/a/8fb75ecc-f5b7-4da7-988f-4f2183fc60fd>

### Reference-source audit

The signed Perplexity Computer session exposed readable presentation source:
`engine.js?v=4` (17,463 bytes), `ui.js?v=4` (46,435 bytes),
`styles.css?v=4` (68,086 bytes), four HTML templates, and mock media assets.
The JavaScript engine is a client-side simulation: it has no network-backed
auction service, durable store, FROST signer call, CometBFT state read, or Coco
wallet. This was sufficient to study layout and interaction language, but not
to integrate a working auction engine.

The signed asset URLs can expire and the mockup does not establish reuse rights
for its photographs, video, fonts, or fictional seller identity. Those assets
are therefore references only and are not dependencies of this candidate.

## Integration boundary

The candidate keeps `internal/poc/static/app.js`, `friday-browser.js`, the
release-pin checks, R20 readiness gate, browser-owned Coco state, exact
threshold-funded bid path, certified return/payout imports, and expired
pre-lock recovery safeguards.

The catalogue renderer consumes only `/api/state`, `/api/validators`, the
release-pinned browser controller, and committed auction/payment data. Local
time may format the committed deadline, but it never closes an auction or
declares an uncommitted winner.

The usability pass keeps the mockup's cream editorial catalogue, large lot
imagery, serif headings, orange current-bid treatment, and pink primary action.
It borrows the alternate Arena view's hierarchy—not its dark skin—for a large
countdown, a dominant current bid, and three explicit quick-bid steps. Desktop
and mobile layouts use the same controls and transaction language.

The renderer distinguishes commit-signature observations from mere RPC
reachability. A validator endpoint that responds without evidence being
evaluated remains `Signature unknown` and is not counted as an observed
signature.

The following mockup-only features are explicitly not enabled:

- livestream and prerecorded "live" media;
- chat and seller replies;
- max-bid/proxy automation;
- seller reputation, followers and reviews;
- watchlists and reminders;
- private order/shipping rooms;
- bots, rigging and clock controls.

### Behavioral reconciliation

| Chiefmonkey mockup behavior | Recovery-candidate behavior used here |
| --- | --- |
| In-memory/local simulated lots | `GET /api/state` committed auction and bid state |
| Client-side clock and winner transition | Deterministic committed close; local time is display-only |
| Instant refund-style presentation | Certified terminal return import with pending/unresolved states preserved |
| Generic seller proceeds/escrow story | Auction-scoped payout authorization and certified winner-payment import |
| Max/proxy bids, chat, live media and seller reputation | Visibly gated as unavailable |
| Decorative validator state | `GET /api/validators`, with RPC reachability kept distinct from observed commit signatures |

The existing recovery API surface remains intact: `GET /api/config`,
`GET /api/browser-release-pins`, `GET /api/state`, `GET /api/validators`, and
`POST /api/event`. The timing candidate adds an `auction_policy` object to the
existing config response; it does not add a mutation endpoint. The embedded
`friday-browser.js` is rebuilt from its reviewed TypeScript source so the payout
authorization ceiling covers the seven-day base plus existing extension and
recovery bounds and the existing 300-second consensus event-skew allowance. The
absolute lock deadline is not extended by that skew. The UI continues to call the controller's existing actor,
funding, balance, payout authorization/read, exact bid, certified import, and
expired pre-lock review/discard operations.

Response-loss behavior is operation-bound. A signed create event is retained
in origin-local storage before its first POST; an uncertain retry first reads
committed state and otherwise resubmits the exact event, never signing a second
listing. The fence clears only after the committed fields and auction-scoped
payout authorization both verify. A malformed retained record fails closed.
For bids, public discovery retains the exact funding operation. Retries use the
retained amount, leader, deadline, and operation ID; once an exact signed bid is
durable they use read/finalize recovery without reconstructing it from a newer
leader. The UI explicitly says when a prior bid was recovered and preserves a
new, unsubmitted draft.

Seller-payout and bidder-return labels are terminal-acknowledgement based.
`Checking`, `pending`, `status unavailable`, and `imported` are distinct. A
successful import is associated with the exact auction payout or funding
operation and is re-opened from durable browser payment state after reconnect;
an older return on the same auction cannot mark a newer bid imported.

## Asset policy

No mockup photographs, video, seller identity, contact fixture, logo, or bundled
font file is copied into this candidate. The catalogue uses CSS-generated
placeholders when a committed listing has no acceptable HTTPS image. Listing
images remain seller-provided URLs and must be used only when the seller has the
necessary rights.

## Truthful video boundary

Until a fresh live acceptance run succeeds on the exact pinned release, record
this as a UI integration candidate. A system video must retain the visible
disclosure: fake sats, one operator, four CometBFT validators, 3-of-4 FROST
monetary authorization, jmcorgan/fips transport, and not production. Do not
expose bearer proofs, private keys, FROST shares, Nostr
secrets, credentials, raw wallet storage, or private coordinator data.

## Local verification boundary

The repository's loopback smoke server renders this candidate correctly at
desktop (1440×900) and mobile (390×844) breakpoints without horizontal page
overflow. A separate loopback-only fixture with exact synthetic release pins
was used to exercise connection, quick-bid selection, exact-minimum bid
submission, committed-height feedback, leading state, and seller-payout import
presentation in an actual browser. It used no live service, wallet, signer, or
payment data.

These checks prove presentation, client-state transitions, and fail-closed
gating, not a live full-path R20 run.
Before filming a maintainer demo, repeat acceptance with the exact independent
release-pinned browser controller and services, and capture committed auction,
bid, close, return, and payout evidence from that run.

## Seven-day timing candidate

For a future freshly approved deployment, the reviewed base-duration range is
3 seconds through 7 days. The seller must explicitly choose a value; the UI
does not preselect one. Ten-minute and thirty-minute demo shortcuts remain
available, along with one-day and seven-day shortcuts. Every value is checked
against one of the two exact reviewed `auction_policy` profiles returned by
`/api/config`, so an existing one-hour network continues to advertise and
enforce one hour rather than inheriting a UI-only increase.

Anti-sniping semantics are unchanged: a bid committed in the final 3 minutes
extends the deadline by 3 minutes, up to 30 minutes total. The browser payout
authorization and bid lock cover the committed original deadline plus that
30-minute cap and the existing 15-minute emergency-recovery window. At the new
maximum, the absolute payment deadline is exactly 7 days and 45 minutes after
the committed creation time. Authorization validation permits at most 7 days
and 50 minutes from the browser's `validFrom` so a consensus clock up to 300
seconds ahead cannot make a valid seven-day listing impossible to authorize.
Registration alone also tolerates an authority clock up to 300 seconds behind
the signed `validFrom`; bid selection and spending remain inactive until
`validFrom`. Existing shorter authorizations remain valid.

### Network compatibility and rollout

This source change does not alter the running recovery network. Its existing
manifest still advertises the legacy one-hour policy, which remains accepted by
the bundle validator so funded auctions can finish and recover under their
original deadlines. The application never rewrites an existing auction's
`original_end_time`, `end_time`, funding receipt locktime, payout authorization,
or terminal entitlement.

There is no reviewed in-place consensus-policy upgrade mechanism in this
candidate. Enabling seven-day listings therefore requires a coordinated new
network release:

1. stop admitting new auctions on the old public chain while leaving its exact
   recovery paths available;
2. close or recover every existing funded auction and import certified returns
   and payouts under the old chain, mint, and release pins;
3. owner-sign a fresh deployment anchor for the new deployment identity and
   seven-day manifest;
4. have each validator initialize and sign its fresh public descriptor bound
   to that deployment, chain, genesis inputs, and anchor;
5. assemble the new genesis and bundle from the owner anchor plus all signed
   validator descriptors, then have each validator verify that exact assembly
   and sign its finalization acknowledgement;
6. seal the bundle with all four final acknowledgements, build and pin the
   updated browser, authority, coordinator, and validator artifacts, and only
   then install all four validator identities coherently;
7. run fresh create, seven-day boundary, late-extension, close, return, payout,
   restart, and recovery acceptance before switching the public site.

Do not copy, relabel, or import old-chain bearer proofs or application state
into the new chain. A same-chain rollout would first need a separately reviewed,
height-gated consensus upgrade and state-compatibility protocol; none is added
by this UI integration.

The current `browserDeploymentProfile` allowlist recognizes only the existing
R20 and separated deployment identities. Reusing either identity for a fresh
chain would collide with browser operation/state scoping and could endanger
recovery of old funded operations. A maintainer must therefore approve a new
deployment ID and its exact mint, keyset, DKG, genesis and release-pin profile;
this branch does not invent those production identifiers. The assembler and
bundle validator currently reject seven-day policy activation for every
deployment identity. Until the new identity is approved and explicitly added
to that gate, with a four-validator signing/rollout plan, seven days remains a
tested source candidate rather than an installable live migration.

`SOURCE-MANIFEST.json` remains evidence for the prior pinned release and is not
rewritten by this uncommitted candidate. Regenerate it only after review, the
new deployment profile, and exact release artifacts are final.
