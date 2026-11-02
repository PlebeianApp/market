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
- Browser bundle: 1,717,244 bytes, SHA-256
  `dbfc4bd748685854e036098df93aa9604df8bd2e3d79d735934eb54055465a4f`.
- Linux executable: 46,588,440 bytes, SHA-256
  `ab92ff6d0552f8de88208636cdad77dff3863ee8ef325eb04352e635e93e20c5`.
  It reports version `2026.10.23-friday-tier1` and value profile
  `FAKE_MONEY_ONLY`.
- Authority executable: 99,171,906 bytes, SHA-256
  `af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d`.
- Coordinator executable: 98,655,955 bytes, SHA-256
  `2671bb59de2b8a63ffd34721f28c97b59098935503f322ac833b0339d6e6a777`.
- Terminal executor: 98,846,552 bytes, SHA-256
  `630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460`.
- Signer executable: 98,923,995 bytes, SHA-256
  `00c448e172c13b1a9862cd97bf79608e879739c0cc44aba74019bc3df66739d9`.
- Acceptance operator executable: 98,477,330 bytes, SHA-256
  `99db455714398434a9e3719236c3f05c0356d5e945b926aa31e3951e31d1b25d`.
- Same-path browser rebuild and independent-output Go rebuild were byte-for-byte
  identical to those artifacts.
- The real Coco runtime now forces identity encoding, rejects and boundedly
  cancels non-identity responses, and the browser-facing nginx mint routes
  clear upstream `Accept-Encoding`.
- The authority, terminal executor and signer were rebuilt from that corrected
  shared transport; consecutive baseline-target builds were byte-identical.
- The coordinator was also rebuilt as part of the coherent runtime set;
  consecutive same-path baseline-target builds were byte-identical. It does
  not itself perform mint HTTP reads.
- A separate validator-4 recovery command now requires its own start approval,
  exact inactive-to-active unit transition, and a pinned four-signature Comet
  commit before sealing `active_rejoined`.

## Verification actually run

- Friday TypeScript typecheck: pass.
- Friday browser suite: 122 pass, 0 fail, 441 assertions.
- Four-validator service suite: 83 pass, 0 fail, 366 assertions.
- Go repository suite: pass.
- Separated-topology suite: 19 pass.
- Static UI/readiness/authorization/adversarial suites: 49 pass, 0 fail.
- Mint encoding/adaptor regressions: 14 pass, 0 fail, 94 assertions.
- Authority/terminal/signer CLI regressions: 10 pass, 0 fail, 49 assertions.
- `git diff --check`: pass.
- The rebuilt executable started a loopback site plus four actual local Comet
  processes; all four reached height 6 with one block/app hash and four commit
  signatures, and the HTTP-served browser bundle matched the embedded asset.

The five-member tests also prove that duplicate actors and conservation drift
fail closed. The runner observes automatic close and never calls the manual
close endpoint.

The local process smoke test was not the separated production profile: it
reported threshold custody and browser threshold readiness false and used no
Nutshell or NIP-07. The stronger integrated local harness could not start its
throwaway mint because this workspace has no `.venv/bin/mint`; it is not a pass.

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

The inactive APP site currently installed under the immutable
`separated-site-browser-r2` release is the older binary, not this side-quest
build. Its installed unit is internally consistent with that release. This
new build requires a separately reviewed create-once successor release and an
exactly rebound unit; it must not overwrite the accepted release in place.

The four-validator DKG result is already complete and must not be repeated.
Until the gates above are bound and the five persistent browser profiles run
the journey against the live origin, deployment status remains **built and
locally verified, not live**.

Owner execution has now reported the corrected GET-only Coco bootstrap result
`COCO_BOOTSTRAP_DIAGNOSTIC_R2_COMPLETE_MINT_STOPPED_NO_FUNDING`, receipt
SHA-256 `a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d`.
Public receipt reconciliation is pending, so it is not yet an accepted bound
input. No funding/payment conformance has run.
