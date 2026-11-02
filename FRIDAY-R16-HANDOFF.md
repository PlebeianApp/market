# Friday R16 durable handoff

Current source is commit `1dab1a041e494b97d92e55816cfb0b4db15c373e`
(tree `78abffc835dc8ea35bdb2830b660cf4496e4c91e`). It includes the
fsync-correct manifest composer and concrete operator-side Comet/fault
adapters. The exact build receipt is
`FRIDAY-R16-CURRENT-BUILD-RECEIPT.json`, SHA-256
`6f881a8a50a8f966278be9cb51d081bc67059c8aa3628b59c2cb93c6407d1e74`.

## Completed and preserved live state

- Four persistent FIPS identities remain host-local. The latest bounded mesh
  campaign was stopped in reverse order; no Friday FIPS service or `fips0`
  remained. Historical strict result is 11/12 numeric RTT probes, with the
  twelfth authenticated as `sub_millisecond`; this is not application proof.
- R15 enrollment completed once on all four validators. Each host retains its
  own DKG, encrypted-transport and signer-RPC private identity below
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`. Only the four signed
  public enrollment files in `deploy/friday/dkg-enrollment-r15/` left the
  hosts. Their hashes are fixed in the R16 action packet.
- Wednesday services/data were unchanged. No coordinator, pairwise AEAD key,
  FROST share, Comet validator, mint or browser service has been started.

## Exact-current local evidence

- Composer focused gate: 10/10 tests, 37 assertions.
- Acceptance runner/adapters: 14/14 tests, 36 assertions.
- Browser/Coco gate: 62/62 tests, 231 assertions.
- Friday TypeScript typecheck and `git diff --check`: PASS.
- Three standalone artifacts built from `1dab1a0`; invalid-argument contract
  checks exit 1 with zero stdout and fixed stderr.
- The compiled composer consumed the four real public enrollment bytes plus a
  synthetic non-secret public coordinator and durably produced a public
  manifest/receipt. No live identity or host was touched.
- A deliberately invalid `recover-manifest` call after that completed canary
  refused because the successful operation had already released its lock. It
  made no change and is preserved in the receipt as an expected refusal.

Standalone hashes:

- DKG deployment/composer:
  `b4e8099424a9916e08d608723d7cee4792cc21a9cb118307483b3d31aaefaed9`
- loopback-only Comet probe:
  `1429f7eace6a983adf9ab250fdac1e1cd6a9698affdd50fd200cb1bbc5d4825f`
- acceptance operator:
  `f191da6cddf5867145ee1231565e40486c5f3888156c732716de61a45a445690`

## What the concrete adapters now do

- The remote Comet bridge targets only V2, re-hashes a fixed remote probe
  before every call, and permits only status, state, commit and block against
  V2 loopback RPC.
- It verifies the pinned chain, validator-set hash, canonical H/H+1 state
  binding and an exact three-of-four signer subset with no outsider.
- Auction create/close require the exact NIP-07 signed request, an HTTP commit
  receipt whose hash equals the exact Go transaction bytes, that exact
  transaction exactly once in a block whose hash matches a pinned canonical
  quorum commit, and the corresponding authenticated application state.
- Validator-4 fault control has fixed host/unit targets, safe argument-only
  SSH construction, a short-lived externally hashed approval, exact unit hash
  check, bounded stop/inactive checks and a create-exclusive durable local
  consumption record. It has not been run remotely.

The browser acceptance journey still receives the operator consensus port
through an explicit bridge. That browser/operator composition and all live
multi-account NIP-07/IndexedDB/Coco behavior remain **NOT_RUN**; the status
constant says so. Do not relabel the operator executable as a completed
browser acceptance run.

## Next exact action, not yet authorized

`FRIDAY-R16-COORDINATOR-COMPOSER-ACTION.md`, SHA-256
`d863b5dd46f3610225c78047f29c922c0d2520af1604c4783bdfec6079b44a3c`,
is the smallest next final-host stage. It is V2-only and would:

1. stage only the pinned R16 deployment tool;
2. create one V2-local coordinator RPC identity with create-once recovery;
3. stage the four already exported public enrollment bytes;
4. durably compose one public manifest/receipt pair.

It requires independent review of the exact artifact/fsync-order repair and a
fresh owner approval. It creates no pairwise key/share and starts no service.
Any failure/unknown preserves state and requires inspection plus separate
recovery approval.

## Remaining critical path and boundaries

1. Review and, if accepted, authorize/execute the R16 V2-only action above.
2. Separately review and authorize the public/ciphertext-only per-host DKG
   ceremony. Pairwise AEAD keys must exist only at their two endpoints; V2 as
   participant 2 may hold `1-2`, `2-3`, `2-4`, never `1-3`, `1-4`, `3-4`.
3. Obtain all four authenticated final attestations and verify the common
   public package on every host before creating FundingAbort/genesis pins.
4. Create the separately approved owner and controlled fake-mint identities;
   render/verify the launch seal; stage services with public admission off.
5. Under another bounded approval, start FIPS, validators, signers, mint,
   authority/site and run the exact browser acceptance plus one-validator
   unavailable exercise. Review recovery evidence before any activation.

Own raises and emergency unilateral timeout refunds remain disabled. The
implemented refund is the cooperative, certified outbid path. One signer
absent before subset selection is supported; a selected signer lost
mid-session remains fail-stop until the same signer returns. Fake sats only;
no production, FIPS 140 or real-value claim.
