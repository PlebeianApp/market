# Isolated local FIPS lab — bounded approval manifest

Status: **source-prepared, inert, not approval-ready, not executed**. Updated
2026-10-22 UTC.

This is the withdrawn R1 proposal. The replacement executable boundary and
the concrete reason no R2 approval can yet be requested are recorded in
`FIPS-LOCAL-LAB-R2-EXECUTABLE-SPEC.md`. In particular, R1's null application
pins name entry points that do not all exist as runnable artifacts; filling the
nulls with unrelated binaries would be a refusal-worthy protocol substitution.

The earlier broad request remains withdrawn after independent static review.
No response to that request authorizes a lab. The exact controller and capture
helper now exist as source, but `FIPS-LOCAL-LAB-EXECUTION.json` deliberately has
`approval_ready: false`; six application/FROST binary hashes are null. The
controller refuses before preflight or mutation while either condition holds.
Every privileged namespace/FIPS command remains forbidden.

This is preparation only for one ephemeral, fake-money integration run on the
local development host. It does not authorize a VPS change, public listener,
host firewall change, persistent credential, system service, deployment, DNS
change, real funds, or acceptance/bypass of sealed R4.4.5.

## Prepared source snapshot

This lab preparation is separate from reviewed integration commit
`b9f3d48c8cd09393d8a130e793f1707bc02fded9`:

- `scripts/friday-fips-lab.py` SHA-256
  `c7b3a55d00cb3fd27c40530f9a62fce028b8e366e11b4f6ad90467c7ec31d306`;
- `scripts/friday-fips-capture.py` SHA-256
  `fc84886b96da0fe06ea0b135a1d9afb8f27017ae3504ecaa860686cbfac77e3d`;
- current inert `FIPS-LOCAL-LAB-EXECUTION.json` SHA-256
  `9031c215f9739b1f01a0bce68a69ec455edc3f617fddd0fb716cf20201384516`.

These are preparation hashes, **not an executable approval bundle**. The JSON
hash must change when its missing binary pins are filled. This source has not
been compiled, executed, or independently reviewed.

## Future one-run root entry point

The only proposed root entry point has exactly this shape, with the later
approval-ready manifest hash substituted for `MANIFEST_SHA256`:

```text
/usr/bin/python3.12 -I -S /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab.py --manifest /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-EXECUTION.json --expected-manifest-sha256 MANIFEST_SHA256 --expected-harness-sha256 c7b3a55d00cb3fd27c40530f9a62fce028b8e366e11b4f6ad90467c7ec31d306
```

There is no root shell, caller-controlled command, caller environment, PATH
lookup, alternate run root, retry flag, cleanup wildcard, or caller-selected
network. The controller uses an empty environment for every child. It verifies
its own bytes, manifest bytes, every source/application binary, hostname,
kernel, uid/gid, exact paths and fixed topology before mutation. Any mismatch
refuses the run.

## Exact host and installed software

- Host: `DESKTOP-P59VRK7`, Linux
  `6.6.87.2-microsoft-standard-WSL2`, x86_64.
- Application uid/gid: `maximoto`, `1000:1000`.
- `/usr/bin/fips`: jmcorgan/fips `0.5.2` revision `53a3ec4b2f`, SHA-256
  `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`.
- `/usr/bin/fipsctl`: same revision, SHA-256
  `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`.
- Exact installed hashes for Python 3.12, `ip`, `nft`, `setpriv`, `ss` and
  `env` are recorded in the inert JSON manifest.
- No package installation, upgrade, download, system service, or edit under
  `/etc/fips` is proposed.

The first privileged action is read-only preflight: list namespace names,
root links/listeners, and hash the host nftables ruleset. It refuses before
creating anything if a fixed namespace/link/port conflicts or either evidence
destination already exists.

## Exact isolated topology

Five fixed Linux network namespaces:

- switch only: `poc-friday-fips-sw`;
- nodes: `poc-friday-fips-n1`, `poc-friday-fips-n2`,
  `poc-friday-fips-n3`, `poc-friday-fips-n4`.

The switch namespace contains bridge `br0`, with no address. Each node has
`under0`; its bridge peer is `sw1` through `sw4`. The RFC 2544 underlay is:

| node | address |
|---|---|
| n1 | `198.18.242.1/29` |
| n2 | `198.18.242.2/29` |
| n3 | `198.18.242.3/29` |
| n4 | `198.18.242.4/29` |

There is no host bridge address, default route, NAT, forwarding, physical link
or public-interface attachment. Each node has only `lo`, `under0`, and its
daemon-created `fips0`. The only IPv4 route is the connected
`198.18.242.0/29 dev under0`. No namespace can reach an external service.

FIPS uses a static full mesh over UDP/32121. Nostr rendezvous, relay/STUN,
mDNS/LAN discovery, DNS, TCP transport and gateway mode are explicitly
disabled. Each daemon uses a separate control socket and `XDG_RUNTIME_DIR`
under the fixed run root; `/run/fips` is never selected.

## Exact listeners and namespace filters

- FIPS underlay UDP/32121 on each exact `198.18.242.N` address.
- Validator P2P TCP/26656 on each derived `fips0` ULA.
- Validator RPC TCP/26657 on loopback inside each node.
- SignerRPCV1 TCP/39101 on each derived `fips0` ULA.
- Any fake mint/coordinator used by the integration driver remains loopback in
  n1; no host listener or external backend is allowed.

No listener may bind a WSL host address, wildcard host socket, VPS, port 80,
443, 8443, or a public interface. Each node gets an ephemeral namespace-local
nftables table: loopback and established traffic, exact four-address UDP/32121
underlay, ICMPv6 on `fips0`, Comet TCP/26656 among the four derived ULAs, and
Signer TCP/39101 only from n1's derived ULA. Default input/output is DROP. The
host ruleset is only read and hashed, never modified.

## Literal executable and privilege scope

The pinned controller may construct only the following operation classes; all
executables are absolute and individually hashed in the approval-ready JSON:

1. Read-only `ip netns list`, `ip -o link show`, `ss -H -ltnup`, namespace
   link/route/counter inspection and `nft list ruleset`.
2. `ip netns add|delete` for the five exact names.
3. Fixed bridge/veth creation, movement, rename and link-up commands for only
   `br0`, `pff1`–`pff4`, `under0` and `sw1`–`sw4`.
4. Fixed `ip addr add` for the four addresses above and namespace-local
   `/usr/sbin/nft -f <fixed node path>`.
5. Four exact `/usr/bin/fipsctl keygen -d
   /tmp/plebeian-friday-fips-lab.20261022-r1/node-N` and four exact
   `fipsctl address -k .../fips.pub` calls. They run uid/gid 1000, cleared
   groups, zero capabilities and `no_new_privs`, never `--stdout`/`--force`.
6. Four exact FIPS daemon processes, four capture processes, four validator
   processes, four signer processes, one DKG tool and one integrated driver.
   Their arguments point only at fixed files under the run root.

Privilege boundaries are enforced and checked through `/proc` after exec:

- FIPS: uid/gid 1000, cleared groups, `no_new_privs`, only
  effective/inheritable/ambient/bounding `CAP_NET_ADMIN`, inside its node netns.
- Capture helper: uid/gid 1000, only `CAP_NET_RAW`, inside its node netns. It
  counts/hashes UDP payloads and scans two public test markers; it never saves
  packet bytes.
- Validator, signer, DKG, driver, FROST participant and inspector: uid/gid 1000,
  all capability sets empty, `no_new_privs`.
- Root: only the single SHA-pinned Python controller for namespace lifecycle,
  exact child launch, verification and cleanup. No unspecified root test
  process or shell fragment is permitted.

No `sysctl`, IP forwarding, host route/address, host firewall/UFW change,
`setcap`, systemd unit, `/etc` write, module load, new mount namespace, provider
API, SSH, DNS or public network operation is proposed.

Unavoidable temporary host changes are explicit: `ip netns add` creates five
named netns runtime entries; each veth pair exists briefly in the host netns
between creation and movement. Bridge, addresses, routes, namespace nftables,
FIPS TUNs, sockets and application listeners otherwise exist only inside the
five namespaces. The root controller itself has root for the bounded run; no
application child does.

## Ephemeral keys and lifetime

The single run root is
`/tmp/plebeian-friday-fips-lab.20261022-r1` mode 0700. It contains:

- four FIPS identities (`fips.key` 0600, `fips.pub` 0644);
- four separate configs/runtime directories/control sockets;
- fresh throwaway Comet node/validator keys;
- fresh throwaway 3-of-4 DKG shares and application authentication keys;
- PIDs/start ticks, bounded logs and non-secret evidence.

No key exists until the later approved run. It is never copied to a VPS,
repository, chat or evidence. The run has a 3600-second monotonic ceiling.
Normal/error cleanup stops only process groups whose PID and `/proc` start ticks
match the controller's records, deletes the five exact namespaces, then removes
only the exact run root after its exclusive ownership marker is verified.
Filesystem unlink is not claimed to be forensic secure erase.

If the host/controller dies before cleanup, the normal controller refuses to
reuse the root or evidence names. Any leftover cleanup requires a new exact
inspection and approval; it is not silently folded into a retry.

## Evidence and cleanup verification

Success evidence requires all of the following, not merely ULA labels:

- four distinct owned FIPS, validator and signer process identities;
- exact uid/gid, executable hashes, start ticks and netns inode;
- advancing `under0` and `fips0` RX/TX byte counters on all four nodes;
- UDP/32121 underlay frames and bytes, with zero plaintext marker matches and
  no raw packet persistence;
- SignerRPC and Comet sockets owned on `fips0`;
- direct underlay connection refusal for both application ports;
- one real 3-of-4 threshold signature with one signer unavailable;
- an actual fake-mint settlement and recipient proof import;
- operation/Comet/signer digests joined in `DemoFipsMeshEvidenceV1`;
- identical host nftables hash before/after.

Cleanup verifies all owned processes are stopped, no target namespace/PID
remains, all five namespace names are absent, no reviewed lab port appeared in
the host namespace, the host nftables hash is unchanged, and the exact run root
is absent. Incomplete cleanup fails the run and reports the exact remaining
object; no second run starts.

## Missing prerequisites before any approval request

1. Independently review the final local outbid-return candidate and its executed
   evidence. The candidate now passes ordinary unprivileged gates, but this lab
   controller/configuration has not been updated or reviewed against that exact
   commit.
2. Build validator, DKG, signer, integrated driver, Rust participant and public
   inspector from that reviewed source.
3. Populate their six exact SHA-256 pins and set `approval_ready: true`.
4. Recompute the manifest hash and independently review the controller, capture
   helper, generated FIPS/nft configs, literal argv and capability behavior.
5. Request one informed, one-run approval using the new commit and hashes.

Until all five occur, the lab is not runnable and this document asks for no
approval.

## Selected fake-money payment rules exercised later

- An auction pool contains exactly the current bid amount. Own raises carry the
  old proofs plus a separately admitted top-up into a new exact pool.
- Admission binds committed leader/history, zero-fee keyset, exact proof Ys,
  exact winner/return SIG_ALL packages, DKG run/package/roster and operation
  identity; proof use is globally unique.
- Certified displacement is H plus canonical H+1/H+2. An offline outbid bidder
  has pre-signed the exact cooperative full-pool return; the 3-of-4 committee
  may submit it, but value remains pending until the fake mint and recipient
  import are terminal.
- Emergency unilateral recovery locktime is original end + 1800-second maximum
  extension + 900-second recovery budget. Committee MAIN creation stops 300
  seconds before it.
- A prior MAIN signature is not revoked by locktime. If MAIN and REFUND race,
  the first valid fake-mint spend wins; there is no claimed refund priority and
  the losing branch is never paid afresh.
- All value is worthless fake-mint value. Four machines/signers remain one
  operator. “FIPS” means jmcorgan/fips transport, not federal compliance.

The earlier 36/36 threshold-authority/template result is historical and was not
commit-exact. It does not cover `b9f3d48`, the later reviewer repairs, this lab
source or any privileged/network execution.
