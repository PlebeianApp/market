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
- A draft create-once APP successor installer now binds the exact old release,
  new site binary, pre-start verifier and systemd unit. It retains the old unit,
  journals publication, leaves the site inactive, and refuses production use
  while its owner-install authority is false.
- The runtime-binding template fails closed until payment, genesis, anchor,
  observer, network, browser and health inputs plus exact configuration hashes
  and scoped approvals are present.
- One unauthorized five-role adoption plan now maps site/authority/coordinator/
  terminal to APP and the signer only to V1-V4, with exact predecessor and
  successor unit pins. Existing validator binaries, participant binaries,
  shares and per-slot confinement drop-ins remain predecessor-owned.
- The public configuration renderer consumes the accepted bootstrap, runtime
  binding, prerequisites, bootstrap acceptance, approved genesis-content
  decision, authoritative payment projection and mint-only reconciliation
  directly. Chain ID `plebeian-auctions-mvp-20261102` and timestamp
  `2026-11-02T18:35:21Z` are frozen once for all lanes. With current inputs it
  emits inert configurations; it can emit ready configuration only after
  derived runtime pins and all scoped authorities are present. Independent
  freeze review is accepted at
  SHA-256 `4d002c529f058e9beac785cbc689212531447f8a0a92cf055b7e0a0fb1d5352d`.
  The owner-reviewed sanitized payment
  projection and exact file hash satisfy the existing renderer's receipt-file
  contract; no private raw receipt or extra genesis-payment approval is added.
- A separate validator-4 recovery command now requires its own start approval,
  exact inactive-to-active unit transition, and a pinned four-signature Comet
  commit before sealing `active_rejoined`.
- The Go assembly-only legacy note namespace is selected as
  `http://127.0.0.1:8180/test-mint`. Port 8180 is the loopback site/API process;
  a composed handler test proves the path is a 404 non-JSON namespace, not an
  operational mint API. It is not an anchor/preimage field or the private FIPS
  Cashu server URL, and the threshold application disables its legacy note
  authority.

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
- The composed successor-release fixture installed the actual 46 MB binary,
  retained the predecessor unit, produced a receipt, passed the installed
  pre-start verifier with complete synthetic public inputs, rejected the
  blocked template and rejected a repeated install without receipt mutation.
- The real local `systemd-analyze verify` parser returned success for the exact
  site, authority, coordinator and signer successor units and emitted expected
  warnings for production executables/dependencies absent on this workstation.
- The five-role adoption fixture copied and checked every actual APP/V1-V4
  binary, ran all installed role artifact guards, proved the current render is
  inert, rejected output-root reuse, and passed all role contracts with a
  complete synthetic ready input set.
- The rebuilt executable started a loopback site plus four actual local Comet
  processes; all four reached height 6 with one block/app hash and four commit
  signatures, and the HTTP-served browser bundle matched the embedded asset.
- The focused Go route test accepted only the private loopback `/test-mint`
  namespace, rejected the public Cashu origin as that namespace, observed 404
  non-JSON route behavior, and preserved distinct config identities.

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

1. a separately scoped owner-signing grant and resulting public authority
   outputs; the frozen preimage is independently accepted and the mint
   projection, active keyset, public Cashu identity and later private
   `/test-mint` assembly namespace are pinned;
2. a fresh verified HTTPS/firewall evidence set and explicit issuance approval;
3. the exact signed deployment anchor derived from the frozen chain ID,
   timestamp and preimage; no new timestamp may be sampled;
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

The corrected GET-only Coco bootstrap is accepted as a bootstrap-only public
milestone: acceptance report SHA-256
`734ebc54830e867a3c77441f56d0c3019f08efee5b64a69959ea888110d342ad`,
owner-verified receipt SHA-256
`a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d`,
seven GETs and 17,479 accepted bytes, no funding or persisted wallet, with the
mint stopped and settled. A later owner-supplied projection is accepted as
actual mint-only payment evidence: reconciliation SHA-256
`9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da`,
active keyset `001a10236c313f83`, and owner-verified receipt digest
`b5bac575046f13e1b030662818fba7ebe89df442cff12a5f8ec3983ac1332add`.
The raw receipt was not independently rehashed, and this is not genesis,
threshold custody, browser-auction, HTTPS or deployment acceptance.
That limitation is preserved as provenance, but the private raw receipt is not
an input required by the production renderer: it consumes the accepted public
projection file and that file's exact SHA-256.
