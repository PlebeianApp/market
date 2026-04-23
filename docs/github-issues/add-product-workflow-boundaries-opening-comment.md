This workstream should be reviewed as a **workflow/source-of-truth stabilization effort**, not as a one-off shipping-tab bugfix.

The important framing is:

- **product draft truth**
- **merchant setup truth**
- **workflow/session truth**

are currently too entangled, which is why the flow has shown repeated create-session contamination, brittle shipping behavior, and incorrect V4V setup semantics.

The intended approach is to land this in **small PR slices**, each fixing one architectural boundary at a time:

1. create/edit session boundaries
2. navigation vs draft mutation
3. shipping truth normalization
4. quick-create shipping identity
5. V4V semantic split
6. explicit workflow resolver
7. canonical validation / publish-readiness

The ADR for this workstream should live at:

`docs/adr/ADR-add-product-workflow-boundaries.md`

Please review each PR against that architecture, rather than as isolated symptom patches.
