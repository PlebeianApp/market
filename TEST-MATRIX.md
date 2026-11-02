# Friday Acceptance Matrix

The independent A2 review rejected the frozen candidate's aggregate PASS.
Post-review custodial-checkpoint evidence is preserved below. The owner later
expanded the target to real FROST payment and FIPS networking. One unified
local outbid-return slice now passes; FIPS and the other live terminal branches
remain unrun and block integrated acceptance.

## Custodial checkpoint

| Required case | Exact current evidence | Status |
|---|---|---|
| Four identities; 10k faucet; 50k cap | Full local site evidence; five grants and sixth refusal | PASS |
| B1000/C1500/B2000/D2500; prompt releases; seller 2500 | Full local site evidence with actual Coco/Nutshell outputs | PASS |
| Reserve 5000/top3000 no sale | Full local site evidence plus Go transition coverage | PASS |
| Invalid/self/replay/equal/lower/late/unfunded | Go suite and local site flow | PASS |
| Cross-auction wallet race | Public-path concurrency evidence: 7k anchor, simultaneous 2k/2k, exactly one success | PASS |
| Parallel own raises | Public-path concurrency evidence | PASS |
| Raise versus outbid | Public-path concurrency evidence; one consistent final active reservation | PASS |
| Exact deadline and +1800 cap | Go ABCI timing test crosses CheckTx, proposal and finalization | PASS |
| Faucet response lost | Real Coco reconstruction and subprocess crash run reached recovery | PASS at exercised boundary |
| Stable operation/proof identity | Prepared/terminal SQLite and NUT-07 audits plus stalled-mint audit: one operation row, exact selected inputs/outputs, identical canonical send-token and receive-input lineage digest | PASS |
| Active zero fee | Full site flow inspected the active sat keyset and refused nonzero fee | PASS |
| Focused strict TypeScript | Matched baseline/candidate manifest plus focused exit 0 | PASS |
| Payment crash boundaries | Final PID manifest covers faucet, intent, prepare, lost mint response, send result and receive result across real SIGKILL/restart boundaries | PASS for custodial checkpoint |
| Exclusive conservation at every ambiguity point | Six persisted snapshots plus final endpoint: issued/accounted 10000 at every boundary; prepared whole-proof change is exclusive | PASS |
| Mint down at close | Artifact records V4-offline close, unavailable payout and same-mint recovery once; it predates final harness fields/lineage audit and cannot prove that later source | PASS AT RECORDED BEHAVIOR SCOPE |
| Mint accepts but stalls | Proxy completed upstream swap and withheld response; exact 2500 occupied unknown exclusively, then the same operation recovered once with canonical proof-lineage audit | PASS |
| One validator offline locally | Both corrected mint-down cases close and continue committing with V4 offline and three signatures | PASS |
| Offline endpoint refusal | Focused Go suite | PASS |
| Phone UI and permanent labels | Actual 390x844 in-app browser layout/label inspection only: no overflow/errors or demo interaction; screenshot not retained | PASS AT LAYOUT/LABEL SCOPE |
| Owned process cleanup | Point-in-time exact-name/root scan plus recorded-PID absence; no claim of universal replacement-descendant detection | PASS WITH STATED SCOPE |
| V2 quarantine migration | Focused two-child-process migrate/restart: old 50k sentinel becomes grant0 + quarantine and stays unavailable | PASS AT PURE MIGRATION SEAM |

Primary evidence:

- `evidence/friday-typecheck-20261021T212936Z-8/manifest.json`, SHA-256
  `4d298bf8a7306419997cb844a0ef6007097850f705b711d5804fdaa5b0bd08ae`
- `evidence/friday-fault-matrix-20261021T213633Z-1112503.json`, SHA-256
  `95cbe8181b869e0a9b6ae8d8821b3b96f65bef457ae2916654467964d9e4a231`
- `evidence/friday-site-local-20261021T214020Z-1114194.json`, SHA-256
  `0f8f526ce36ccb7ee1026723e152c728901d3bfd3bc20882706f98498b1d2292`
- `evidence/friday-concurrency-local-20261021T214548Z-1115988.json`, SHA-256
  `cc93c34529cc8c96377746949cf7e12a78638466a5a73db467a042315bd76d20`
- failed `evidence/friday-process-manifest-20261021T215538Z-1122933.jsonl`,
  SHA-256
  `73086df294fc5a67f7817a9cebb3e94ca0590f8a0a5160f1142f04eb79aef9c3`
- final `evidence/friday-process-crash-20261021T224928Z-1148174.json`,
  SHA-256
  `cc59ab15021e46dc982b69d828de054d99745323fde039a836f6832ef2a0aee2`
- final `evidence/friday-operation-audit-20261021T224928Z-1148174.json`,
  SHA-256
  `91e7aa55f86257bcdc6f5fc9a94659aae83985f1feb0139733b6373d3843737c`
- final `evidence/friday-prepared-operation-audit-20261021T224928Z-1148174.json`,
  SHA-256
  `29cfd757571723e923738149dd751920fc1e7c07a9278ac848d13a75f25432bf`
- final `evidence/friday-process-manifest-20261021T224928Z-1148174.jsonl`,
  SHA-256
  `7444c60ee82d86a2e374bd9a931d1778f4ebba6d0abe7b9014318e02320610fa`
- final `evidence/friday-process-conservation-20261021T224928Z-1148174.jsonl`,
  SHA-256
  `faad845ba1c946089413e1f49447b3121fcda0fb54c06e3b879744a99ebb656b`
- stopped-mint close `evidence/friday-mint-stopped-close-20261021T230112Z-1152660.json`,
  SHA-256 `9065a6a3f8baa66c81e4e14b583d78a313671db248b82384feee1df0edbeec3e`
- stalled-mint close `evidence/friday-mint-stalled-close-20261021T231651Z-1160793.json`,
  SHA-256 `d9bc094ce7ec60a69fe76533e2a1d81e99e285b012fd063f10e8feb4364e2720`
- stalled-mint operation audit
  `evidence/friday-mint-stalled-close-20261021T231651Z-1160793-operation-audit.json`,
  SHA-256 `3ff6aee22f79255029e0622ef49c06e59f8dbc56b74cd3354a9de8beea976a86`
- preserved stalled-harness failures
  `evidence/friday-mint-stalled-failures-20261021.json`, SHA-256
  `ba412bcd0ae7c5df97531684bebd93038d54122ccacfd3c0cf2fcf6d161cf79e`
- phone metrics `evidence/friday-phone-ui-20261021T232245Z.json`, SHA-256
  `7d4579172696d88b74e7a0d39e9fcc74283a3bdd0ad1ca09ed963f89578b52f2`
- slot release `evidence/friday-slot-release-20261021T232433Z.json`, SHA-256
  `0a82cdc1f19da8f8718dbea2f58cbd218ee0a52c42c484840b4af58b8dba6473`

## Integrated FROST/FIPS target

| Required case | Minimum real assertion | Status |
|---|---|---|
| Fresh FROST committee | Four-party dealerless DKG; four verifying shares; one group key; no coordinator share | PASS LOCAL |
| 3-of-4 signing | Every three-member subset creates a real BIP340 aggregate; two shares cannot sign | PASS LOCAL |
| Cashu bidder + committee | Mint-enforced NUT-11 `n_sigs=2`, `SIG_ALL`; bidder signature plus FROST group signature spends exact displaced proofs | PASS LOCAL, OUTBID ONLY |
| Ordinary cooperative outbid return | Committed displacement; offline bidder's exact pre-authorized return; real mint spend and recipient ownership | PASS LOCAL |
| Emergency refund branch | Correct refund key/locktime and exact branch binding; mint accepts after locktime and refuses conflicting winner path | FOCUSED CONTRACT TESTS ONLY |
| Policy/closure binding | Auction, bid, proof Ys, outputs, recipient, mint/unit, keyset/version, closure and branch are transcript-bound | PASS LOCAL, OUTBID ONLY |
| Replay/session rejection | Reject stale keyset, reused proof, duplicate session, altered output/recipient/branch and wrong closure | PASS FOCUSED/LOCAL |
| FIPS four-node mesh | Every Comet P2P link traverses jmcorgan/fips; exact peer ACL and listener evidence; no direct fallback | NOT INTEGRATED |
| One validator offline over FIPS | Three real Comet signatures continue; offline node status is factual | NOT INTEGRATED |
| One validator offline on loopback | Three real Comet signatures continue after V4 is stopped | PASS LOCAL, NON-FIPS |
| FIPS lifecycle | Selected fail-stop or separately reviewed restart/recovery policy behaves exactly as declared | APPROVAL/EXECUTION PENDING |
| Combined seller payout | FIPS-carried consensus certifies close; three FROST participants authorize a real fake-mint seller payout | FOCUSED SERVICES ONLY; NOT LIVE UNIFIED |
| Reserve-unmet return | No-sale close returns the exact pool through durable threshold/mint recovery | FOCUSED SERVICES ONLY; NOT LIVE UNIFIED |

No integrated row may be marked PASS from historical component tests or UI
status alone. See `FRIDAY-FROST-FIPS-INTEGRATION-INVENTORY.md` for provenance,
interfaces and permission gates.

### Unified local vertical-slice update

The integrated outbid-return slice is now PASS locally: two real funded NUT-11
pools, first/replacement Comet commits, a genuinely unavailable policy service,
one validator unavailable, real 3-of-4 admission and disposition signatures,
one accepted fake-mint spend, lost response, exact NUT-07/NUT-09 recovery and
recipient ownership. Evidence SHA-256:
`89bd4a096388b758137f2652dc6e0792c7493de5a1e898bd9e31603c34b3846d`.

This changes only the corresponding local outbid-return evidence. FIPS mesh,
four-host SignerRPC, live winner payout, live reserve-unmet return, live
post-locktime emergency refund and deployment rows remain unpassed.
