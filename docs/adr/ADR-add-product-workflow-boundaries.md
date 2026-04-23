# ADR: Stabilize “Start selling → Add a product” workflow boundaries, normalize draft state, and remove effect-driven onboarding/publish gating

## Status

Proposed

## Context

The “Start selling → Add a product” flow currently mixes multiple sources of truth and workflow concerns in ways that produce recurring instability:

- mutable product draft state reused across create/edit/session boundaries
- merchant setup/prerequisite state derived from async queries
- workflow/navigation state embedded in component logic
- effect-driven prerequisite routing and onboarding gating
- publish gating not yet aligned with one canonical validation contract

This has produced a class of bugs rather than one isolated defect, including repeated create-session contamination, stale navigation behavior, brittle shipping selection state, and incorrect V4V setup semantics.

A symptom-level patch would not solve the underlying problem. The workflow needs explicit architectural boundaries and a staged refactor sequence.

## Decision

The Add Product flow will be stabilized by separating three distinct truth domains:

1. **product draft truth**
2. **merchant setup truth**
3. **workflow/session truth**

The work will be delivered as a sequence of small, reviewable PRs rather than a single redesign.

## Architecture boundaries

### 1. Product draft truth

Product draft state is the source of truth for product authoring data only.

It must not be used as the place where:

- merchant prerequisite/setup truth is persisted
- workflow navigation truth is reconstructed indirectly
- external/provider display metadata becomes authoritative identity

Key direction:

- navigation state is not draft mutation
- canonical refs are preferred over denormalized display objects
- create/edit session state must not leak across boundaries

### 2. Merchant setup truth

Merchant setup/prerequisite state is query-derived and semantically explicit.

It must not be collapsed into:

- boolean shortcuts like `shares.length > 0`
- draft-state persistence
- product-authoring assumptions that blur create vs edit behavior

Key direction:

- preserve distinctions like:
  - never configured
  - configured zero
  - configured non-zero
- treat setup state as prerequisite truth, not draft truth

### 3. Workflow/session truth

Workflow/session truth determines:

- create vs edit flow mode
- initial/current step determination
- prerequisite-driven routing
- onboarding visibility/blocking rules

It must become explicit and deterministic rather than effect-driven.

Key direction:

- a new create session always starts fresh
- initial/current step logic should eventually be centralized in an explicit resolver
- create-only onboarding rules must not accidentally block edit flow

## Invariants

- create and edit never share mutable session state
- merchant setup state is query-derived prerequisite state and must not be persisted inside product draft state
- navigation/tab movement is workflow state, not draft mutation
- draft shipping truth uses canonical refs
- quick-created shipping attaches by canonical identity
- `configured-zero` V4V is a valid configured state
- initial/current step determination is explicit and centralized
- publish readiness should eventually come from one canonical validation model

## Consequences

### Positive

- clearer source-of-truth boundaries
- fewer hidden couplings
- more deterministic workflow behavior
- smaller, more reviewable PRs
- better regression testing around each boundary

### Costs

- short-term increase in architectural surface area while transitional helpers exist
- some test contracts need to be updated as semantic truth becomes more accurate
- workflow logic may temporarily be split between legacy behavior and the new resolver until later slices land

## Rollout / PR sequence

### PR 1 — create/edit session boundary hardening

Introduce a shared session initializer and ensure all create entry surfaces use it.

### PR 2 — separate navigation from draft mutation

Make tab changes workflow-only and non-dirty.

### PR 3 — normalize shipping selection model

Store canonical shipping refs in draft state and derive display metadata.

### PR 4 — quick-create shipping identity flow

Attach newly created shipping by canonical identity rather than name-based rediscovery.

### PR 5 — V4V semantic split

Introduce explicit V4V semantic state and stop using share-array length as setup truth.

### PR 6 — explicit workflow resolver / initial step determination

Centralize create/edit step resolution and remove effect-driven prerequisite routing where touched.

### PR 7 — canonical validation / publish-readiness alignment

Unify workflow readiness and publish gating under one explicit validation model.

## Notes

This ADR is the design anchor for the Add Product stabilization workstream. It is intentionally architecture-first and does not attempt to redesign the entire visible UX in one decision.
