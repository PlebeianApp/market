# Stabilize “Start selling → Add a product” workflow boundaries, normalize draft state, and remove effect-driven onboarding/publish gating

## Problem statement

The current “Start selling → Add a product” flow is not failing because of one isolated shipping-tab bug. It is failing because the workflow mixes multiple concerns without one explicit workflow source of truth:

- singleton draft state
- merchant prerequisite/setup state derived from async queries
- UI navigation state
- effect-driven routing between tabs/steps
- publish gating logic

This creates a class of failures rather than one bug:

- repeated create-session contamination
- stale tab position or unexpected tab jumps
- shipping selection persistence inconsistencies
- onboarding/setup state leaking into authoring flow
- publish gating that is difficult to reason about or test

The workflow needs to be stabilized by separating truth boundaries and refactoring the flow into small, reviewable slices.

## Goals

- establish explicit boundaries between product draft truth, merchant setup truth, and workflow/session truth
- ensure a new create session always starts cleanly
- make navigation semantics distinct from draft mutation semantics
- normalize product shipping selection truth to canonical refs
- remove effect-driven identity and setup heuristics where explicit state should exist
- make V4V setup semantics explicit
- make the workflow deterministic and easier to test
- sequence the work into the smallest meaningful PRs

## Non-goals

- full Add Product UX redesign in one PR
- introducing a full workflow state machine immediately
- redesigning validation and publish-readiness in the same slice as truth-model fixes
- merging unrelated E2E stabilization or unrelated product bugs into this workstream
- replacing existing UI order without first centralizing workflow truth

## Invariants

### Product draft truth
- product draft state must not be the place where merchant prerequisite/setup truth is persisted
- create and edit must not share mutable session state
- navigation state must not be treated as product-data mutation
- canonical draft truth should favor stable internal refs over display metadata

### Merchant setup truth
- merchant setup state is query-derived prerequisite state and must not be persisted inside product draft state
- semantic distinctions such as “never configured” vs “configured zero” must be preserved explicitly
- provider/external integration metadata must not become draft truth

### Workflow/session truth
- a new create session always starts fresh
- initial/current step determination must come from explicit workflow logic, not scattered effects
- create-only onboarding rules must not accidentally block edit flow
- publish readiness must eventually come from one canonical validation contract

## Proposed PR sequence / checklist

- [ ] **PR 1 — create/edit session boundary hardening**
  - shared create-session initializer
  - all create entry surfaces use the same session contract
  - repeated create attempts start cleanly

- [ ] **PR 2 — separate navigation from draft mutation**
  - tab/step movement is workflow state, not draft mutation
  - tab changes do not dirty the form or trigger autosave

- [ ] **PR 3 — normalize shipping selection model**
  - draft shipping truth uses canonical refs
  - display metadata is derived
  - publish uses canonical refs only

- [ ] **PR 4 — quick-create shipping identity flow**
  - newly created shipping attaches by canonical identity
  - no title/name rediscovery dependency
  - no refetch-timing dependency for correctness

- [ ] **PR 5 — V4V semantic split**
  - distinguish `never-configured`, `configured-zero`, `configured-nonzero`
  - stop using `shares.length > 0` as setup truth

- [ ] **PR 6 — explicit workflow resolver / initial step determination**
  - centralize create/edit step resolution
  - remove effect-driven prerequisite routing where touched

- [ ] **PR 7 — canonical validation / publish-readiness alignment**
  - unify workflow readiness and publish gating
  - reduce false-ready UI states

## Acceptance criteria

### Functional
- starting create after a failed or abandoned create attempt produces a fresh session with no inherited shipping selections, active step, or stale setup state
- create and edit no longer leak mutable state into each other
- tab changes do not dirty the form or trigger autosave
- shipping selections are canonical-ref based
- quick-created shipping attaches by canonical identity
- empty V4V configuration is treated as configured-zero, not “not configured”
- create/edit initial-step resolution is explicit and deterministic
- publish gating eventually aligns with one canonical validation contract

### Architectural
- product draft truth, merchant setup truth, and workflow truth are clearly separated
- query-derived prerequisite state is not persisted as draft truth
- effect-driven onboarding/publish gating is incrementally removed in favor of explicit semantic/workflow logic
- each PR is reviewable on its own and does not collapse multiple architectural concerns into one diff

### Testing
- each slice adds focused regression coverage for the exact boundary it changes
- deterministic tests exist for:
  - create/edit session isolation
  - non-dirty navigation semantics
  - canonical shipping truth
  - quick-create identity handoff
  - V4V semantic state resolution
  - workflow step resolution
  - validation/publish-readiness alignment

## Rollout notes

- land the work as a sequence of small PRs, not one giant refactor
- keep unrelated suite stabilization separate unless a branch is explicitly dedicated to test-only stabilization
- when an E2E expectation conflicts with a corrected semantic model, update the test contract rather than reintroducing the old bug
- document the target architecture in an ADR and link it from this issue
- use this issue as the workstream anchor; use PRs to land one boundary fix at a time

## ADR

The design anchor for this workstream should live at:

`docs/adr/ADR-add-product-workflow-boundaries.md`
