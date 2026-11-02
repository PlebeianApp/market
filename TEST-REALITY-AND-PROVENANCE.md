# Test reality and source provenance

## Source line

The isolated repository was copied from the coherent accepted implementation
at `/home/maximoto/Documents/Codex/2026-10-28/task-4/separated-app-successor-r4`
and committed unchanged as `4cbed4d`. Commit `a2c1591` adds the five-member
acceptance runner, its browser export, tests, runbook and first rebuilt bundle.
No frozen evidence packet, installed release or private runtime state was
modified.

## What the reported local tests actually exercised

| Test group | Real local components | Simulated or absent |
|---|---|---|
| Friday browser suite, 122 tests | Bun runtime, Coco/cashu-ts packages, real secp256k1 signing and DLEQ verification, IndexedDB-compatible repository logic, Web Lock lifecycle, and SQLite durability code | No graphical browser, browser profiles, extension, live HTTP listener, Nutshell process, Comet process or remote validator. Fetch, consensus, authority and mint responses are controlled test ports. NIP-07 signers are local test signers. |
| Four-validator service suite, 83 tests | Bun runtime, real filesystem-backed and in-memory SQLite transitions, production serializers/verifiers, and in-process 3-of-4 cryptographic computations | No four validator OS processes, FIPS sockets, remote shares, live Comet chain or live mint. RPC/HTTP and participant availability are controlled fixtures. |
| Go suite | Production Go code, filesystem state in temporary directories, Go cryptography and in-process HTTP handlers | `httptest` recorders and synthetic public vectors; no browser, Comet node, Nutshell, Rust DKG, network listener or server mutation. |
| Separated topology, 19 tests | Production templates and verifier functions | Pure synthetic configuration/ownership metadata; no installed unit, account, listener or host. |
| Artifact rebuild | Actual Bun bundler and Go 1.23.1 compiler | Build/reproducibility only; it does not execute a live auction. |
| Successor install/adoption fixtures | Actual site, authority, coordinator, terminal and four signer placements; exact accepted predecessor files; real filesystem modes; atomic APP no-replace/exchange publication; retained unit, journal, receipt and installed role/runtime guards under `/tmp`. The real local `systemd-analyze verify` parser accepted all successor unit syntax. | Systemd state and daemon reload are controlled command fixtures; no host unit, account or service was changed. The fully ready configuration uses synthetic payment/genesis/downstream public pins, while the current real-input render remains inert. The parser warned, as expected, that production paths/dependencies are absent locally. |
| Loopback site smoke test | The rebuilt executable, its HTTP server, and four real local Comet processes. All four reached height 6 with one common block/app hash and four commit signatures; the served browser bundle matched the build byte-for-byte. | The local-demo profile explicitly reported `threshold_custody:false`, `browser_threshold_wallet_ready:false`, no FIPS transport and a legacy local mint URL. It did not exercise Coco, Nutshell, accepted validator shares, NIP-07 or a live auction. |

The new five-member runner test uses five distinct in-memory controllers. It
proves orchestration invariants and fail-closed behavior, not five real browser
profiles. No test reported in this side-quest used a real Nutshell mint,
threshold share process, NIP-07 extension, public HTTPS origin or remote host.

The repository's stronger throwaway integration harness was attempted once. It
stopped before readiness because this isolated source tree has no
`.venv/bin/mint` Nutshell executable. Its wrapper removed its temporary root;
no local mint, FROST journey or live-integration pass is claimed. The separate
local-demo root and its throwaway generated keys were also removed after the
read-only smoke test.

Separately from these local tests, the owner supplied a public projection of an
actual mint-only payment run. A3 accepted it as reported mint-only evidence in
`A3-MINT-PAYMENT-ACTUAL-PUBLIC-PROJECTION-RECONCILIATION-20261102.md`
(SHA-256 `9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da`).
That review independently checked the public keyset-ID digest, arithmetic,
operation set, timing and request caps. It did not read the raw receipt or
private proofs, independently recompute the reported receipt digest, or prove
threshold custody, browser auction behavior, HTTPS, genesis or deployment.
The authority renderer's actual receipt contract is only an owner-reviewed
file plus its exact byte hash; therefore the accepted public projection and
SHA-256 are sufficient for that contract without transferring private proofs.

A focused composed Go handler test resolves the later legacy assembly identity
to `http://127.0.0.1:8180/test-mint`: Go's validator accepts that private exact
path and rejects the public Cashu origin in the legacy slot; the actual site
handler returns 404/non-JSON there, while `/api/config` retains it separately
from `https://139.162.161.233`. This is a disabled namespace binding, not a
working mint route or payment test.

## Mint transport provenance

The accepted standalone content-encoding boundary is 13,305 bytes with
SHA-256 `8c73b38ab59fea98d0894d9b7a2ddd1e03207ae0568d0a2aca5bf173de594c15`
under `mint-r7-coco-content-encoding-fix-r2`. Its rebuilt bootstrap and payment
clients have SHA-256
`29d4a6d099257f926ccb2d8c7e4341f0a66623d8e405b3ce16aebecc829e364b`
and `31275a84fc8efd09a6f8c28db163067bf4a7e7f39480908b2682c28d027e394f`
respectively.

Those binaries are separate conformance consumers. The separated R4 auction
source imported for this side-quest did **not** contain the encoding correction:
`coco-rail.ts` only pinned origins and redirects, while the nginx mint route
forwarded browser `Accept-Encoding`. Therefore the first side-quest site binary,
SHA-256 `e4da15227b43e208aba8f57b92b9977a6f648e43af1c94bd3a7963f17ec67db0`,
did not incorporate the accepted correction.

This branch now adapts the accepted behavior into the real site consumers:

- `createOriginBoundMintFetch` and `createPinnedMintTransportFetch` apply native
  Request/init header replacement, force `Accept-Encoding: identity`, reject a
  non-identity response with the fixed
  `mint-response-content-encoding-refused` error, abort it and cancel its body
  within a bounded grace period;
- normal and recovery nginx mint routes clear upstream `Accept-Encoding`, which
  covers browsers where JavaScript cannot set that forbidden request header;
- focused Coco tests exercise the packed manager through the corrected fetch
  seam and verify header replacement, refusal, abort and cancellation.

The browser bundle and Go site binary were rebuilt, and so were the separate
baseline-target Bun executables that perform server-side mint reads: authority
SHA-256 `af51ff40ddafa496169cb15731c1ab8cf2b3b569f707dfd7f69719c9d294755d`,
terminal executor `630f63ed3549812d43f585aa019b20aa90ffa863119f5b505406eaa47a518460`,
and signer `00c448e172c13b1a9862cd97bf79608e879739c0cc44aba74019bc3df66739d9`.
Each contains the fixed refusal and identity-header boundary; consecutive
builds were byte-identical. These are local artifacts, not the currently
installed inactive release.

The coordinator was rebuilt as well (98,655,955 bytes, SHA-256
`2671bb59de2b8a63ffd34721f28c97b59098935503f322ac833b0339d6e6a777`)
to complete the application runtime set. It does not import the Coco mint
transport and is not evidence of a mint-path test. Two consecutive builds to
the canonical output path were byte-identical; Bun embeds the output path, so
an intentionally different output pathname produced different bytes and is
not treated as a reproducibility failure.

This establishes source-level adoption and local regression coverage. It is not
a live Nutshell or public-browser conformance result; those remain activation
gates.
