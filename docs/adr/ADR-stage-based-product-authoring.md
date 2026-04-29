# ADR: Make stage-based product authoring the canonical workflow model

## Status

Proposed

## Context

The Add Product workflow historically treated tabs as both UI navigation and workflow truth. That made small UI details responsible for policy decisions such as where create starts, whether delivery is complete, and when publishing is allowed.

This is brittle because tabs are a presentation affordance. They can be rearranged, hidden, grouped, or temporarily retained during migration without changing the underlying authoring lifecycle. Workflow policy needs a stable model that is independent of those rendering details.

The current stabilization stack already separates seller readiness and draft validation into explicit sources. The remaining issue is that progression still depends on tab conditionals in the form.

In particular, Publish must not be an alias for Delivery or Shipping. Delivery collects fulfillment information; Publish is the final readiness and action gate.

## Decision

Product authoring workflow truth will be stage-based.

The canonical stages are:

1. Basics
2. Pricing & Inventory
3. Media
4. Delivery
5. Publish

Tabs may remain temporarily as a rendering affordance, but they are not the workflow source. Product authoring policy resolves against stages and uses tab mapping only to render existing form sections.

Publish is a real workflow stage. It does not require a legacy tab and must not be collapsed into Delivery or Shipping.

## Non-goals

This ADR does not redesign shipping UX, public product-page shipping behavior, route names, V4V semantics, or unrelated marketplace flows.

## Boundaries

Seller readiness remains query-derived state owned by `useProductCreateReadiness`.

Draft validity remains pure product-state validation owned by `validateProductDraft`.

Stage progression is derived from seller readiness, draft validation, and the current form section mapping.

Publish gating is the final stage gate and must use stage state rather than ad hoc tab checks.

## Consequences

Stage order is explicit and deterministic.

ProductCreateShell remains the shared create orchestration owner and computes stage truth for create entrypoints.

ProductFormContent consumes stage truth and may continue rendering legacy form sections while the UI migrates incrementally.

The Publish stage can represent prerequisite blockers such as V4V setup without changing the underlying V4V policy in this PR.

## Migration Approach

This PR introduces the stage model and stage progression truth immediately.

Legacy form sections remain as presentational sections for reviewability. They are mapped into stages:

- Basics: name and category sections
- Pricing & Inventory: detail and spec sections
- Media: images section
- Delivery: shipping section
- Publish: final readiness, V4V, and publish CTA surface with no legacy tab

Later PRs may remove or redesign the legacy section presentation, but that is intentionally out of scope here.
