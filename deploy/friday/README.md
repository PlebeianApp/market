# Friday blue/green deployment candidate

Status: **LOCAL TEMPLATES ONLY — NOT INSTALLED, ENABLED, OR DEPLOYED**.

This directory keeps the Friday candidate disjoint from the running Wednesday
fallback.  It uses separate unit names, paths, chain state and ports.  The
templates are deliberately not an installation script: a future rollout must
substitute each `%FRIDAY_*%` token from an independently reviewed four-host
manifest and verify the resulting files before root copies them.

`application.json.example`, `authority.json.example`, and the nginx include
must name the same exact public HTTPS origin. `%FRIDAY_PUBLIC_ORIGIN_HOST%` is
the reviewed Friday-only host component, without scheme, path or port; it must
never be derived from an incoming `Host` header. It must not be the Wednesday
IP origin `172.105.64.142` while that origin names Wednesday's independent
mint. `%FRIDAY_APPLICATION_HOST_SLOT%` and `%FRIDAY_APPLICATION_ULA%` must name
the same one of the four reviewed validator hosts.
The proxy preserves the incoming browser `Origin` on `/api/friday/`; it must
not manufacture the trusted origin, because the authority performs the
same-origin authorization check itself.

| surface | Wednesday fallback | Friday candidate |
|---|---|---|
| code | `/opt/plebeian-auctions-poc` | `/opt/plebeian-auctions-friday` |
| state | `/var/lib/plebeian-auctions-poc` | `/var/lib/plebeian-auctions-friday` |
| config | `/etc/plebeian-auctions-poc` | `/etc/plebeian-auctions-friday` |
| Comet P2P | public TCP 26656 | FIPS ULA TCP 27656 |
| Comet RPC | loopback TCP 26657 | loopback TCP 27657 |
| signer RPC | absent | FIPS ULA TCP 39101 |
| fake Cashu mint | V1 loopback TCP 3338 | selected Friday app-host FIPS ULA TCP 3438 |
| site/API | V1 loopback TCP 8080 | selected Friday app host loopback TCP 8180 |
| authority API | absent | selected Friday app host loopback TCP 8181 |
| FIPS underlay | absent | private-peer UDP 32121 |

The Friday application uses the `frost_cashu_v4` State V8 authority mode. Its
canonical state bytes intentionally differ from the Wednesday State V7 bytes.
The Friday application binary must never replace or restart a Wednesday
`plebeian-poc-validator@*.service` unit, read a Wednesday network root, or be
installed below a Wednesday code/config/state path. Friday is a new chain with
fresh per-host validator state; there is no in-place State V7 upgrade.

`POST /api/close` is intentionally a permissionless deterministic-finalization
trigger, not a seller authorization. The close transaction contains only the
auction ID. CheckTx rejects it until the last committed consensus time reaches
the certified end, and proposal/finalization repeat the deadline check using
their authoritative block time. It cannot select or alter the winner, amount,
recipient, reserve result, or funding entitlement.

The browser, Coco v2 wallet, Cashu tokens and consensus receipts all name the
one canonical Friday-only HTTPS mint origin from `cashu_mint_url`. On the
selected application host only, its TLS proxy maps `/v1/` to the fixed
FIPS-ULA mint transport. Signers and the
authority use the same reviewed identity-to-transport mapping; clients never
receive the ULA as their mint identity. `nginx-friday-locations.conf.example`
is an inert include template, not a complete TLS configuration and not an
instruction to replace the current working proxy without its final review.
`nginx-friday-mint-recovery-only.conf.example` is the corresponding inert mint
boundary for an already-funded recovery window. It allows only mint/key reads,
an existing quote-status read, and value-conserving swap/checkstate/restore;
new quote creation and mint execution fall through to an explicit denial. The
two templates are mutually exclusive for `/v1/` and are never installed merely
because a browser readiness flag changed.

The proposed provider rule is UDP 32121, source-restricted to the exact four
demo-validator IPv4 `/32`s. The selected Friday application host also needs
public IPv4 TCP 443 in its own reviewed firewall; that rule must not be added to
a firewall shared by all four hosts. TCP 8443 is not part of the trusted public
origin or tested jmcorgan/fips transport and must not be used. No public RPC,
signer, mint, site, admin, or IPv6 ingress is proposed. Existing SSH restrictions
and Wednesday V1 HTTPS remain unchanged. At the current R10 source, the only executable public-origin
proposal is `https://172.105.95.57` on V2. Hostname origins remain a future
source revision because strict Go validation accepts only a public HTTPS IP
literal. No certificate or firewall change has been made.

The templates enforce separate service users and writable paths.  FIPS alone
retains `CAP_NET_ADMIN`; validator, signer, mint and site do not.  Validator
restart policy does not imply signer readiness: the signer is fail-stop and
must remain stopped on journal/anchor/epoch mismatch.

FIPS does not accept an arbitrary private-key path. It derives `fips.key`
from the directory of the exact `-c` config file, and persistent mode would
generate a key when that file is absent. The Friday config therefore lives at
`/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml`, beside the
independently provisioned `fips.key`. Both are service-owned mode 0600 inside
a service-owned mode 0700 directory. `verify-friday-fips-identity.py` checks
that exact metadata without reading the key and refuses startup if the key is
absent or displaced; the unit contains no key-generation action.

The coordinator RPC identity is likewise explicit in the live application
manifest as
`/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key`.
The authority and terminal executor read only that V2-local application-host
path. The production templates never inherit the local lab's `node-1` path.

All Friday processes join `plebeian-friday.slice`, proposed with
`MemoryHigh=2G`, `MemoryMax=2304M`, and `TasksMax=1024`. The application-host
per-unit ceilings are FIPS 160M, validator 384M, signer 320M, mint 384M,
coordinator 384M, authority 448M, site 160M and nginx 128M (2368M total
ceilings, deliberately larger than the aggregate hard cap). Ceilings are not
reservations or evidence of observed use. A staged start must stop if
`MemAvailable` falls below 2816M after FIPS, 2432M after validator, 2176M after
signer, 1792M after mint, 1280M after the application processes, or 1024M after
nginx; it must also stop on swap growth, OOM evidence, a failed health check or
a Wednesday restart. These thresholds remain proposed until reviewed against
live inventory.

The signer now has a fail-closed live configuration adapter and create-once,
restart-validated public enrollment. The non-networked coordinator has a
deployment-bound process-safe SQLite queue. An interrupted payment enters
exact mint recovery; it is not retried until recovery proves a pre-mint state.
A mint-unknown payment remains unavailable until the same recorded operation
is recovered and its recipient import completes. Neither component exposes a
web admin route, and the coordinator exposes no caller-driven enqueue CLI.
The exact terminal executor, authenticated authority-to-queue bridge and
FundingAbortV1 recovery path now exist and pass focused offline tests. The
current source also adds server-enforced recovery-only behavior to the site,
authority and public mint proxy boundary. They
have not run in a fresh real-mint/FIPS/Comet/browser acceptance and do not make
these templates activatable.

`plebeian-friday-coordinator.service` and the site use `Wants`, not `Requires`,
for validator/signer dependencies. Losing V1's local signer must not
automatically kill a coordinator that can still obtain three remote FROST
shares, and a degraded site must stay available to show honest status. The
validator and FIPS dependency remains strict. `plebeian-friday-authority.service`
is application-host-only and stays inert until both independently rooted anchors and the
reviewed authority config exist.

The authority and coordinator share one deployment-bound operations database
and separately rooted rollback anchors, including a distinct FundingAbortV1
anchor. Neither `serve` command creates state. A future reviewed install must
run the single exact one-time command
below as the final service user, only after the coordinator and anchor parent
directories and application manifest have been verified empty and exact:

```text
/opt/plebeian-auctions-friday/bin/plebeian-friday-authority init-state \
  --application /etc/plebeian-auctions-friday/application.json
```

That command O_EXCL-reserves every authority/coordinator SQLite file before
initializing any schema. It enrolls empty revision-zero coordinator, funding
replay, broadcast, FundingAbort and seller-plan generations against their
distinct anchor files, and creates all remaining empty journals. A conflict or
partial failure is retained for operator inspection; it never truncates,
deletes, resumes or silently migrates state. This is a deployment instruction
only and has not been executed. The independent SQLite files protect against
accidental partial restore, not a coherent rollback of both data and anchor by
the host operator.

The browser seller-plan registry is included in that create-once transaction:
`/var/lib/plebeian-auctions-friday/coordinator/seller-plan.sqlite3` is paired
with `/var/lib/plebeian-auctions-friday-anchor/seller-plan.sqlite3`. The
authority refuses to start if either is absent or if the store generation,
revision, or exact state digest regresses. `serve` never enrolls a missing
database or anchor. The older `init-seller-plan` subcommand remains only for
isolated compatibility tests and is not part of the Friday deployment order.

## Activation gates

These templates are not yet a runnable four-host release.  Activation is
blocked until all of the following are true:

1. a fresh exact-current R10 run passes its real UDP-FIPS backend and the
   trusted-HTTPS browser/Coco journey, and the evidence is independently
   accepted; older packets do not cover the exact R10 browser bundle,
   recovery-only enforcement, V2 application-host mapping, or restart-safe
   FundingAbort sessions;
2. the persistent signer/coordinator revision receives its own integration
   run and review; R5 cannot be cited for code added after its frozen commit;
3. the terminal executor and authority-to-queue bridge receive a fresh exact-
   current integrated run; the two-phase browser/client-held signer API and
   FundingAbortV1 must prove real mint recovery and recipient import;
4. fresh fake-only DKG/FIPS/Comet identities are generated under an exact
   owner-approved placement plan (never copied from the local lab);
5. a current read-only inventory proves the four intended VPSs have no
   conflicting listeners/workloads and the full binary/config hashes match;
6. the distinct Friday server databases, anchors and browser-origin stores are
   proven empty before create-once initialization. Any pre-R10 record is
   preserved and blocks activation rather than being cleared or migrated;
7. the controlled mint passes a real NUT-12/DLEQ canary. A strict post-swap
   DLEQ refusal must remain a durable unavailable Coco operation, not be
   relabelled refunded;
8. the owner approves the exact UDP firewall delta, staged identities, named
   services, sequential restart order and rollback.

See `STATUS-RUNBOOK.md` for the proposed status semantics, switch boundary and
non-destructive rollback. BFT 3-of-4 and FROST 3-of-4 are explicitly separate
checks. Emergency unilateral refund remains disabled pending a policy decision;
the normal certified outbid return and validator-confirmed FundingAbortV1 are
not permitted to degrade into UI-only balance updates.

Until those gates close, the correct rollback is simply **do not start the
Friday units**. The existing Wednesday units/data are not modified. During a
future blue/green activation, Friday validators must first reach four-way
consensus, then three-way consensus with designated V4 unavailable, before the
separate V2 Friday HTTPS server can be enabled. A failed pre-funding check
leaves that server disabled. Once Friday funding exists, disable new funding
but retain the V2 Friday origin and recovery paths until liabilities drain;
never repoint it to Wednesday or route it through V1.
