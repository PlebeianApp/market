# Friday FIPS R5 exact action-time scope

Status: **INDEPENDENTLY REVIEWED FOR PRESENTATION; PENDING FRESH OWNER ACTION-TIME APPROVAL; NOT EXECUTED**.

Any later approval is limited to staging the exact manifest-pinned R5 packet
and one local run on `DESKTOP-P59VRK7`. It does not authorize a retry, cleanup
after an uncertain outcome, a VPS/firewall/DNS/SSH/systemd change, package
installation, persistent access, production use, or real value. R2, R3 and the
separate DKG diagnostic staging and evidence remain untouched.

## Exact temporary changes

- Root stages reviewed bytes only at
  `/var/lib/plebeian-friday-fips-r5-reviewed` using the literal recipe. The
  build receipt binds the two rebuilt Bun executables to application commit
  `60f62bdd031fbc9f5684517bfea6e80c3968467d`; the DKG launcher is byte-identical
  to its separately recorded diagnostic artifact.
- The run creates exactly five namespaces: `poc-friday-fips-sw` and
  `poc-friday-fips-n1` through `n4`; one namespace-only bridge; four temporary
  veth pairs; and node addresses `198.18.242.1/29` through `.4/29`.
- FIPS uses UDP 32121 only on that isolated RFC 2544 underlay. Comet P2P TCP
  26656 and authenticated signer TCP 39101 traverse namespace-local `fips0`.
  Comet RPC 26657 and site 8080 stay namespace-loopback. The FakeWallet mint
  on TCP 3338 is reachable only through namespace policy. There is no default
  route, forwarding, NAT, DNS, host route, host-firewall change, public
  listener, package download, or external egress.
- The Python controller is the only long-lived root orchestrator. It invokes
  manifest-pinned `ip`, `nft` and `ss` as short-lived root helpers, and pinned
  `ip netns exec`, `env`, `setpriv` and `prlimit` at child launch. Validators,
  signers, DKG, mint and drivers run as UID/GID 1000 with no capabilities and
  `NoNewPrivs=1`; only FIPS children retain namespace `CAP_NET_ADMIN`, and only
  capture children retain namespace `CAP_NET_RAW`. The bounded child
  `RLIMIT_NPROC` is 512; all other reviewed resource and privilege limits stay
  in force.
- The action needs one exclusive root/`CAP_NET_ADMIN` mutation window: no
  other operator or task may create, rename, replace or delete the fixed lab
  namespaces, links or rules during the run. The pre-existing host FIPS daemon
  and host `fips0` continue running and are never stopped, signalled, rekeyed,
  reconfigured or cleaned by R5; their ordinary continued existence is not a
  second lab controller authorization.

## Fake-only secrets, proof and time bounds

Disposable FIPS, Comet, validator, FROST, signer, coordinator and fake-mint
identities exist only under
`/tmp/plebeian-friday-fips-lab.20261022-r5`. The guarded root is root:GID-1000
mode 0770; per-node private directories are UID/GID 1000 mode 0700 and private
files mode 0600. No private key or bearer proof enters Git, chat, packet
evidence or persistent staging.

The controller wall bound is 4,200 seconds and the outer fail-safe sends TERM
at 4,800 seconds with a further 60-second KILL grace. Terminal preparation must
complete by controller-relative second 1,200; outbid recovery by second 2,100;
and normal winner/no-sale settlement by second 4,199. The final one-second
margin accounts for the inherited main's slightly earlier monotonic anchor.
The 600 seconds between controller work and outer TERM is reserved for capture,
evidence finalization and identity-checked cleanup. Startup is bounded at 60
seconds, normal shutdown at 15 seconds before
identity-checked forced stop, and each ordinary process log at 10 MiB. The
normal test covers real fake-mint cooperative outbid return with lost-response
recovery, winner payout, and reserve-unmet full return. It stops validator 4
and signer 4 while requiring participants 1, 2 and 3. Emergency unilateral
refund authority is **not composed** and cannot be claimed by a successful run.

## Cleanup and persistent leftovers

Normal or handled-error cleanup signals only recorded PID/start-time/process-
group identities; removes only recorded namespace/veth identities; removes
only the matching root-owned guarded R5 run tree; verifies listener and process
absence; and requires unchanged host nftables and stable host `fips0`
configuration. The host `fips0`, R2/R3/diagnostic artifacts and Wednesday demo
are never cleanup targets.

Before any mutable lab effect, the controller reserves a root-owned mode-0600
`evidence/outcome.pending` descriptor beneath the root-only staging tree. It
identity-checks and fsyncs that same descriptor, then atomically publishes the
single schema-discriminated `evidence/outcome.json` after cleanup. Predictable
`/tmp` success/failure paths are not used.

The root-owned R5 staging directory and sanitized outcome JSON remain.
A clean run removes its ephemeral keys, proof material, processes, namespaces,
veths and `/tmp` run tree. SIGKILL, host failure, a changed identity or any
uncertain outcome requires read-only inspection and a separately approved,
exact cleanup; it does not authorize a retry.

The lab is host-bound, not hermetic: the manifest pins each executable and the
6,410-file Nutshell 0.19.2 site-packages tree, while the host kernel, Python
standard library, ELF interpreter and dynamically loaded system libraries are
not copied into staging. One local UID owns all ephemeral signer material, so
this proves distinct processes and real threshold mechanics, not independent
operators or production custody.
