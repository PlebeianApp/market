# Source provenance and compatibility findings

- The published auctions checkpoint at
  `/home/maximoto/Documents/Codex/2026-10-19/task-2/publication-git/ngit-auctions-mvp-checkpoint`
  was inspected read-only. Its consensus path is value-less and could not be
  treated as an end-to-end payment implementation.
- Coco v2 wallet/auction-lock sources were copied into this new POC from the
  read-only task-7 integration tree under
  `/home/maximoto/Documents/Codex/2026-10-18/task-7/worktrees/a1-fips-auth-ui/coco-v2-payment-integration/cashu-wrapper/ts`.
  Vendored Coco 2.0.0 package archives came from the matching read-only task-6
  evidence. Those source trees were not modified.
- The mint is the official `cashu`/Nutshell 0.19.2 Python package with its
  built-in `FakeWallet` backend. Python 3.12 required compatibility bounds
  `marshmallow==3.26.2` and `limits==3.14.1`; the proposal was therefore not
  "just wiring."
- New POC code supplies the CometBFT ABCI state machine, Nostr/API/site layer,
  coordinator receipt binding, one-node-fault evidence, remote topology and
  operations material. The coordinator uses Coco to create/read back strict
  NUT-11 locks and never derives funding from a UI balance assertion.
- The sealed R4.4.2 payment candidate, its reproduced legacy-envelope/CAS
  integrity gaps, and every execution guard remain untouched. This POC does
  not accept or bypass that candidate and makes no statement about R16,
  WO-HRF, storage-contract acceptance, historical-row campaigns, or R4.4.3.

## Friday persistence pin

- The Friday candidate first installed the public npm release
  `@cashu/coco-sqlite-bun@2.0.0` through the ordinary registry. Although its
  declared peer versions matched, runtime contract tests showed that it lacked
  the authority and `findMintByUrl` interfaces used by the already vendored
  modified Coco core. It was removed; no edit to `node_modules` is retained.
- The replacement is built from clean `packages/sqlite-bun` and
  `packages/sql-storage` sources at Coco commit
  `60b7b070393eaad8746cb74a03c42017186da647`, the same source pin as the
  vendored core. The task-local bundle keeps Coco/cashu-ts imports external and
  is installed through the repository-local tgz recorded in `package.json` and
  `bun.lock`.
- Bundle SHA-256:
  `fd460f5b409539a12fa3b8e28b83357c51132c9ac862250daec3906d881fb285`.
  Tarball SHA-256:
  `351b94a57a505551b179c8cbf73be1aa0eb9d77d8393aa9c32a7f9ad32c7dcdf`.

## Friday threshold/FIPS integration pins

- The concrete threshold participant is the read-only
  `coco-demo-frost-participant-3of4 0.1.0` source and binary from
  `/home/maximoto/Documents/Codex/2026-10-18/task-6/worktrees/a1-payment-frost-r2/cashu-wrapper/frost-participant-3of4`.
  It pins `frost-secp256k1-tr=3.0.0`, `k256=0.13.4`,
  `chacha20poly1305=0.10.1` and Rust 1.86 through its checked-in lockfile.
  The historical binary SHA-256 is
  `5c7f72db189443f97c02d58aaa136f7f1942ccfc9d7fc8307a9e6c38e76dd7b6`.
- The task-local `frost-public-inspect` helper uses the same
  `frost-secp256k1-tr=3.0.0` deserializer to expose only the DKG group public
  key and four public verifying shares. It never reads a private share or
  participant state. Its own source/build hash must be recorded after the
  first offline locked build; no pre-build hash is claimed here.
- The selected network component is the already installed jmcorgan/fips
  0.5.2 revision `53a3ec4b2fbaceb7009dd4fbe6974b011e452ae5`:
  `/usr/bin/fips` SHA-256
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`
  and `/usr/bin/fipsctl` SHA-256
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.
  Reading its packaged documentation does not prove a mesh. Only an isolated
  execution with TUN/peer/route/application evidence can do that.

## 2026-10-22 static integration repair

No dependency, downloaded executable or external source was added. The repair
only changes repository Go/TypeScript/docs and continues to reference the
already inventoried FROST participant and jmcorgan/fips artifacts. The FIPS lab
manifest is explicitly withdrawn until an exact harness and its hashes exist.
This historical source-only checkpoint was later compiled and exercised by the
final local gates described below. It was never deployed or used to change the
sealed full-payment candidate.

The repair bumps the unaccepted consensus funding receipt and bundle domain
separators from V1 to V2 because DKG-run, public-package and roster digests are
now mandatory signed fields. V1 bytes are not silently reinterpreted. It adds
no dependency: `DemoFipsMeshEvidenceV1` uses the already pinned Noble SHA-256
package and is an encoder/validator only, not a network implementation.

The terminal-branch follow-up inspected that same read-only Rust source and
its generated command implementation without modifying or executing it. Its
`sign-commit`, `sign-share` and `aggregate` authorization root explicitly
includes `cashu_sigall_digest`, full package, certified closure, signed-bid,
locked-proof and recipient bindings. It is therefore suitable only for the
disposition signature it was designed to produce. No generic or admission-
receipt signing command exists in the historical artifact.

The next source-only checkpoint vendors the exact generated 3-of-4 Rust source
as a **task-local fake-money fork** under
`cashu-wrapper/frost-participant-3of4`; the copied generated source SHA-256 was
`73bc6f1f484ebc682ad51303624edd97ccfa76707edf4688540172e62a23d468`
before local edits. `Cargo.toml` keeps the exact dependency pins and renames
the unpublished package to `coco-demo-frost-participant-3of4-demo 0.2.0` so it
cannot be confused with the sealed artifact. `admission-commit`,
`admission-share` and `admission-aggregate` use
`COCO_DEMO_FROST_ADMISSION_3OF4_V1`, separate authorization/operation/transcript
domains, the separate `COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1` Schnorr message,
a separate durable operation namespace and separate nonce journals.
The admission domain binds exact canonical receipt bytes and hash, auction/bid
intent, pool/mint/proof/keyset identity, all four participant evidence records,
DKG/public-package/roster identity and validity interval. The disposition
commands were not relabelled. No dependency was downloaded and no Rust build
or test has run; current local source hashes are recorded at checkpoint time,
not claimed as binary provenance: `Cargo.toml`
`1a3930e8b9f1c8c6ecd826e397c591ab20744e92ce3a2e036bdf1d8f887dfd28`,
`Cargo.lock`
`f7c5fe9fc706653c86a5cb84c785bf9da445a92c7824a822b837702afaa998dc`,
`src/main.rs`
`92ce9ca0cb6a511e7f319545eb5e1572d711efa72312704af2813aea2019ad40`,
and `src/admission.rs`
`140f7bb137cb26e67f9f35249e68bd1748ed48d717dec8d0edfc0cba92374493`.

## 2026-10-22 unified interoperability correction

The deployed throwaway target, Nutshell 0.19.2, verifies a NUT-11 `SIG_ALL`
message formed from every input secret followed by every output blinded point,
then SHA-256 hashes those UTF-8 bytes for BIP-340 verification. The earlier
task-local code used cashu-ts 5.0.0-rc.4's broader digest containing input C
points and output amounts; both bidder and threshold signatures were valid for
that local digest but Nutshell correctly rejected them. The implementation now
uses the actual Nutshell message and retains the broader proof/amount/keyset/
recipient binding in the signed admission, exact template, proof-pool and
operation roots. Frozen tests record both digests rather than falsely claiming
the two libraries are byte-compatible.

No new external dependency was added for this correction. Final executed
source used the existing locked Go, Bun/TypeScript and Rust dependencies and
the existing Nutshell virtual environment. The final unified evidence is
`evidence/friday-integrated-frost-comet-20261022T174059Z-1380457.json`,
SHA-256
`89bd4a096388b758137f2652dc6e0792c7493de5a1e898bd9e31603c34b3846d`.
No new dependency or external source was added by the final signer-local
hardening. Its DLEQ and NUT-07 response shapes come from the already installed,
locked cashu-ts/Nutshell types. The exact tested gates were: Friday TypeScript
120/0/418; focused integration 101/0/382; participant/NUT-07 13/0/56;
finality 5/0/19; live interoperability 2/0/10; unified live 1/0/18; Rust
participant 17/0; Go `./...` and Friday scoped typecheck PASS.
The evidence identifies tested source commit
`86addfda8108c50d5f8862b83919b954d5fc6e10` and records SHA-256 values for
the POC binary, Rust FROST participant and public inspector. The rollback
follow-up added no dependency: it only hashes and externally anchors the
existing Rust safety tree and proof-use SQLite generation/revision.
