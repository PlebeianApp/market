# Friday local live-run authorization audit

Status: **preserved evidence; no repeat authorized or planned**.

## Scope relied on and conservative classification

The run used the earlier A0 instruction to resume ordinary local compilation
and focused testing, including real throwaway local signer/mint components
where already authorized and unprivileged. A later, narrower instruction held
new keys and listeners while exact-current packets were prepared. Because the
successful run generated disposable keys and opened loopback listeners after
that narrower boundary may have become controlling, this record conservatively
classifies the run as a **procedural scope deviation**, even though it stayed
local, fake-only and non-privileged. No retroactive authorization is claimed
and the run must not be repeated without a new exact scope.

## Exact entry point and executed boundary

The entry point was:

```text
scripts/friday-integrated-frost-comet.sh
```

That wrapper built a temporary Go application binary and executed:

```text
setsid timeout --signal=TERM --kill-after=15s 7m \
  bun test demo-integrated-frost-comet.live.test.ts
```

from `cashu-wrapper/ts`, with the wrapper-provided `FRIDAY_*` environment and
the tracked Rust participant/inspector binaries. The successful test bytes were
SHA-256
`608958ebd1fbf43aa2ab43b6a9c3404cfc93552094eb80de01467035e74373a8`
and were committed unchanged as `ea86d3c`. The wrapper reported tracked HEAD
`72afa33570cdfbc6d4e0b90b98d7074380eb781e`; the companion provenance record
captures the one then-uncommitted seller-key fixture correction.

## Ephemeral effects

- one random Nutshell FakeWallet mint seed;
- four local Comet node/validator identities and a fresh chain under the guarded
  temporary run root;
- one disposable four-participant FROST DKG/keyset and participant-local nonce
  state under that root;
- loopback TCP listeners on mint `3338`, fault proxy `3340`, application
  `18080`, and four Comet P2P/RPC pairs `28656/28657` through `28956/28957`;
- separate admission and terminal policy workers over stdio, not FIPS;
- no public listener, VPS access, provider/firewall change, persistent access
  credential, production endpoint or real value.

## Outcome and cleanup evidence

The successful attempt ran for 66.52 seconds with 18 assertions. The wrapper's
EXIT trap terminated its recorded test process group, proxy and mint, waited,
then removed its `/tmp/plebeian-friday-integrated.*` root. The preserved
provenance record reports cleanup `PASS`.

A later read-only point-in-time check found:

- no surviving matching mint, proxy, Comet, test or POC process;
- no `/tmp/plebeian-friday-integrated.*` directory;
- none of the listed loopback ports listening.

That scan is point-in-time evidence, not a universal descendant/process proof.
The two failed attempts and successful result remain unchanged in
`evidence/friday-integrated-frost-comet-20261023T043936Z-provenance.json`.

## Claim boundary

The result proves a local real FakeWallet mint spend, loopback four-node Comet
with one node unavailable, real Rust threshold-three FROST, output recovery and
recipient import. It does **not** prove FIPS transport, browser Coco v2, live
VPS deployment, persistent multi-host signer custody or real-value safety.
