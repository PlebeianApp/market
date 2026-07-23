# ADR-015: Explicit Relay Persistence Boundaries and Isolated Staging Recovery

## Status

Proposed

## Date

2026-07-23

## Related

- Incident: `PM-RELAY-STAGING-2026-07`
- Historical proposal: `ADR-PM-RELAY-STAGING-001`
- Merged PR #1133: staging deploy-path hardening
- Merged PR #1143: read-only relay disk reporting
- Open PR #1115: broad aggregator-relay proposal, intentionally out of scope

## Scope and authority

This ADR proposes architecture and recovery boundaries for the repo-owned Plebeian Market relay. It does not authorize implementation, host access, database or index mutation, service activation, deployment, or restart.

Verified upstream point: `PlebeianApp/market@7bce8d6d418fb07b9df9d4cbb096212c5a72449a`.

Local checkout and live staging-host state were not available during this review. Historical incident measurements therefore remain historical assertions until separately revalidated.

If accepted, ADR-015 supersedes only the unaccepted architecture recommendation in `ADR-PM-RELAY-STAGING-001`. That earlier artifact remains unchanged as review history.

## Context

The repo-owned relay currently combines a bbolt raw event store with a Bleve search backend in `deploy-simple/relay/cmd/market-relay/main.go`.

Verified current behavior includes:

- `openStore` initializes bbolt before Bleve;
- search filters are routed to Bleve while other filters are routed to bbolt;
- save, delete, and replace operations mutate raw state before the related search operation;
- a Bleve initialization error whose text contains `metadata missing` causes `os.RemoveAll(RELAY_SEARCH_INDEX_DIR)` followed by a retry;
- `/healthz` returns static `ok` and performs no active store, parity, generation, or capacity check at request time;
- staging advertises NIPs `1,11,50`;
- the relay installer installs artifacts, restarts the service, verifies it, and attempts a rollback restart;
- the workflow is configured to attempt staging activation for relevant pushes to `master`.

Whether GitHub environment protection currently inserts an external approval gate was not verified. Once the installer executes, artifact preparation and service activation are coupled.

The merged pruning runbook treats `/var/lib/market-relay/raw` as source-of-truth relay data and prohibits search-index deletion by default until rebuild, capacity, restart, rollback, and downtime behavior are verified.

The repository contains no explicit repo-owned full raw-to-search reindex operation. The exact pinned dependency must be inspected before concluding whether it exposes a safe iterator, rebuild primitive, or implicit backfill behavior.

## Decision

Plebeian Market should recover staging through an isolated, explicitly authorized workflow and refactor the relay through small, independently reviewable changes.

### 1. Primary and derived persistence boundaries

Treat the bbolt-backed raw store as the proposed primary persisted-event boundary.

Treat Bleve/Scorch as a secondary search projection. Search state must not independently define event identity, authorship, addressable replacement ownership, deletion authority, or retention.

Current raw-first mutation order does not by itself establish this contract because search errors can still be returned after raw state changes.

### 2. Ordinary startup must be non-destructive

Remove ordinary-startup authority to recursively delete the configured search directory.

Search-open failure should preserve the existing path and fail with an actionable error. Recovery must be an explicit operator action, never a string-matched side effect of `openStore`.

### 3. Retained-history rebuild must be proven

A fresh Bleve directory must not be treated as a retained-history rebuild until:

1. the exact pinned `fiatjaf.com/nostr` dependency is inspected;
2. complete raw-event enumeration is demonstrated beyond the normal relay query limit;
3. an integration test proves historical events are indexed into a new target;
4. interrupted targets remain distinguishable from complete generations;
5. source data remains unchanged.

Any repo-owned reindex operation must build into a new, non-existing target and refuse overwrite or unsafe symlink targets.

### 4. First recovery remains fully search-ready

The first recovery must not serve traffic until the selected raw source and a validated search generation are ready.

Raw-only degraded service is deferred. It would change readiness, query behavior, capability advertisement, indexing lag, reconciliation, and possibly client-visible acceptance semantics.

NIP-50 defines support for `search` filters and discovery through the relay information document. Plebeian Market additionally requires a validated search generation before declaring this relay ready. That completeness rule is a repo-local operational and product invariant, not a direct NIP-50 requirement.

### 5. Preparation and activation are separate transitions

Building, packaging, or installing a reviewed relay artifact must not automatically authorize service restart.

The deployment path should separate:

- artifact preparation;
- artifact installation;
- data-generation selection;
- readiness verification;
- service activation;
- traffic cutover;
- rollback.

Each operational transition requires its own recorded authority.

### 6. Recover only in isolation

Do not restart the original staging host in its historical incident state.

Recovery must use a separate host, snapshot clone, or dedicated recovery volume. Incident-era raw and search material remains preserved evidence. Recovery operates on reviewed working copies and new target paths.

### 7. Preserve staging history by default

When the reviewed raw source validates successfully, retained-history recovery is the default:

- use a read-only source or reviewed working copy of the raw store;
- create a new search generation;
- validate event and search behavior before activation.

Clean staging requires an explicit maintainer or product determination that historical staging events may be discarded. Silence is not data-loss authority.

### 8. Derive operational limits from rehearsal

Disk, memory, index-growth, restart, cancellation, and rollback thresholds must be measured in an isolated rehearsal.

The existing `2 GB`, `1 GB`, and `500 MB` runbook values remain useful deploy warnings, but they are not rebuild-capacity evidence.

### 9. Acceptance semantics remain unchanged

This ADR does not select between:

- synchronous raw-plus-search acceptance; or
- raw-commit acceptance with asynchronous search projection.

A separate protocol-sensitive ADR must define NIP-01 `OK` semantics, backlog durability, ordering, retries, replacement/deletion behavior, reconciliation, and client-visible failure reporting before changing the current contract.

### 10. Deep allocation accounting remains independent

Deep bbolt allocation and accounting work remains a separate forensic and static-specification track.

It becomes an operational recovery prerequisite only if:

- raw-store rehearsal exposes inconsistencies;
- complete enumeration fails;
- effective-event results are unstable; or
- maintainers explicitly require a specified stronger proof.

## Target architecture

```text
validated event
      |
      v
primary raw persistence
      |
      +----> secondary search projection
      |
      +----> reconciliation and recovery evidence
```

Proposed service states:

```text
starting
raw_open
search_open
ready
stopping
failed
```

For the first recovery, only `ready` may receive traffic.

`/healthz` remains a liveness-style endpoint. A separate `/readyz` should report operational readiness and succeed only when the required raw source and selected validated search generation are available.

## Boundaries

| Boundary | Decision |
|---|---|
| Raw bbolt store | Proposed primary persisted-event boundary |
| Bleve/Scorch | Derived search projection |
| Incident search index | Preserved evidence, not first-recovery input |
| New search generation | Separately built, validated, and activated |
| `/healthz` | No continued store-readiness proof |
| `/readyz` | Proposed operational-readiness boundary |
| Artifact preparation | No activation authority |
| Service activation | Separate explicit authorization |
| NIP-01 acceptance | Unchanged; separate future decision |
| NIP-50 completeness | Plebeian Market readiness invariant |
| Allocation accounting | Independent forensic/specification track |
| Payment and wallet state | Out of scope |

## Recovery gates

### R0 — Decision authority

Record:

- retained-history or clean-staging branch;
- evidence custodian;
- recovery operator;
- approvers;
- rollback authority;
- non-goals.

### R1 — Read-only containment revalidation

Collect current read-only evidence for:

- service and process state;
- filesystem and inode capacity;
- raw and search size;
- OOM and restart history;
- deleted-open files;
- snapshot and evidence-copy status.

Do not inspect secrets or start the relay.

### R2 — Evidence separation

Identify evidence masters and working copies. Prove that all recovery source and target paths cannot overwrite incident evidence.

### R3 — Code safeguards

Before restart consideration:

- ordinary startup is non-destructive;
- preparation and activation are separable;
- focused tests cover both boundaries.

### R4 — Isolated environment

Prepare a separate host, clone, or recovery volume with the service disabled and resource monitoring available.

### R5 — Dependency and enumeration proof

Inspect the exact pinned dependency and prove complete raw-store enumeration beyond `RELAY_MAX_QUERY_LIMIT` before designing or approving a repo-owned reindex tool.

### R6 — Isolated recovery

For retained history, build a new search generation from the reviewed raw source. For clean staging, use fresh stores only after explicit data-loss authority.

### R7 — Capacity and correctness

Measure:

- source and target bytes;
- peak temporary disk use;
- amplification ratio;
- peak memory;
- duration and throughput;
- cancellation behavior;
- final and sustained growth;
- effective raw and indexed counts;
- deterministic event-ID parity;
- regular, replaceable, addressable, deletion, and expiration behavior;
- representative NIP-50 queries;
- restart with the completed generation;
- unchanged source identity.

### R8 — Operational controls

Install measured disk, memory, growth, restart, readiness, alert, stop, and rollback controls.

### R9 — Controlled activation

Record the exact:

- binary and configuration identity;
- raw source identity;
- search generation identity;
- activation window;
- operator and observers;
- preflight results;
- stop conditions;
- rollback authority;
- traffic-cutover scope.

Only this separately approved record may authorize start or restart.

### R10 — Stability soak

Complete a maintainer-approved soak without OOM, restart loops, uncontrolled growth, readiness failure, capability mismatch, or raw/search correctness regression.

## Smallest safe PR sequence

### PR 0 — This ADR

Record the proposed architecture, unresolved decisions, recovery gates, and authority boundaries. No behavior change.

### PR 1 — Non-destructive startup

- remove implicit `os.RemoveAll`;
- preserve invalid search state;
- return an actionable startup failure;
- add focused no-removal tests;
- do not change acknowledgement semantics.

### PR 2 — Separate preparation from activation

- split or add a prepare-only installer path;
- permit build/test/package without restart;
- require an explicit activation transition;
- keep artifact rollback separate from data-generation rollback;
- leave production unchanged unless separately approved.

### PR 3 — Pinned-dependency and enumeration proof

- inspect the exact pinned backend;
- identify a complete enumeration mechanism;
- prove behavior beyond normal query limits;
- document replacement, deletion, expiration, and addressable-event implications.

### PR 4 — Offline reindex implementation

Only if PR 3 establishes the required primitives:

- build into a new target;
- refuse overwrite and unsafe targets;
- record progress and completion identity;
- leave interrupted targets incomplete;
- preserve the source unchanged;
- grant no host-execution authority merely by merging code.

### PR 5 — Readiness and observability

- add `/readyz`;
- expose safe generation and reconciliation status;
- keep readiness and NIP-50 advertisement consistent;
- add resource controls only from measured rehearsal evidence.

### PR 6 — Acceptance and reconciliation ADR

Decide synchronous composite acceptance versus raw commit with asynchronous search projection in a separate protocol-sensitive review.

## Threat model

The design must mitigate:

- hidden destructive recovery;
- dependency-behavior substitution across revisions;
- search merge or compaction amplification;
- OOM and restart amplification;
- partial raw/search mutations;
- false or misleading NIP-50 advertisement;
- incomplete or stale search generations;
- evidence contamination;
- emergency deletion of user history;
- unsafe reindex targets;
- malformed or resource-amplifying retained events;
- deploy actions that implicitly restart;
- accidental coupling to unrelated aggregator work.

## Required validation

### Unit and integration coverage

- search-open failure never removes a directory;
- missing and invalid search paths have explicit outcomes;
- complete enumeration exceeds normal relay query limits;
- reindex refuses existing or unsafe targets;
- interrupted reindex lacks a complete marker;
- source identity remains unchanged;
- save, delete, and replace partial-failure matrices are explicit;
- addressable fixtures use `kind:pubkey:d`;
- regular, replaceable, addressable, deletion, and expiration behavior is covered;
- readiness fails for absent, invalid, incomplete, or stale generations;
- representative raw and NIP-50 queries match expected event IDs.

### Documentation/static checks

For this ADR-only PR:

- `git diff --check`;
- `bun run format:check` when a local checkout with dependencies is available.

No install, service start, database access, migration, generator, full E2E, deployment, or staging command is part of this ADR PR.

## Consequences

### Positive

- ordinary startup becomes non-destructive;
- raw and search authority are explicit;
- retained history is preserved by default;
- search can be regenerated without overwriting evidence or active state;
- readiness and capability claims become testable;
- deployment becomes deliberate and reversible;
- deep forensics no longer blocks availability by default;
- follow-up PRs remain small and independently reviewable.

### Costs

- retained-history recovery may require a repo-owned reindex implementation;
- the exact pinned dependency must be characterized first;
- deployment gains an additional approval boundary;
- readiness and generation metadata require code and tests;
- current partial dual-write behavior remains acknowledged debt.

## Alternatives

### Delete search and restart the original host

Rejected. Current deletion is implicit, retained-history reindex is unverified, and restart amplification remains plausible.

### Reuse the incident-era search index

Rejected for the first recovery. Preserve it as evidence.

### Clean staging

Conditionally acceptable only with an explicit decision that historical staging events may be discarded.

### Serve raw-only during rebuild

Deferred to a separate ADR because it changes readiness, capability, and possibly acceptance semantics.

### Make indexing asynchronous immediately

Deferred. This ADR makes no selection between synchronous composite acceptance and asynchronous projection.

### Require complete allocation accounting first

Rejected as a default prerequisite. Use only as an explicit contingency.

### Combine recovery with PR #1115

Rejected. Aggregator topology and incident recovery have different risks, review surfaces, and rollback paths.

## Gate-history non-interference

ADR-015 does not modify, revoke, supersede, reinterpret, reseal, or relax any adopted Gate B2 artifact or the historical Gate B3 source-drafting authorization.

The focused decision report with SHA-256 `d20b8c7b6ef13c1336b62497297c1f86c7a07510cab7c3a3ad1b6a138b73178b` remains unchanged and nonnormative.

C1, C2, and C3 remain rejected review history. C4 remains a draft successor candidate and has no normative authority. If C4 later completes a separately authorized independent mechanical and semantic acceptance transition, that transition would establish only its normative clarification status. It would not itself authorize source drafting, compilation, execution, host or database access, deployment, restart, or Git/GitHub mutation.

Gate B3 historically authorizes separately requested executable-source drafting within its exact existing envelope. ADR-015 does not itself request, exercise, expand, or reauthorize that drafting. DBOPEN-dependent conformance source work remains held pending both an accepted successor clarification and a corresponding Gate B3 authorization rebind.

ADR-015 grants no new source-drafting, compilation, installation, execution, database, service, staging, deployment, restart, or Git/GitHub authority.

Static-specification acceptance, clarification acceptance, source-drafting authorization, compilation authorization, operational-recovery authorization, service activation, and deployment or restart authority are distinct transitions. None implies another.

Deep allocation-accounting work remains independent from operational recovery unless an explicit later maintainer decision makes a specified proof a recovery gate.

## Open maintainer decisions

1. Is bbolt approved as the primary persisted-event boundary?
2. Does the reviewed raw source validate successfully?
3. Is there any explicit authority to discard historical staging events?
4. Which isolated environment or volume is approved?
5. Who owns evidence custody, recovery execution, activation approval, and rollback?
6. Must PR 1 precede any restart? Recommendation: yes.
7. Must PR 2 precede any restart? Recommendation: yes.
8. What exact pinned raw-store enumeration mechanism is accepted?
9. What validation proves a search generation ready for Plebeian Market's NIP-50 policy?
10. What measured resource and growth thresholds are approved?
11. How long must incident evidence and recovery reports be retained?
12. Does production inherit any part of this architecture, and through which separate rollout?

## Authorization record

```text
ADR decision:
PENDING

History retention required:
PENDING

Selected recovery branch:
PENDING

PR 1 required before restart:
PENDING

PR 2 required before restart:
PENDING

Primary approver:
PENDING

Evidence custodian:
PENDING

Recovery operator:
PENDING

Rollback authority:
PENDING

Approval UTC:
PENDING

New authority granted by ADR-015:
NONE
```

Acceptance of this ADR would establish an architecture decision only. It would not itself authorize source drafting, compilation, installation, execution, database or index access, service or host access, staging access, deployment, restart, or Git/GitHub mutation.

The historical Gate B3 authorization remains limited to separately requested executable-source drafting within its exact existing envelope. DBOPEN-dependent conformance source work requires both an accepted successor clarification and a corresponding authorization rebind.
