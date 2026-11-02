# Friday FIPS mesh R1 action boundary

Status: **approval-ready local packet; not staged or executed**.

This is a transport-only acceptance stage. It may stage one exact FIPS config
and one disabled acceptance unit per demo validator, start the four FIPS
daemons for one bounded mesh check, and stop them again. It does not generate
an identity, run DKG, start Comet/FROST/Cashu/browser services, initialize a
database, or enable a boot-time unit. Wednesday remains running and untouched.

## Bound source and public identities

The identities were created once under the separately approved R1 action and
are recorded by source commit
`96133e0438fa98b808ee2a22c148f19c4bebe233`. The consolidated public-only
identity evidence is
`evidence/friday-fips-identity-r1-20261023T150322Z.json`, SHA-256
`fe12001c74c973d7dd09374ac799187e6a0369f35517f719bd0b24e5a9569d24`.
This action must revalidate those exact public values without reading,
printing, hashing, copying, chmodding or replacing a private key.

| slot | host | underlay IPv4 | FIPS public npub | expected FIPS ULA |
|---:|---|---|---|---|
| 1 | `linode-108175009` | `172.105.64.142` | `npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj` | `fd08:3b4:d506:649e:50ab:bcaf:4263:9cdf` |
| 2 | `linode-108236985` | `172.105.95.57` | `npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty` | `fd8d:74d8:4685:355:3df4:3595:f5cd:65c6` |
| 3 | `linode-108237290` | `172.104.240.217` | `npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r` | `fdbc:58a:eabf:3991:adee:607f:fbc7:9b10` |
| 4 | `linode-108237424` | `172.104.253.247` | `npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc` | `fd27:e968:2c52:42e4:50b9:4a2e:f665:aefe` |

The owner has reported that UDP 32121 is saved on the three relevant provider
firewalls from exactly these four IPv4 `/32` sources, with inbound drop,
outbound accept and no IPv6 allow. This is configuration evidence, not a
claim that live transport has passed.

## Exact local packet

| file | SHA-256 |
|---|---|
| `deploy/friday/fips-mesh-r1/plebeian-friday-fips-mesh-r1.service` | `15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051` |
| `deploy/friday/fips-mesh-r1/v1-fips.yaml` | `3a6ad2b8d516d4626d84a77f897fd5af3d16976917e652524284147d3ef4b8af` |
| `deploy/friday/fips-mesh-r1/v2-fips.yaml` | `cdf221427637be9df22abbb4724ba42f36966f0165b89ab4658da961a6d4a483` |
| `deploy/friday/fips-mesh-r1/v3-fips.yaml` | `33a9693bfde2f705f6bb40d41014a0c46b9e538923b987ea5c7370d3f3ee0770` |
| `deploy/friday/fips-mesh-r1/v4-fips.yaml` | `4a40d565c5b71e33adeec3747ae899b39498de474ef516b413b115f7a1c6a370` |
| `deploy/friday/fips-mesh-r1/v1-fips-mesh-r1.sha256` | `118bda4c289e934ffd09789fc4c28ff28002518d3adb41a56801c45a19b16ea6` |
| `deploy/friday/fips-mesh-r1/v2-fips-mesh-r1.sha256` | `c01aa2a7690fba6267d29c7d1a2486961d3da14d9fd3c40fbe5c8a8d798d7bba` |
| `deploy/friday/fips-mesh-r1/v3-fips-mesh-r1.sha256` | `b1d3ff6a1363e0edd77fd7d6d0c1b4da5b25bf97fae3e42046c09758093479e9` |
| `deploy/friday/fips-mesh-r1/v4-fips-mesh-r1.sha256` | `d7c7644d612b0ca1f7bf388af4102b688bf2ff4d911097fd7727ea5d90748d7b` |
| `scripts/friday-fips-mesh-r1-regression.py` | recorded in the frozen commit receipt |

Each YAML binds the local public IPv4 UDP-32121 socket, disables Nostr/LAN
rendezvous and DNS, creates only `fips0` with MTU 1280, and names exactly the
other three peers by their pinned npub and public IPv4. No default route, DNS,
NAT, forwarding or public TCP listener is configured.

The acceptance unit is deliberately absent from `[Install]`, has `Restart=no`,
and conflicts with the later full `plebeian-friday-fips.service`. It runs as
the existing `plebeian-friday` service user, in `plebeian-friday.slice`, with
`NoNewPrivileges=yes`. Its ambient and bounding sets contain only
`CAP_NET_ADMIN`. Systemd applies that capability boundary to the two pinned,
root-owned `ExecStartPre` executables as well as the daemon; the preflights do
not use it, but this packet does not falsely claim they lack it. The unit may
write only below `/var/lib/plebeian-auctions-friday/fips`, and its permitted
address families are `AF_INET`, `AF_INET6`, `AF_UNIX` and the `AF_NETLINK`
needed by the pinned daemon for TUN/address/route management. Its `MemoryMax`
is 160 MiB and `TasksMax` is 96.

Pinned FIPS 0.5.2 exposes only `-c`/`--config`, `--help` and `--version`.
The unit therefore invokes exactly `fips -c <reviewed-config>` and uses no
assumed file-logging option. Daemon stdout/stderr is captured by systemd's
journal. This packet creates no separate FIPS log file and grants no additional
log-directory write access.

## Already-installed dependencies that must match

No package install or download belongs to this action. Each host must already
have:

- `/dev/net/tun` and systemd;
- `/usr/bin/sha256sum` and `/usr/bin/python3`;
- `fips` SHA-256
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`;
- `fipsctl` SHA-256
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`;
- identity verifier SHA-256
  `5753d4c95aa55ec91ecb1ac0be0b4729f65808cee59f59431fb9d5f327295808`;
- slice SHA-256
  `704133a7c0572d1bf8e2f73fc328773813605993170e9031f5c20af4d94018d6`;
- the exact existing identity directory and public receipt for that slot.

The daemon and CLI remain at
`/opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/`.
The verifier is staged root-owned mode 0755 at
`/opt/plebeian-auctions-friday/releases/fips-mesh-20261023-r1/scripts/`.
No dynamic PATH lookup is used.

## Exact future staging changes

These changes require a separate owner action-time approval. They have not
been made.

1. Recheck the pinned SSH key and host key, host/boot identity, destination
   absence, installed hashes, service account, identity receipt, `/dev/net/tun`,
   UDP-32121/fips0 absence, memory/free space, and Wednesday validator PID and
   restart count. Stop on any mismatch or authentication denial. Do not print
   the remote session environment; the first identity-stage preflight used an
   incorrectly grouped shell wrapper that printed ordinary SSH-session
   metadata and must not be reused.
2. Refuse any running Friday process, enabled Friday unit, UDP-32121 listener,
   `fips0` interface, default-route delta, or existing destination that does
   not match the exact packet.
3. Install the common unit at
   `/etc/systemd/system/plebeian-friday-fips-mesh-r1.service`, root:root 0644.
   Install the identity verifier at the versioned path above, root:root 0755.
   Require the existing `plebeian-friday.slice` to match its exact hash; do not
   replace a mismatch.
4. Install only that host's YAML as
   `/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml`, owned by the
   local `plebeian-friday` UID/GID, mode 0600. Its parent and existing
   `fips.key`/`fips.pub` stay service-owned mode 0700/0600 and are not changed.
5. Install only that host's destination manifest as
   `/etc/plebeian-auctions-friday/fips-mesh-r1.sha256`, root-owned,
   group-readable by the local service group, mode 0640. Create no other
   config, state, key, route or unit.
6. Run `systemctl daemon-reload`, then prove the acceptance unit is disabled,
   inactive and has `Restart=no`. Do not enable or start it during staging.

## One bounded mesh acceptance run

This run is also separately approval-gated. Start hosts serially V1, V2, V3,
V4 only after all four inert stages pass. Before every start, recheck the
installed hashes, identity receipt, Wednesday PID/restart count, available
memory, absence of OOM evidence, and that the host has no unrelated root or
`CAP_NET_ADMIN` test campaign. A partial mesh while later hosts are still
stopped is expected; no application service may depend on it yet.

Within 90 seconds after V4 starts, require on every host:

- `plebeian-friday-fips-mesh-r1.service` active, `NRestarts=0`, with one
  identity-matched main PID and no unexpected descendants;
- exactly one UDP-32121 listener bound to that host's pinned public IPv4;
- one `fips0` TUN interface, MTU 1280, with exactly its pinned ULA `/128` and
  no unexpected global address;
- `fipsctl -s /var/lib/plebeian-auctions-friday/fips/control.sock show status`,
  `show peers`, `show links`, `show transports`, `show routing`, and
  `acl show` report the pinned local identity and exactly the three pinned
  authenticated peers;
- after all four peer sets are authenticated, launch the twelve ordered
  host-to-peer probes concurrently (one process for each directed pair), each
  using the exact bounded command
  `fipsctl -s /var/lib/plebeian-auctions-friday/fips/control.sock probe --json --timeout 10 <peer-npub>`,
  and require all twelve to finish successfully within the same 90-second
  acceptance window; and
- IPv4/IPv6 route snapshots have no new default route, no changed underlay
  route and no new IPv4 route. Every new IPv6 route must be non-default,
  destination-limited to `fd00::/8`, and use `fips0`.

Record only public identities, peer/link state, bounded counters, unit/PID
metadata, interface/address/route metadata and command exit status. Do not
capture packet payloads, private keys, process environments or application
data. If any assertion misses its bound, stop the acceptance run; do not
weaken the assertion or extend the campaign automatically.

## Normal rollback and uncertain outcomes

Normal completion stops the acceptance unit in reverse order V4, V3, V2, V1,
waiting at most the unit's 15-second stop timeout per host. It then requires:

- no acceptance/full Friday FIPS process or unexpected descendant;
- no UDP-32121 listener, `fips0`, control socket or new FIPS route;
- the pre-run default/underlay routes unchanged;
- all Wednesday validator PIDs unchanged with zero additional restart;
- all four private identities and public receipts unchanged; and
- no Friday application, DKG, Comet, signer, mint or browser service started.

The versioned binaries, public packet, exact config, disabled unit, identity,
public receipt and sanitized run evidence may remain for the next reviewed
stage. No private identity is deleted or regenerated.

On a timeout, disconnect, failed stop, PID/start-time mismatch, unexpected
route/interface, uncertain service state or host reboot, do not issue a broad
kill, delete `fips0`, remove routes, regenerate keys, retry, or proceed to
DKG. Preserve state, perform read-only inspection, and obtain a separate exact
cleanup approval.

## Explicit exclusions and next gate

This packet does not authorize or claim Comet BFT, 3-of-4 FROST, DKG,
pairwise-key exchange, Cashu/Coco, browser funding, settlement, anti-sniping,
fault injection, public activation, real funds, FIPS 140 compliance, or live
deployment readiness. It does not touch production or any Wednesday path,
unit, port, key, state or route.

Only a separately approved and successful mesh run may supply the four exact
FIPS-ULA transport facts for the later per-host DKG and validator service
packet. R13 application binaries predate final source; a clean R14 application
artifact receipt remains a separate prerequisite and is not silently covered
by this transport action.
