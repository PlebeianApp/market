# Friday FIPS local lab R3 — executable boundary

Status: **READY FOR EXACT ACTION-TIME APPROVAL; PRIVILEGED R3 NOT RUN**.

R3 changes only the privileged lab controller boundary. It reuses the exact
R2 application binaries and fake-mint dependencies from application commit
`96c81d8e23602fc9126e63cc6e05ce1f87a56ebc`. The independently reviewed R3
controller snapshot is commit
`888be41b516d527373e66459dbaae18e93ddd617`.

## Corrected ownership model

- An unrelated host `fips0` may predate the lab. It is never a cleanup target.
  R3 records a canonical digest of its stable link and address configuration
  before and after the run, excluding only enumerated counters, carrier state,
  operational state and address lifetimes.
- Only `fips0` inside each of the four fixed node namespaces is lab-owned. R3
  requires it to be a TUN rather than TAP, bind exactly the derived IPv6 ULA
  `/128`, and have no other non-link-local address. Evidence binds namespace
  device/inode, interface ifindex, ULA digest and stable link-metadata digest.
- The fixed `/tmp` run-root entry stays root:GID-1000 mode 0770 and its marker
  stays root:root mode 0600. The controller records both device/inode identities
  under a blocked signal window. It removes the tree only when identity,
  ownership, modes and marker contents still match and no lab namespace remains.
- Namespace device/inode and temporary host-veth ifindex are recorded under
  blocked SIGINT/SIGTERM windows. Cleanup refuses deletion when an identity has
  changed. A partially created but unrecorded object is left for inspection,
  not guessed or removed.

The residual check-then-delete interval assumes this one controller is the only
root or `CAP_NET_ADMIN` actor changing these fixed lab namespaces and links.
Any concurrent privileged network administration invalidates the run and must
be excluded for the bounded window.

## Inherited real-mechanics proof

The executable path is unchanged from R2: four real Comet validators in
separate namespaces; four distinct FROST shares with a real 3-of-4 signature;
the fourth signer and validator unavailable after verified readiness; actual
jmcorgan/fips encrypted transport; Nutshell 0.19.2/FakeWallet; a real Cashu
SIG_ALL cooperative outbid return; response loss followed by NUT-07/NUT-09
recovery and recipient proof import. Application children run as UID/GID 1000
without capabilities. Only each namespace's FIPS child retains
`CAP_NET_ADMIN`; only capture retains namespace `CAP_NET_RAW`.

This is fake money and one operator. It is not federal FIPS compliance, FROST
production custody, independent operators, HA, or permission to bypass sealed
R4.4.5 gates.

## Honest limitations

- This exact executable proves only cooperative outbid return. Winner payout,
  reserve-unmet return and the emergency MAIN-versus-REFUND first-spend race
  remain outside this privileged run.
- The R3 focused regressions are mocked/unprivileged controller tests. They do
  not replace the privileged namespace/FIPS execution.
- The manifest pins every invoked executable and the complete staged Nutshell
  site-packages tree, but the host Python standard library, ELF interpreter and
  dynamically loaded host shared libraries are not individually copied or
  hashed. The run is host/kernel-bound, not a fully hermetic userspace image.
- SIGKILL or host death can strand lab objects. That requires read-only
  inspection and separately approved cleanup; it does not authorize a retry.
- The preserved R2 failure and `/var/lib/...r2...` staging are not modified or
  removed by R3.

Exact pins and inherited build provenance are in
`FIPS-LOCAL-LAB-R3-BUILD-RECEIPT.json`; exact root actions are in
`FIPS-LOCAL-LAB-R3-STAGING-RECIPE.md`.
