Now let me look at ADR-0003 more carefully to ensure I reference it correctly, and also check the numbering. From the files you've provided, ADR-0001 and ADR-0002 exist, ADR-0003 is the accepted UI consolidation ADR, and ADR-0013/0014 exist. I need to pick a number that makes sense. Let me draft the ADR.

Here's the drafted ADR:

ADR-0016: V2 Integration Branch Strategy for Concurrent Feature Streams
Status
Proposed

Date
2026-07-21

Related
ADR-0001: Hierarchical AGENTS.md as Living Operational Guidance
ADR-0003: Centralized UI Component Consolidation & V2 Gating Strategy
ADR-0013: NIP-17 Order Message Transport
ADR-0014: NIP-17 Order Transport Migration and Cutover Criteria
Scope
This ADR defines the branch integration and gating strategy for converging three concurrent, large-scale feature streams—Auctions, CMS, and the V2 UI migration (per ADR-0003)—into a single releasable state without requiring independent long-lived branches that must each be rebased against master independently.

This ADR does not modify the V2 component architecture, directory structure, or stylesheet strategy defined in ADR-0003. It operates above ADR-0003's gating mechanism and extends it to cover the broader challenge of multi-stream convergence.

This ADR does not define the internal implementation of Auctions, CMS, or V2 UI components. It defines how their branches are integrated, tested, and gated.

Context
Three large pieces of work are progressing in parallel:

Auctions — A feature stream that touches payment flows, NIP-60 stores, dashboard views, and publish paths.
CMS — Content management functionality that shares components with the home page migration defined in ADR-0003's PR 3.
V2 UI Migration (ADR-0003) — The component consolidation, stylesheet refactor, and widget book test harness, whose PR strategy spans foundation, layout, UX, and dashboard components.
These streams have overlapping file sets. ADR-0002 explicitly identifies auctions conflict-zone files (src/publish/orders.tsx, src/publish/featured.tsx, src/routes/_dashboard-layout/dashboard/index.tsx, src/lib/stores/nip60.ts). ADR-0003's PR strategy migrates homepage, layout, and dashboard components that touch these same areas. CMS work depends on components produced by the V2 UI migration.

Maintaining three separate development branches alongside master creates compounding overhead:

Each branch must be rebased against master independently, and conflicts resolved in triplicate when the same files are touched.
Integration PRs from any single branch into master produce large diffs that are difficult to review and risky to merge.
There is no mechanism to validate that the three streams work together until one of them reaches master, at which point late-stage integration failures are expensive.
The longer the branches remain separate, the greater the divergence and the higher the final merge cost.
ADR-0003 already establishes a V2 gating mechanism: a feature flag (VITE_ENABLE_V2_THEME), a /v2 URL prefix, and a ThemeMigrationWrapper. This mechanism was designed for the UI migration specifically, but its architecture—a dev-only gate that isolates new work from production—is directly extensible to the broader multi-stream problem.

Decision
Decision 1: Establish a single integration branch for V2-converged work
Create a long-lived integration branch—referred to as v2-integration in this ADR—that serves as the convergence point for all three feature streams. Work from Auctions, CMS, and V2 UI migration merges into v2-integration rather than master.

v2-integration is periodically rebased on master to absorb production fixes and non-V2 changes. The rebase cadence should be frequent enough to prevent divergence but not so frequent that it disrupts active development. A recommended cadence is once per sprint or after any significant master merge.

Individual feature work within each stream continues on short-lived feature branches targeting v2-integration (not master). These short-lived branches follow the standard PR review process and are deleted after merge.

master ← v2-integration ← feature/auctions-*
                         ← feature/cms-*
                         ← feature/v2-ui-*
Decision 2: Extend the V2 gate beyond UI theming
ADR-0003's VITE_ENABLE_V2_THEME flag and /v2 URL prefix are extended to serve as the unified gate for all V2-era work. When the V2 gate is active, the following become accessible:

V2 UI components and views (per ADR-0003's -v2 directories and /v2 routes)
Auctions features (new routes, stores, publish paths)
CMS features (content management routes and components)
Each feature stream is responsible for gating its own routes and components behind the V2 flag. The gate is initially dev-only: it is active in local development and CI environments but has no effect in production builds.

Implementation detail: the gate should support granular sub-flags so individual features can be toggled independently during development:

VITE_ENABLE_V2_THEME=true|false          (umbrella flag, per ADR-0003)
VITE_ENABLE_V2_AUCTIONS=true|false        (auctions sub-flag)
VITE_ENABLE_V2_CMS=true|false             (CMS sub-flag)
When the umbrella flag is false, all sub-flags are effectively false regardless of their individual values.

Decision 3: Define a staging progression for production exposure
The V2 gate progresses through three stages before features reach master:

Stage 1 — Dev-Only (default) The V2 gate is active only in development and CI. Production builds do not include V2 routes or components. This is the initial state and the state during active development of all three streams.

Implementation: V2 routes and components are excluded from the production build via environment conditional imports or tree-shaking. The v2-integration branch is not deployed to production.

Stage 2 — Opt-In Production Beta When all three streams have reached feature completeness on v2-integration, the gate is extended to production behind an explicit user-facing setting (e.g., a "Try the new experience" toggle in user settings). This allows real users to opt into V2 features while the legacy experience remains the default.

Requirements for entering Stage 2:

All three feature streams are feature-complete on v2-integration.
The widget book test harness (ADR-0003, Decision 1e) has passing coverage for all migrated components.
End-to-end tests pass for V2 routes.
Maintainers explicitly approve the transition.
In this stage, v2-integration is merged into master (or a release branch from it), but the V2 gate defaults to off in production. Users who opt in activate the gate client-side.

Stage 3 — Default Promotion V2 features become the default experience. The legacy gate is inverted: legacy features are accessible behind an opt-out flag for a deprecation window, then removed.

Requirements for entering Stage 3:

Stage 2 has been live with no critical regressions for a maintainer-defined observation period.
ADR-0003's PR 7 (Promotion / Go-Live) cleanup steps are executed: /v2 prefix removed, imports updated to -v2 directories, legacy directories and globals.css deleted, ThemeMigrationWrapper removed.
Maintainers explicitly approve the promotion.
Decision 4: Conflict resolution and merge priority on v2-integration
When two feature streams modify the same file on v2-integration, the conflict is resolved on v2-integration—not deferred to a master merge. This ensures that integration issues surface early, while the changeset is still small and context is fresh.

Merge priority into v2-integration follows these rules:

Foundation work first. ADR-0003's PR 1 (styles, directories) and PR 2 (test harness) must land on v2-integration before feature-stream work that depends on V2 components or tokens.
Dependent streams second. CMS work that consumes V2 UI components must merge after the relevant V2 UI migration PRs.
Independent streams in parallel. Auctions work that does not touch V2 component directories may merge in any order relative to V2 UI work.
Conflict-zone files. Files identified as conflict zones in ADR-0002 (src/publish/orders.tsx, src/publish/featured.tsx, src/routes/_dashboard-layout/dashboard/index.tsx, src/lib/stores/nip60.ts) require coordination between stream owners. The AGENTS.md file in the relevant directory should document which stream currently owns the file.
Decision 5: CI gates on v2-integration
v2-integration must pass the full CI suite before any feature branch merges into it:

bun run test:unit
bun run format:check
NDK-footprint guard (scripts/check-ndk-footprint.sh) — per ADR-0002
Playwright e2e tests (including V2-route specs, once ADR-0003 PR 2 lands)
Widget book test coverage for migrated components — per ADR-0003 Decision 1e
Feature branches targeting v2-integration run CI against v2-integration as the base, not master. This ensures that the integration branch is always in a deployable (to staging) state.

Decision 6: v2-integration is not a permanent branch
The v2-integration branch is dissolved upon completion of Stage 3 (Default Promotion). At that point, v2-integration has been merged into master, V2 features are the default, and the legacy code paths have been removed per ADR-0003's cleanup steps.

If the V2 effort is abandoned or significantly descoped, v2-integration should be archived and individual salvageable features cherry-picked to master as independent PRs.

Consequences
Positive:

Rebasing overhead is halved: instead of three branches each rebasing against master, three streams merge into one integration branch that rebases against master.
Integration failures surface early. When Auctions and V2 UI both modify dashboard components, the conflict is visible on v2-integration immediately—not at final merge time.
PR diffs are smaller and more reviewable. Each feature branch merges into v2-integration with a focused diff. The eventual v2-integration → master merge is large but well-tested by that point.
The staged progression (dev-only → opt-in beta → default) reduces deployment risk. Features are validated in production by real opt-in users before becoming the default.
The gate mechanism is unified. Rather than three independent feature flags with inconsistent semantics, one umbrella gate with sub-flags controls all V2-era work.
Negative / Trade-offs:

v2-integration is a long-lived branch, which carries merge-debt risk if master advances rapidly. The rebase cadence mitigates but does not eliminate this.
CI runs on v2-integration include all three streams' code, which may surface failures caused by cross-stream interactions that are harder to diagnose than single-stream failures.
The sub-flag system adds configuration complexity. Developers must understand which combination of flags activates which features.
Stage 2 (opt-in beta) requires shipping V2 code to production, even if gated. This increases production bundle size and requires careful attention to ensure V2 routes are not accessible when the gate is off.
The dissolution of v2-integration depends on all three streams reaching completion. If one stream stalls, the branch may persist longer than anticipated.
Alternatives Considered
Alternative 1: Three independent long-lived branches, each merged to master separately
Rejected. Each branch would need to rebase against master independently, and cross-stream file overlaps would produce triplicated conflict resolution. There is no mechanism to validate cross-stream integration until a branch reaches master, at which point late failures are costly.

Alternative 2: Merge all three streams directly into master behind feature flags, no integration branch
Rejected. While this eliminates the integration branch, it requires all three streams to be merge-ready against master simultaneously. The streams have different maturity levels and development velocities. Merging incomplete work into master behind flags risks subtle leaks (ungated imports, shared state contamination) and produces large, hard-to-review PRs.

Alternative 3: Sequential integration — merge streams into master one at a time
Rejected. The streams have interdependencies (CMS depends on V2 UI components; Auctions and V2 UI both touch dashboard files). Sequential merge would force one stream to wait for another to fully land on master, serializing work that could otherwise proceed in parallel. The final stream would also face a large accumulated merge diff against an already-changed master.

Alternative 4: Monorepo workspaces with each stream in its own package
Rejected. The codebase is a single application, not a multi-package monorepo. Introducing workspace boundaries solely for branch management would impose structural overhead disproportionate to the problem and conflict with the existing architecture documented in ADR-0001 and ADR-0003.

Migration Plan
Step 1: Create v2-integration and establish CI
Branch v2-integration from master.
Configure CI to run the full suite against v2-integration as base for incoming PRs.
Document the branch in root AGENTS.md per ADR-0001's requirement that architectural changes be reflected in AGENTS.md.
Step 2: Land ADR-0003 foundation PRs on v2-integration
PR 1 (styles, directories, AGENTS.md files) and PR 2 (test harness) from ADR-0003 target v2-integration.
These establish the V2 gate, token system, and component directory structure that downstream streams depend on.
Step 3: Begin feature-stream work targeting v2-integration
Auctions, CMS, and V2 UI migration PRs target v2-integration.
Each PR activates its sub-flag and gates its routes behind the V2 umbrella flag.
Conflicts are resolved on v2-integration as they arise.
Step 4: Periodic rebase on master
v2-integration is rebased on master at a regular cadence (recommended: per sprint or after significant master merges).
CI must pass after each rebase before feature-stream PRs resume targeting the rebased branch.
Step 5: Evaluate Stage 2 readiness
When all three streams declare feature completeness, run full e2e and widget book validation.
If passing, implement the production opt-in mechanism (user setting toggle).
Deploy v2-integration (merged or branched to a release branch) to production with the gate defaulting to off.
Step 6: Stage 2 observation and Stage 3 promotion
Monitor opt-in beta for regressions over a maintainer-defined observation period.
Execute ADR-0003 PR 7 cleanup.
Flip the gate to default-on. Remove legacy code paths.
Merge to master. Dissolve v2-integration.
Open Maintainer Questions
Should the v2-integration rebase cadence be formalized (e.g., every Monday) or triggered by specific master events?
Should sub-flags (VITE_ENABLE_V2_AUCTIONS, VITE_ENABLE_V2_CMS) be environment variables only, or should they also be controllable via a dev-tools panel in the running app?
What is the minimum observation period for Stage 2 before Stage 3 promotion is eligible?
Should NIP-17 migration work (ADR-0013/0014) be gated behind the V2 flag as well, or does it proceed independently since it is transport-layer work that does not require V2 UI components?
How should the opt-in setting persist for users in Stage 2—local storage, Nostr event, or account setting?
A few notes on how I constructed this:

Numbering: I used ADR-0016 to avoid colliding with existing ADRs (0001, 0002, 0003, 0013, 0014). Adjust if you have a different numbering scheme.

Relationship to ADR-0003: The ADR explicitly preserves ADR-0003's core decisions (dual stylesheets, -v2 directories, ThemeMigrationWrapper, feature flag) and extends the gate concept rather than redefining it. ADR-0003's PR strategy is referenced but not modified—the v2-integration branch simply becomes the target for those PRs instead of master.

Key extensions beyond ADR-0003: The sub-flag system (VITE_ENABLE_V2_AUCTIONS, VITE_ENABLE_V2_CMS), the three-stage progression (dev-only → opt-in beta → default), the conflict-resolution rules, and the CI gating on the integration branch are all new to this ADR.

Let me know if you'd like to adjust the scope, tighten or loosen any of the stage requirements, or change the branch naming convention.