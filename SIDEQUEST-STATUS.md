# Plebeian Auctions side-quest status

Status recorded 2026-11-02 UTC. This is implementation and local-test evidence,
not a claim that the public MVP is live.

## Ready locally

- Isolated branch: `sidequest/mvp-20261102`, based on the accepted separated R4
  implementation.
- Five-member browser acceptance runner: one seller, four bidders, five exact
  fake-sat fundings, four increasing bids, three outbid returns, consensus-time
  anti-sniping, one-validator outage, automatic close, seller settlement and
  exact five-wallet conservation.
- Browser export: `plebeianFridayRunFiveMemberAcceptance`.
- Browser bundle: 1,716,496 bytes, SHA-256
  `d0a7eb0048e9f4ec4ea9e8c6589e9a6791278c86f746894c63c80b1d4f169a80`.
- Linux executable: 46,588,448 bytes, SHA-256
  `e4da15227b43e208aba8f57b92b9977a6f648e43af1c94bd3a7963f17ec67db0`.
  It reports version `2026.10.23-friday-tier1` and value profile
  `FAKE_MONEY_ONLY`.
- Same-path browser rebuild and independent-output Go rebuild were byte-for-byte
  identical to those artifacts.

## Verification actually run

- Friday TypeScript typecheck: pass.
- Friday browser suite: 120 pass, 0 fail, 432 assertions.
- Four-validator service suite: 83 pass, 0 fail, 366 assertions.
- Go repository suite: pass.
- Separated-topology suite: 19 pass.
- Static UI/readiness/authorization/adversarial suites: 49 pass, 0 fail.
- `git diff --check`: pass.

The five-member tests also prove that duplicate actors and conservation drift
fail closed. The runner observes automatic close and never calls the manual
close endpoint.

## Public activation not yet performed

No SSH, service, mint transaction, firewall, credential, genesis-signing or
deployment-cutover action was executed in this lane. Public activation still
depends on the single deployment owner receiving and accepting:

1. the completed fake-mint GET and payment conformance result plus canonical
   mint URL and active zero-fee sat keyset;
2. a fresh verified HTTPS/firewall evidence set and explicit issuance approval;
3. owner-selected chain ID and genesis time plus the exact signed deployment
   anchor;
4. the scoped APP/V1-V4 activation approval and, for the fault exercise, separate
   validator-4 stop and start approvals.

The four-validator DKG result is already complete and must not be repeated.
Until the gates above are bound and the five persistent browser profiles run
the journey against the live origin, deployment status remains **built and
locally verified, not live**.
