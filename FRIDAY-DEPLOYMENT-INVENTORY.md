# Friday deployment inventory

Updated: 2026-10-22 UTC. Status: **LOCAL CANDIDATE; NOT DEPLOYED**.

## Evidence-bounded artifacts

- Preserved rejected R4 source checkpoint:
  `f8ed94a4a73fd49c3b30a320e18136e8a64ffff4`.  It must not be staged or run.
- R5 source controller, inert execution manifest, build/provenance receipt,
  literal recipe, action scope and unprivileged regressions are maintained as
  one packet.  Its final hashes and review result are filled only after all
  local checks are complete.
- The R5 packet reuses seven hash-pinned R4 binaries; it does not pretend the
  current Go source edits are inside the old validator binary.  A new Friday
  validator binary must be built, hashed and reviewed before live rollout.
- `deploy/friday/` contains non-installing blue/green unit/config templates.
  They do not contain private identities and do not touch Wednesday paths.
- `FRIDAY-EMERGENCY-REFUND-IMPLEMENTATION-PLAN.md` records the required but
  unimplemented emergency authority.  R5's normal branches do not close it.

## Proposed four-host mapping (not current-state evidence)

| slot | demo host | Friday role | candidate listeners |
|---|---|---|---|
| V1 | 172.105.64.142 | validator, signer, fake mint, site | UDP32121 underlay; FIPS ULA TCP27656/39101/3438; loopback27657/8180 |
| V2 | 172.105.95.57 | validator, signer | UDP32121 underlay; FIPS ULA TCP27656/39101; loopback27657 |
| V3 | 172.104.240.217 | validator, signer | UDP32121 underlay; FIPS ULA TCP27656/39101; loopback27657 |
| V4 | 172.104.253.247 | validator, signer; designated fault target | UDP32121 underlay; FIPS ULA TCP27656/39101; loopback27657 |

Production `192.46.234.233` is excluded.  Public HTTPS remains on V1 and is
not changed by the Friday candidate.  The last verified remote inventory is
historical; it must be refreshed read-only before any live request.

## Blue/green separation and rollback

Friday uses `/opt`, `/etc` and `/var/lib` paths ending in
`plebeian-auctions-friday`, new unit names and non-conflicting application
ports.  It is a fresh chain with fresh fake-only FIPS, validator and threshold
identities.  It never imports, converts, wipes or settles Wednesday state.

Before cutover, prove Friday four-validator commits, then three-validator
commits with V4 unavailable, signer quorum, fake-mint recipient ownership and
branch recovery.  The website proxy remains on Wednesday port8080 until those
checks pass.  Cutover changes only its upstream to loopback8180.  Rollback
restores port8080 and stops Friday services in reverse dependency order; it
does not delete either tree.  Provider/firewall uncertainty is checked before
retry.

## Concrete blockers and next approvals

1. R5 is locally pinned and independently accepted for presentation, but still
   requires a fresh exact owner approval for one privileged local lab run. No
   prior R2, R3 or broad privilege statement authorizes R5, and it has not run.
2. A persistent signer/coordinator service composition must replace the
   lab-root-bound CLI and one-shot drivers.  Current templates therefore must
   not be enabled despite being syntactically checkable.
3. Emergency unilateral refund is required but not composed or tested.
4. Only after a successful accepted lab result may a live packet request:
   read-only host re-inventory; exact binary placement; fresh persistent
   fake-only DKG/FIPS identities; source-restricted UDP32121 on V1–V4;
   installation/start of the named Friday units; sequential validation and
   the exact proxy cutover/rollback.  These are separately gated actions.
