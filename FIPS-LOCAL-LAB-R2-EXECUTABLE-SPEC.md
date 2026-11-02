# Friday FIPS local lab R2 — executable boundary

Status: **compiled and source-tested; privileged execution NOT_RUN and not
approved**. Exact candidate source is
`96c81d8e23602fc9126e63cc6e05ce1f87a56ebc`; hashes and tool provenance are in
`FIPS-LOCAL-LAB-R2-BUILD-RECEIPT.json`.

## Compiled artifacts

| artifact | responsibility | build status |
|---|---|---|
| `plebeian-auctions-poc` | Go Comet ABCI, four-validator topology, site and RPC | built; Go tests pass |
| `coco-demo-frost-participant-3of4` | dealerless DKG, durable nonce/share and 3-of-4 aggregation | built; 17 Rust tests pass |
| `coco-demo-frost-public-inspect` | public-package validation | built |
| `plebeian-friday-frost-dkg` | fixed DKG wrapper producing four private shares and one public package | built |
| `plebeian-friday-signer` | authenticated admission and terminal service with participant-local Comet/mint policy | built |
| `plebeian-friday-integrated-driver` | admission, displacement, threshold SIG_ALL, unknown-outcome persistence and recovery process | built |
| `friday-fips-mint-bootstrap.py` | pinned Nutshell 0.19.2/FakeWallet launch under isolated Python | syntax checked |

The signer is not a renamed stdio worker: each service owns a separate private
share, restart/nonce/proof-use journal and authenticated RPC identity. It reads
participant-local Comet and NUT-07 state before admitting or signing and binds
the network, chain, DKG run, public package, roster, auction, operation, exact
proof Ys, recipient, keyset, role and validity interval. The admission and
Cashu disposition signature domains are distinct.

The integrated driver starts no service. It creates an auction, mints two real
fake-money NUT-11 pools, obtains 3-of-4 admission with signer 4 unavailable,
zeros the displaced bidder's Nostr, NUT-11 MAIN and unilateral REFUND keys,
commits two bids with validator 4 unavailable, derives certified displacement,
uses the admission-persisted exact offline-return authorization, obtains a new
3-of-4 terminal authorization, submits the exact bidder+committee SIG_ALL mint
spend, persists `response_unknown`, and exits. A fresh process recovers the
same operation using NUT-07/NUT-09, imports DLEQ-verified recipient proofs and
checks them UNSPENT. It cannot fresh-pay blindly.

The admission package is encrypted with a one-run key derived from the
persisted coordinator identity and exact network/DKG/roster identity. The
driver closes and reopens that SQLite store from a newly derived key before
displacement. This shows store-manager reconstruction, while the later mint
recovery is the actual process boundary; it does not claim a separate crash
immediately after admission.

## Verified ordinary gates

- Focused TypeScript integration: 102 passed, 0 failed across 17 files, 383
  assertions on the exact candidate source. A restrictive sandbox attempt
  first produced 100 passes and two child-stdio `EPERM` failures; the affected
  file passed 6/6 and then the complete suite passed outside that sandbox.
- Friday TypeScript compiler: pass.
- Rust participant: 17 passed, 0 failed; participant and inspector builds pass.
- Go: `go test -mod=readonly ./...` passes (the first sandbox attempt failed
  only because the default Go cache was read-only; the scoped `/tmp` cache
  retry passed).
- Locked artifact build: pass for all six binaries plus Python syntax checks.

These gates do not prove privileged namespace creation, FIPS packet traversal,
the compiled driver against the throwaway mint, cleanup or live VPS behavior.

## Immutable execution boundary

No root process may load Python from the user-writable worktree. A future
reviewed action first copies only the pinned files and the complete pinned
Nutshell site-packages tree into
`/var/lib/plebeian-friday-fips-r2-reviewed`, changes them to root:root and
removes group/other write permission. The controller requires that exact path,
rejects file and directory symlinks, recursively verifies every imported
Python file and directory's ownership/mode and the canonical tree hash, and
verifies every executable is root:root and not group/other writable plus all
source/binary hashes before
creating a namespace or key.

The detailed allowlist, topology, capabilities, key lifetime, cleanup and
residual risks are in `FIPS-LOCAL-LAB-R2-ACTION-SCOPE.md`. Independent static
review accepted the exact controller and pins for action-time approval
presentation. The execution JSON is technically approval-ready, but the root
staging and one run still require fresh owner authorization.

## Honest remaining gaps

- The compiled R2 lab covers only cooperative outbid return. The winner-payout
  and reserve-unmet services have source-level fixtures, but are not wired into
  this executable driver or fake-mint run. The emergency refund's unavoidable
  MAIN-versus-REFUND first-mint-spend race is modeled in unit tests, not this
  lab.
- A same-host namespace lab demonstrates actual FIPS traversal and real
  threshold cryptography, not independent operators, production custody,
  high availability or federal FIPS compliance.
- SIGKILL or host death can prevent automatic cleanup. No automatic retry is
  permitted until exact residual inspection.
- No live VPS, firewall, TLS, DNS, credential or production service change is
  included or authorized.
