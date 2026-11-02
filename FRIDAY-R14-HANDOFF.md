# Friday R14 compact handoff

Date: 2026-10-23 UTC. Status: **source checkpoint plus completed FIPS-identity
stage; not deployment-ready**.

## Current immutable checkpoints

- Current source commit: `1431ab4b6ac2be58d6d7d69ec319255b210f8927`
  (tree `96f9f2c663ee7dce7eafd64de77395a324e4f6e9`).
- Atomic FIPS promotion helper integration: `a8b5372557e0ff298398ca98d910dcd11c082d63`.
- Signer pathname-race successor: `80f77f80c6723a680072725c014bed3ba551293d`;
  final owner-isolation/FD-lifetime successor: current `1431ab4...`.
- FIPS-identity-only action packet originated at commit
  `57bd60cb80c1630e8cadbff509c89bd61dc03530`; its final reviewed amendment moves
  the durable generation sentinel out of volatile `/run/lock` and into the
  root-only persistent operator directory. The amended packet is committed at
  `45855521109a9b5085c37d28be1e252be46c6366`. Use the current file hash
  recorded below, not the superseded `2f84cd25...` hash.
- Current `FRIDAY-FIPS-IDENTITY-R1-ACTION.md` SHA-256:
  `bcb4c6fd9993325c84aa13b0bb498f5b60988b87089f5a9f5b696783ecdb7c83`.
- Promotion helper SHA-256:
  `91ce335a08919a792f8ca8fd7ca0a4424cea8120522b0c30906368e5b2c672a9`.
- Unchanged FIPS binaries: `fips`
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`;
  `fipsctl`
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.

R13 remains the last complete artifact receipt:
`FRIDAY-CANDIDATE-R13-BUILD-RECEIPT.json`, SHA-256
`82951f4e854f2dc5a44f6c625facdc7b90d43334c979b2e3db6709a7a6dab7d6`.
Its application binaries predate the final signer repair and must not be called
R14 or deployed as the current application candidate.

## Evidence completed on current signer source

- signer executable pin + authenticated DKG V2 consumer: 8 passed, 0 failed,
  22 assertions;
- `tsc -p cashu-wrapper/ts/tsconfig.friday.json`: PASS;
- compiled local baseline signer proof:
  `/tmp/plebeian-friday-signer-1431ab4`, SHA-256
  `44dc6c4f9933b1364c48f75f86d4e27b703f2c7ddedb7961ba1f47c7233783c5`,
  size 99,114,763, mode 0755. This `/tmp` file is not a release artifact.
- promotion helper dummy fixture suite: 8/8 methods passed; Python compilation
  passed with bytecode redirected to `/tmp`.

The earlier restricted full Friday suite on predecessor `7bab6f3` reported
258 pass / 2 OS-child `EPERM` failures / 1017 assertions; the affected process
file separately passed 6/6 and 38 assertions in the ordinary runner. That full
suite has **not** been rerun on `1431ab4`; do not sum the overlapping counts.

The signer now keeps the authenticated participant inode open, executes only
`/proc/<signer-pid>/fd/<fd>`, and rehashes both the pinned inode and deployment
pathname before each Rust call. Live V2 additionally refuses a root signer and
requires the artifact owner (root) to differ from the runtime UID; the file is
single-link, executable and not group/world writable. Thus the service UID can
neither swap the executed inode nor write it in place. The retained FD closes
on startup callback failure and normal shutdown.

## Completed FIPS identity action

The owner approved the exact amended packet, and it completed sequentially on
all four demo hosts at 2026-10-23 15:03 UTC. Each host received only the three
hash-pinned FIPS identity artifacts and one host-local persistent FIPS
identity. No FROST, DKG, Comet, payment, mint, coordinator, browser or Nostr
key was created, and no service/listener/interface was started.

| slot | host | public FIPS npub | derived ULA | public receipt SHA-256 |
|---:|---|---|---|---|
| 1 | `linode-108175009` | `npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj` | `fd08:3b4:d506:649e:50ab:bcaf:4263:9cdf` | `8cd0c582c3538a86df7a06d80facc0d6f4a6189855c5bc4f5a64403c2927f734` |
| 2 | `linode-108236985` | `npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty` | `fd8d:74d8:4685:355:3df4:3595:f5cd:65c6` | `67c4f054bbb7d74aba5bf1fd197b909c10581e424254942d93fffce60137889d` |
| 3 | `linode-108237290` | `npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r` | `fdbc:58a:eabf:3991:adee:607f:fbc7:9b10` | `02bfe48861ae23bc3204f726fb7334fd293f64efd0c054648b32fa468776695b` |
| 4 | `linode-108237424` | `npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc` | `fd27:e968:2c52:42e4:50b9:4a2e:f665:aefe` | `be4527195d94a62329204ea6de6c81b5e28005bc4dbde3cb5a209914e21ff3be` |

On every host the final identity directory is service-owned mode 0700;
`fips.key` and `fips.pub` are single-link mode-0600 64-byte regular files; the
persistent generation sentinel is root-owned mode 0700; and its public-only
`complete.json` is root-owned mode 0600. Private/public address derivations
matched. All staging directories and short-lived promotion locks were absent
after completion. The destination copies matched the immutable `fips`,
`fipsctl` and helper hashes above.

The consolidated public-only evidence is
`evidence/friday-fips-identity-r1-20261023T150322Z.json`, SHA-256
`fe12001c74c973d7dd09374ac799187e6a0369f35517f719bd0b24e5a9569d24`.

The final post-check found zero Friday processes, no UDP-32121 listener and no
`fips0` interface on every host. Wednesday validator PIDs remained 91863,
65966, 65081 and 66255 for slots 1-4 respectively, with zero restarts. The
first V1 read-only preflight wrapper accidentally printed ordinary SSH-session
environment metadata because of shell argument grouping; it did not print
application data or private identity material, and no mutation had occurred.
The wrapper was corrected before the other hosts.

## Reviewer state and honest limits

- Independent review BLOCKED `7bab6f3` because it hashed then spawned by path.
  A first proc-FD successor preserved the inode but did not explicitly enforce
  a distinct unprivileged runtime owner. Independent re-review **ACCEPTS**
  `1431ab4` with no P0/P1/P2: it adds that boundary, closes the retained FD and
  routes every participant subprocess through the guarded proc-FD path.
- A4 accepted helper `ba4f3ba...` only with the outer action guards in
  `FRIDAY-FIPS-IDENTITY-R1-ACTION.md`: a distinct permanent root-controlled
  generation sentinel from before keygen, refusal of every stale staging
  entry, strict 1..256-byte key/public gates, no running service, pre/post ULA
  equality, and inspect-without-retry on ambiguity.
- The helper alone does not prove staging freshness, uses a 64-KiB internal
  bound, and can lose its short-lived promotion-lock name if unlink succeeds
  but its following parent fsync fails. The outer permanent generation
  sentinel and no-retry rule are mandatory. A separate adversarial review also
  noted that a privileged or same-service writer could mutate the same key
  inode between checks; the action excludes all Friday services during the
  operation but does not claim protection from a compromised root.
- Relay source remains FREEZE_WITH_MINOR_NOTES: it has no demonstrated
  reachable secret operation, but its artifact dependency graph is not proven
  secret-capability-free. Run the relay under a UID denied every participant
  private root.
- Live FIPS mesh, per-host DKG, four-validator Comet, FROST signer services,
  controlled mint, Coco browser journey, one-validator fault, prompt outbid
  import, anti-sniping and winner settlement are all **NOT_RUN** on current
  artifacts.
- Emergency unilateral timeout refund and own raises remain disabled.
  Selected-signer loss mid-session remains fail-stop until that same signer
  returns; one signer absent before selection is the narrower supported case.
- Fake sats only. No FIPS 140, production or real-value claim.

## Live host state last observed/reported

| slot | host | IPv4 | state |
|---:|---|---|---|
| 1 | `linode-108175009` | `172.105.64.142` | restricted Friday account/root plus persistent FIPS identity; no Friday service/listener/interface; Wednesday validator active, zero restarts |
| 2 | `linode-108236985` | `172.105.95.57` | prior inert R12 staging plus versioned FIPS tools and persistent FIPS identity; no Friday service/listener/interface; Wednesday active, zero restarts |
| 3 | `linode-108237290` | `172.104.240.217` | restricted Friday account/root plus persistent FIPS identity; no Friday service/listener/interface; Wednesday active, zero restarts |
| 4 | `linode-108237424` | `172.104.253.247` | restricted Friday account/root plus persistent FIPS identity; no Friday service/listener/interface; Wednesday active, zero restarts |

The final identity post-check completed at 15:03 UTC. Each host had at least
3.2 GiB available memory and 40 GiB free before the action. The owner reported UDP 32121 saved on all
three relevant firewalls from exactly the four demo IPv4 `/32`s, inbound drop,
outbound accept, no IPv6 allow. V2's separate firewall/443 attachment and IP
certificate were owner-confirmed earlier, but current certificate metadata and
live connectivity must be re-inventoried before use. No Friday FIPS, signer,
Comet, mint or application process is known running.

Wednesday data/services must remain untouched. A historical local loopback run
at 04:39 UTC created disposable keys/listeners outside the then-current
offline-only instruction; it is preserved as a procedural scope deviation in
`FRIDAY-LOCAL-LIVE-RUN-AUTHORIZATION-AUDIT.md` and is not FIPS/VPS acceptance.

## Private-key separation invariant

Every FIPS identity, Comet node/validator key, signer key and FROST share is
created and retained on its final validator only. Each DKG pairwise AEAD key
exists at exactly its two endpoints. V2 is participant 2, so it may hold
`1-2`, `2-3`, and `2-4`, but never `1-3`, `1-4`, or `3-4`. The coordinator may
see public records and recipient-specific ciphertext only. The rejected
central provisioning path must not be revived.

## Recovery boundaries

- FIPS identity: on any failure preserve the root generation sentinel,
  helper lock if present, staging/final identity and public metadata; inspect
  before any cleanup or retry. Never regenerate automatically.
- Per-host enrollment: recover only with dead recorded owner plus complete,
  authenticated staging/final output. Anonymous, partial, torn or conflicting
  state stays locked.
- DKG/signing: never reuse nonce/session state. Unknown mint/consensus outcomes
  stay pending until authenticated recovery; absence/time is not authority.
- Public rollback: disable new funding/admission while retaining the Friday
  origin, mint and exact recorded-operation recovery until every pending
  terminal outcome is complete. Never redirect Friday receipts to Wednesday.

## Exact next actions

An exact-current R14 artifact set is now built from clean source commit
`92ac5f9da93ee8790385e5a5a7541cc62be1ec2e` (tree
`2a0684937f939efcbd31725203d8b6360e99e1a9`). The Go binary embeds that
revision with `vcs.modified=false`; typecheck, 262/262 Friday tests and all Go
packages pass. Receipt `FRIDAY-CANDIDATE-R14-BUILD-RECEIPT.json` has SHA-256
`60e1b726f14fb3d610027b999523506d45585e3cd44dc961ee161c54947f8f71`.
The corrected full FIPS unit removes the unsupported logging option, permits
the required rtnetlink family and narrows writable state to the FIPS root.

Four exact public host pins are rendered under
`deploy/friday/dkg-enrollment-r14/`. The bounded next proposal is
`FRIDAY-R14-DKG-ENROLLMENT-ACTION.md`, SHA-256
`c8dfe80db4e25ae613ef944c6c2d0b80a4493d2e738105556490ebeb506a8477`.
It stages only four exact ceremony artifacts per host and creates only each
host's DKG, X25519 and signer-RPC identities. It starts no service and never
centralizes private material. Service activation remains blocked on the
missing coordinator initializer, strict initial manifest composer and signed
Comet/FundingAbort bootstrap tools enumerated in that packet.

1. Review the current checkpoint and completed identity evidence without
   mutation:

   ```text
   git show -s --format='%H %T %P' 1431ab4b6ac2be58d6d7d69ec319255b210f8927
   git show -s --format='%H %T %P' 45855521109a9b5085c37d28be1e252be46c6366
   sha256sum FRIDAY-FIPS-IDENTITY-R1-ACTION.md scripts/friday-fips-identity-promote.py \
     live-bin-friday-candidate-r13/fips live-bin-friday-candidate-r13/fipsctl
   ```

2. Preserve the four host-local identities and durable public receipts. Do not
   rerun identity generation. Render the owner-reviewed host pins from the four
   public records, and independently review them before any DKG action.
3. Separately perform a clean exact-current R14
   build/receipt, and run the full offline gate. Do not replace the FIPS-only
   identity packet with those application binaries.
4. Request separate, exact approvals for per-host enrollment/DKG, public-only
   Comet assembly, inert service staging, live mesh/acceptance, evidence review
   and finally public activation. None was authorized by the completed
   FIPS-identity-only action.

## Prepared FIPS mesh R1 packet (not executed)

The exact four-host transport configuration and a manual, acceptance-only
systemd unit are rendered under `deploy/friday/fips-mesh-r1/`. The local static
regression verifies four configs, four destination hash manifests and the
single common unit. The action boundary, dependencies, bounded public canaries
and reverse-order rollback are in `FRIDAY-FIPS-MESH-R1-ACTION.md`.

No mesh file has been copied to a host and no FIPS daemon, interface, listener
or route has been started. A separate owner action-time approval is required
for inert staging and the one bounded live mesh run. The packet deliberately
does not reuse the SSH wrapper that printed ordinary session environment
metadata during the first identity preflight.

The owner approved that action, but its 2026-10-23 15:19 UTC preflight stopped
before staging because the exact required `plebeian-friday.slice` was absent
on all four hosts. The packet required that pre-existing slice hash and did not
authorize installing it. Public identities and binaries matched, all four
Wednesday validator PIDs remained present, and the post-check proved the mesh
unit, manifest, config and verifier remained absent with no UDP-32121 listener
or `fips0`. No cleanup was needed. The public-only record is
`evidence/friday-fips-mesh-r1-preflight-20261023T152028Z.json`. A revised exact
approval including the already reviewed slice is required before retrying the
full preflight; absence alone is not permission to install it.

The follow-up read-only prerequisite audit found one more omitted staging
parent: `/etc/plebeian-auctions-friday` is absent on V1, V3 and V4. V2 already
has the reviewed root:`plebeian-friday` mode-0750 directory. The frozen packet
names a destination manifest below that root but did not explicitly authorize
creating the missing parent. The next amendment should therefore cover both:

- install the unchanged `deploy/friday/plebeian-friday.slice` as root:root
  mode 0644 on all four hosts, exact SHA-256
  `704133a7c0572d1bf8e2f73fc328773813605993170e9031f5c20af4d94018d6`;
- create only the missing `/etc/plebeian-auctions-friday` parents on V1/V3/V4
  as root:`plebeian-friday` mode 0750, and require V2's existing parent to
  remain byte-for-byte/metadata unchanged.

This was an A0/deployment-planning omission, not a remote failure. The slice
sets only the aggregate Friday cgroup boundary: `MemoryHigh=2G`,
`MemoryMax=2304M`, and `TasksMax=1024`. It has no CPU, I/O, route, listener or
Wednesday setting, and its `Before=` ordering does not start or enable any
service. The mesh unit retains its narrower `MemoryMax=160M` and `TasksMax=96`.

No other missing prerequisite was found: all hosts have systemd 255,
`sha256sum`, Python, systemctl/install/stat/ip/ss, `/dev/net/tun`, the
root-owned release parents, service-owned mode-0700 Friday state/FIPS/identity
parents, exact FIPS binaries and identities, and no existing mesh artifacts.
The verifier, per-host config, destination manifest and manual-only unit are
expected staging outputs already named in the approved packet. Their install
verification and `systemctl daemon-reload` are already within that packet's
steps 3-6 and the owner's approval to install the configs/manual-only service;
they do not need a separate scope expansion. A fresh SSH credential lifetime,
resource/process gate and complete preflight remain required immediately
before a later staging attempt.

The owner subsequently approved both missing prerequisites and one execution,
but the 2026-10-23 15:26 UTC staging attempt failed on V1 before destination
installation. A locally double-quoted SSH command expanded its remote
`$(sha256sum ...)` expressions on the workstation and corrupted the remote
command; the five public files had reached only the dedicated V1 `/tmp`
staging directory. Inspection proved the slice, config parent, unit, manifest,
config and verifier destinations were still absent, with no service,
UDP-32121 listener or `fips0`. The five public temporary files and their empty
directory were then removed under the approved cleanup boundary. A four-host
post-check proved every host unchanged and Wednesday PIDs 91863, 65966, 65081
and 66255 still present. No automatic retry occurred. See
`evidence/friday-fips-mesh-r1-action-attempt-20261023T152740Z.json`.

This is a procedural execution failure, not a mesh result. A future separately
approved retry must use argument-safe/single-quoted remote commands and repeat
all gates; the previous approvals must not be treated as an automatic retry
loop.

The owner approved one retry after a structural command fix. Commit
`e669b05f43120b1d029710176c89f6d2ee157e1a` sends the literal reviewed remote
script to `/bin/bash -s --` on stdin and passes all varying values as separate
positional arguments. A fake-SSH capture proved literal command substitutions,
positional argv and no local environment output. The three file hashes are:

- remote script `65f79404952b77659cf2210111f9d88ce6cc861ab1bf2c8f4c2ef01e3b3d98cf`;
- controller `f7d4d73442701056b797e455a544e4428ad5d5982cb76444a41680dc21450d89`;
- regression `85d9644a18ab3a7094e5bf55879f1fbd930ca45195437088df42e1609e60c481`.

That retry staged and verified all four hosts successfully, but the mesh did
not establish. The reviewed systemd unit passed `--log-file` to pinned FIPS
0.5.2, whose executable accepts only `--config <FILE>`. Each daemon exited
immediately with status 2, before creating `fips0`, UDP 32121, a control socket,
a route or a log. No probes ran. Reverse `systemctl stop` completed V4, V3, V2,
V1. Final inspection found no process/interface/listener/socket on any host;
Wednesday validators remained active at PIDs 91863, 65966, 65081 and 66255
with zero restarts. The static mesh unit remains in `failed` state to preserve
evidence; it was not reset or retried. Exact evidence is
`evidence/friday-fips-mesh-r1-retry-20261023T153530Z.json`.

The slice, config parents, static unit, verifier, destination manifests and
per-host `fips.yaml` remain installed as approved. A successor requires a new
reviewed unit without the unsupported option, refreshed unit/manifest/action
hashes, offline validation and a new action-time approval. Do not edit the
live unit, reset its failure state or infer transport readiness from staging.

The local successor removes only the unsupported `--log-file` daemon argument;
FIPS stdout/stderr remains journal-captured and no replacement file-logging
permission is added. A new CLI-contract regression executes the pinned daemon
and CLI help for every used option, verifies GNU `sha256sum --strict --check`
and Python `-I -S -B`, and checks the exact unit/remote command text. Static
packet, fake-SSH construction and CLI-contract regressions all pass. Both the
original builder and independent packet review missed this executable CLI
compatibility check; source inspection and manifest hashes alone were
insufficient.

The previous four-hour SSH identity lifetime began around 11:39 UTC and is
expected to have expired around 15:39 UTC. Any later approved run must require
the owner to reload the existing key and must revalidate its exact fingerprint
and fresh remaining lifetime before staging or startup.

The owner reloaded the existing SSH identity and approved one run of the
independently reviewed corrected packet. Commit
`3d9191bcfdaa0c619f4a8787b18a9339baa20627` removes the unsupported daemon
argument and binds action SHA-256
`e70d0958ba77c1439ccbbcff6810adb4ce75e2b29c8257f559292f02f775968f`
to unit SHA-256
`15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051`.
The safe replacement helpers are commit
`8b9a53cc5d757a8cf08f014cb9ce26bb3033a664`.

Fresh identity, host-key, packet-integrity, Wednesday-process and resource
gates passed on all four hosts. All four FIPS 0.5.2 services started, exposed
only their expected UDP-32121 underlay listener, created `fips0` at MTU 1280,
and independently reported three authenticated peers, three authenticated
links and an estimated four-node mesh. All four inspections passed and
observed the same root. Twelve directed ten-second probes ran concurrently.
Eleven returned `overall: ok`. V3 to V1 returned `overall: partial` and exit 1:
the direct authenticated session, path and MTU were valid, but both RTT reports
were `sub_millisecond`, leaving zero numeric samples; the diagnostic therefore
classified the probe as partial after 4087 ms.

Accordingly, transport establishment is demonstrated, but the packet's strict
12-of-12 acceptance result is **FAIL (11/12)**. No retry was performed. Reverse
shutdown completed V4, V3, V2, V1. Final four-host checks prove the Friday
units inactive/dead with PID 0, zero restarts and successful result; `fips0`,
UDP 32121 and control sockets absent; and original default routes restored.
Wednesday validators remain active/running at PIDs 91863, 65966, 65081 and
66255 with zero restarts. Exact public-only evidence is
`evidence/friday-fips-mesh-r1-corrected-20261023T154646Z.json`.

Do not call this full deployment readiness. An independent decision is needed
on whether `sub_millisecond` is an acceptable successful RTT observation or a
narrow probe-classifier fix plus separately approved acceptance run is needed.
Payment, DKG, Comet, signer, mint and browser application services were not
started by this transport-only action.

