# Architecture and trust boundaries

## Repository map

- `main.go`, `internal/poc/`: Go CLI, HTTP/site, authenticated auction state,
  CometBFT application and tests. `internal/poc/static/` is embedded in the Go
  binary; plain JavaScript UI code is separate from the generated wallet bundle.
- `cashu-wrapper/ts/poc-friday-browser-entry.ts`: browser composition, identity,
  Coco wallet integration, durable operations and explicit recovery controls.
- `cashu-wrapper/ts/demo-friday-*`: browser authority, coordinator, terminal
  executor, acceptance adapters and focused regressions.
- `cashu-wrapper/ts/demo-friday-auction-payout-*`: bounded seller catalog,
  authorization, fresh authenticated winner selection and durable claim fence.
- `cashu-wrapper/frost-participant-3of4/`: experimental Rust threshold signer;
  `frost-public-inspect/`: public-package inspection utility.
- `cashu-wrapper/vendor/`: pinned, modified Coco packages; do not silently
  replace with upstream releases.
- `deploy/`, `scripts/`: pinned historical operators, guards and isolated test
  harnesses. They are not an automatically safe deployment API.

## Intended payment path

1. A browser actor authenticates with Nostr and uses a separate payment key.
2. The seller creates an auction and registers bounded, auction-scoped payout
   authorization after the committed auction state is visible.
3. A bidder obtains worthless FakeWallet sats and prepares exact funding and
   winner/refund templates. Durable browser state retains ambiguous operations.
4. Authority/admission and the threshold participants validate bound evidence;
   CometBFT commits auction state. A UI balance is not funding evidence.
5. Terminal processing uses the authenticated close/winner outcome and a durable
   payout claim. Seller receipt/import and outbid returns are separate recovery
   steps; a transport response is not automatically proof of delivery.

## Important boundaries

Nostr login does not replace payment authorization. Browser persistence does
not replace authenticated chain state. The authority/coordinator are privileged
parts of the demo composition, not proof of decentralized custody by themselves.
FROST signatures alone do not prove a mint accepted a spend. Mint responses,
DLEQ checks, exact keyset/amount/recipient bindings, replay protection and durable
recovery remain relevant. Availability and safety are distinct: signers retain
fail-stop behavior even where application services gain bounded restarts.

Older Wednesday custodial/interim-note and Friday reservation paths remain in
the repository. Their evidence must not be used to claim the current threshold
candidate is accepted. The current branch is fake-money experimental software,
not an audited production payment system.
