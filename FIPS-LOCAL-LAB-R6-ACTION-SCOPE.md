# Friday R6 backend FIPS lab — exact action scope

Status: **INERT DRAFT — BLOCKED, not approved, not staged and not executed**.

The manifest has `approval_ready=false`.  A valid receipt that merely crosses
its committed-time admission deadline now has a code-zero certified return,
and browser discovery is retained through terminal acknowledgement.  However,
the independently reviewed pre-broadcast/structural-failure cancellation
authority is not yet composed, and this backend controller does not run the
actual browser Coco v2 path over FIPS.  Those gaps prevent action-time
presentation; changing the manifest flag is not an operator remedy.

This packet is one backend-only privileged lab run on `DESKTOP-P59VRK7`. It
uses current Friday validator, DKG, signer, FROST and terminal drivers and the
reviewed R5 isolation/cleanup machinery. It does not deploy to a VPS and does
not count as browser Coco v2 acceptance.

## Exact effects

- Root stages hash-pinned bytes at
  `/var/lib/plebeian-friday-fips-r6-reviewed`.
- One controller creates only five temporary namespaces:
  `poc-friday-fips-sw` and `poc-friday-fips-n1` through `n4`, underlay
  `198.18.242.0/29`, and namespace-local `fips0` interfaces.
- jmcorgan/fips 0.5.2 uses UDP 32121 only inside that isolated underlay.
  Comet TCP 26656, signer TCP 39101 and mint TCP 3338 traverse FIPS; RPC 26657
  and site 8080 stay namespace-loopback. There is no default route, DNS, NAT,
  host route, host firewall change, public listener or external egress.
- The root Python controller is the only long-lived privileged process. Pinned
  `ip`, `nft` and `ss` helpers run briefly as root. Validators, DKG, signers,
  drivers and mint run UID/GID 1000 with no capabilities and NoNewPrivs; only
  FIPS keeps namespace `CAP_NET_ADMIN`, and capture keeps namespace
  `CAP_NET_RAW`.
- Disposable FIPS, Comet, FROST, coordinator and fake-mint keys exist only in
  `/tmp/plebeian-friday-fips-lab.20261023-r6`, with private directories 0700
  and files 0600. They are not deployment credentials and are removed after a
  clean run.

The controller work bound is 4,200 seconds. The outer timeout sends TERM at
4,800 seconds and KILL 60 seconds later. The last 600 seconds are reserved for
evidence and cleanup. A root-only outcome inode is reserved before effects and
published at
`/var/lib/plebeian-friday-fips-r6-reviewed/evidence/outcome.json` only after
identity-checked cleanup.

Normal success must prove cooperative outbid return with lost-response
recovery, winner payout, reserve-unmet full return, one validator unavailable,
one signer unavailable, real 3-of-4 FROST, real fake-mint spend/recovery/import
and FIPS-path evidence. Emergency unilateral refund is not composed.

## Browser/TLS boundary

This local no-egress lab cannot honestly exercise the public browser origin
`https://172.105.64.142`: the publicly trusted certificate and private key live
on V1, and copying that key or installing an ad-hoc local trust root is outside
this packet. TLS verification must never be disabled. Consequently, R6 backend
success is necessary but insufficient. The real browser Coco v2 journey must
later run through an owner-IP-allowlisted V1 candidate route on the existing
trusted HTTPS origin while all other users remain on Wednesday.

## Cleanup and refusal

Normal cleanup signals only recorded PID/start/process-group identities,
deletes only recorded R6 namespaces/veths and the guarded R6 run root, and
proves listeners/processes absent plus host nftables and the pre-existing host
`fips0` unchanged. Staging and sanitized evidence remain. Host failure, SIGKILL,
identity mismatch or an uncertain outcome authorizes inspection only—no retry
or cleanup.

This request does not authorize staging, running, retrying, VPS access, live
firewall/service changes, persistent key generation, deployment or real funds.
Those require later exact action-time approval.
