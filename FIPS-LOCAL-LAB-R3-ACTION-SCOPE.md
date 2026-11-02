# Friday FIPS R3 exact action-time scope

Status: **READY TO REQUEST OWNER APPROVAL; NOT EXECUTED**.

Approval, if granted, is limited to one local run on `DESKTOP-P59VRK7` using
the literal staging recipe and invocation. It does not authorize a live VPS,
firewall, DNS, SSH, systemd, package, persistent-access, production or real-
value change. R2 staging and failure evidence remain untouched.

## Exact temporary changes

- Root stages reviewed bytes only under the new persistent path
  `/var/lib/plebeian-friday-fips-r3-reviewed`.
- The run creates five namespaces: `poc-friday-fips-sw` and
  `poc-friday-fips-n1` through `n4`; one namespace-only bridge; four temporary
  veth pairs; node addresses `198.18.242.1/29` through `.4/29`.
- FIPS uses UDP 32121 only within that isolated RFC 2544 underlay. Comet P2P
  TCP 26656 and signer TCP 39101 traverse namespace-local `fips0`; Comet RPC
  26657 and site 8080 stay namespace-loopback; fake mint TCP 3338 is reachable
  only across the FIPS mesh under namespace nftables policy.
- There is no default route, host/IP forwarding, NAT, DNS, external egress,
  host route, host firewall change, file capability, public listener or network
  download. The declared namespace bridge performs only L2 forwarding inside
  the isolated lab.
- The Python controller is the only long-lived root orchestrator. It invokes
  the manifest-pinned `/usr/bin/ip`, `/usr/sbin/nft` and `/usr/bin/ss` as
  short-lived root helpers for namespace/link, ruleset and listener operations.
  Child launch also passes through pinned `/usr/bin/ip netns exec`,
  `/usr/bin/setpriv`, `/usr/bin/prlimit` and `/usr/bin/env` before the final
  application identity is verified. Application/validator/mint/signer/DKG/
  driver children run as UID/GID 1000 with no capabilities and `NoNewPrivs=1`.
  Final FIPS children retain only namespace `CAP_NET_ADMIN`; final packet-
  capture children only namespace `CAP_NET_RAW`.
- One exclusive privileged-controller window is required: no other root or
  `CAP_NET_ADMIN` actor may create, rename, replace or delete the fixed lab
  namespace/link names during the run.

## Ephemeral secrets and bounds

Fresh FIPS, Comet, validator, FROST, signer and coordinator identities plus one
fake-mint seed are generated only beneath
`/tmp/plebeian-friday-fips-lab.20261022-r3`. The root-owned guard is mode 0770
for the single application group; per-node secret directories are UID/GID 1000
mode 0700 and secret files mode 0600. No key or bearer proof enters Git, chat,
packet evidence or the persistent staging tree.

Maximum runtime is 1,800 seconds. Startup is bounded at 60 seconds, normal
shutdown at 15 seconds before identity-checked forced stop, and each log at
10 MiB. Normal/handled-error cleanup stops only recorded process identities,
deletes only matching namespace/veth identities, removes only the matching
root-owned guarded run tree, checks listener absence and requires an unchanged
host nftables hash. The pre-existing host `fips0` must retain the same stable
configuration digest and is never deleted.

## Persistent leftovers

The root-owned R3 staging directory and sanitized success/failure JSON remain.
Removing either later is a separate operation. A clean run removes all
ephemeral keys, processes, namespaces, veths and the `/tmp` run tree. Abrupt
SIGKILL/host failure or any identity mismatch leaves ambiguous objects in
place and requires a new read-only inspection plus exact cleanup approval.

The exact one-run proof remains cooperative outbid return only. It does not
prove the other terminal branches or live four-host deployment. Although every
invoked executable and the staged Nutshell dependency tree are hash-pinned,
the host Python standard library, ELF interpreter and dynamically loaded host
shared libraries are not individually staged or pinned; this is a host-bound,
not fully hermetic, local lab.
