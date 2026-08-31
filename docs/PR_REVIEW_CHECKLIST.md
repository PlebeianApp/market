# PR Review Checklist — PlebeianApp/market

Derived from the maximotodev review-profile audit (nine-chunk synthesis,
audit window 2026-03-31 → 2026-08-20; 100 PRs, ≈158 formal review
submissions). These criteria carried CHANGES_REQUESTED blockers in the
audited record; the "out of scope" section lists what the same record shows
must NOT be gated on.

Use with `docs/REVIEWER_SYSTEM_PROMPT.md`, which defines the process and
voice; this file is the pass/fail checklist.

## A. Trust boundaries (block on any miss)

- [ ] **Relay data validated before promotion.** No relay-observed event
      becomes settlement, payment, or truth state without authorship,
      coordinate (`kind:pubkey:d` where applicable), and amount cross-checks.
      Matching an `a` tag alone is not enough.
- [ ] **Signed ≠ authorized.** A valid signature on a wrong-author event
      (e.g., wrong-author kind-1025/kind-1024) is rejected _before_ canonical
      state mutation. Authentication never substitutes for per-bid/per-auction
      authorization.
- [ ] **Issuer gating.** Signer-backed workers gate fetched data by issuer
      public key (e.g., `path_issuer === ctx.issuerPubkey`), not by relay
      report or relay order.
- [ ] **No re-signing raw relay events** as system/CVM commentary.
- [ ] **Mint tags treated as signed trust policy.** Free-form custom mints
      carry an explicit threat model (seller-controlled malicious mint =
      rug-pull risk for bidders). Trusted mints are not a UI preference.
- [ ] **Display components validate too.** Remote URLs scheme-allowlisted;
      pubkeys matched exactly against `/^[0-9a-fA-F]{64}$/`; kind-0 profile
      strings runtime-validated before string ops (NDK types are not runtime
      validation); untrusted nested media scheme-gated before render
      (privacy/tracking surface).
- [ ] **No cross-user state leakage under client identity changes.** No prior
      user's form state, draft, or cache ever loads under a different pubkey.
      Any user-visible form edit sufficient to restore a draft is sufficient
      to create it.
- [ ] **Comment/graph recursion guards** on any recursion over relay-derived
      structures.

## B. Publish / signing boundary

- [ ] Validation crosses a **named boundary before signing**; the publish
      layer is not UI-driven for signed economic objects.
- [ ] No validation after `mutateAsync` / signing; **no silent mint
      fall-through** during locking.
- [ ] Relay-provided duplicate tags derive **no** semantics the app itself
      would not publish.
- [ ] Derived values fail closed: sats-mode publish with unresolved derived
      price is an error, **never coerced to zero**.
- [ ] Zero-relay publish result = failure (surfaced as such, not success).
- [ ] Payment flow passes a canonical mint, not a display-side "closest
      underfunded mint" heuristic.
- [ ] Modal/confirm UI does not double as submission (rules-modal confirm
      button that also posts a bid is a structural blocker).

## C. Canonical identity & deterministic selection

- [ ] Canonical refs used everywhere identity matters: shippingRef
      first-occurrence dedupe with collision-safe keys; addressable-event
      `kind:pubkey:d` identity; dedupe by event ID before `NDKEvent` wrapping.
- [ ] Coordinate-aware live-activity `d` derivation — relay may return zero
      events for `'#d': [dTag]` even when the event exists; code must not
      assume otherwise.
- [ ] Deterministic conflict selection independent of relay arrival order
      (e.g., higher `created_at`, then lexicographically lower event ID).
- [ ] Validation ordered **before** dedupe (later `find()` on the surviving
      item cannot recover an event discarded pre-validation).
- [ ] Canonical winner derived from an accepted bid set — not validated raw
      leader selection.

## D. Fail-closed state semantics

- [ ] `authorization unavailable ≠ authorized`; `unknown ≠ unspent`;
      `SPENT ≠ seller received funds (or seller consumed it)`. States are not
      collapsed. UI copy reflects the collapse risk ("Bidding closed;
      settlement pending", never a settlement claim from bid-close time).
- [ ] Missing/undefined trust config → **fail closed**, not an
      author-constraint-removing `undefined`.
- [ ] Sender-side delivery state committed **before** recipient delivery, so
      partial failure doesn't orphan merchant orders; durable across process
      restarts.
- [ ] Payment state is a **lifecycle** (requested, attempted, wallet
      acknowledged, settled/proven, receipt published, ...), never a boolean;
      no equating wallet acknowledgement / receipt publication / zap presence
      with settlement.
- [ ] Query semantics distinguished (disabled vs pending; `keepPreviousData`
      placeholder traps; entities created mid-session visible without
      remount).
- [ ] Cache keys + invalidations form a **closed loop** with consumers
      (success-path publication invalidating the wrong key = custody-relevant
      blocker).
- [ ] Commit persisted state only after publish succeeds.
- [ ] Single-flight = coalescing, not Promise identity.
- [ ] JavaScript truthiness traps checked in state-repair paths (`'0'` is
      truthy); zero-I/O proofs for invalid input paths.

## E. Scope discipline

- [ ] One PR, one slice. Protocol-semantics changes split from UI changes.
- [ ] Ride-alongs re-homed to **named** destination PRs/issues (a `.gitignore`
      hunk can be the sole blocker on a security PR).
- [ ] Contributor-local artifacts excluded; scope verified empirically
      ("restoring this file to the PR base removes it from the PR diff").
- [ ] No unexercised scope, unsafe abstractions kept for hypothetical future
      use, or YAGNI-violating extraction.
- [ ] Author-accepted follow-ups are **named** (issue, task doc, stacked plan)
      — accepted-but-homeless concerns are blockers.
- [ ] Mega-PRs (≥ ~15k lines) **do not** escape the scope gate: scope here is
      about unreviewable trust-path surface, not diff size. If it touches
      money/identity flows, demand the full structured review or a formal
      decomposition into reviewable slices.

## F. Test integrity & evidence

- [ ] Tests assert the behavior they claim: no always-true assertions
      (`expect(x || true).toBe(true)`), no vacuous casts passing regardless
      of nested data, no log-only tests, no swallowed `try/catch` failure
      paths, no Promise-identity masquerading as single-flight.
- [ ] Robust selectors (`data-testid`), not Tailwind-class selectors.
- [ ] Fixtures/seed data are **protocol-valid** — E2E seeds that would fail
      production parsers block merge; fixture readiness markers encode
      _authenticated_ state.
- [ ] Exact-value regression assertions on the exact filter/derivation value,
      not just type/existence checks.
- [ ] Named negative-path test matrix accompanies each blocking review.
- [ ] The PR's **own added specs are green locally** before merge —
      regardless of CI status and regardless of how long the PR has been
      stalled.
- [ ] E2E exercises the real user surface: no DOM surgery /
      `HTMLElement.click()` in place of lifecycle-respecting interaction; the
      lifecycle bug gets fixed and tested, and filed as a named issue.
- [ ] Bot (`@codex review` etc.) findings individually adjudicated: fix,
      rebut in writing, or file as a named follow-up. **Never** merge with
      open, unadjudicated bot P1/RISK findings ("lgtm 🚀" over unadjudicated
      RISKs is the documented anti-pattern).
- [ ] CI evidence adjudicated, not accepted: baseline-normalize flaky E2E
      against master; green runs that validate a base-equivalent tree are
      discounted; retried-pass not clean evidence; "green run does not cover
      the current synthetic merge commit" means not covered; PR-body
      "pre-existing failures" claims checked against actual runs.

## G. Verified truth over claims

- [ ] PR description aligned with the actual patch; stale claims grepped and
      corrected as a merge condition.
- [ ] UI copy epistemically honest: "Deletion request sent" (never
      "Deletion Verified" — NIP-09 best-effort); "Highest visible bid" (never
      "Top bid"); "metadata not observed from the configured relays" (never a
      genuine-absence claim); empty list ≠ failed load distinguished in both
      state and copy.
- [ ] Doc/ADR assertions factual ("proven to reduce flaky rates" requires an
      artifact); AGENTS/README claims verified against current code.
- [ ] Claims about what the change does **not** touch are negation-listed and
      spot-checked.

## H. State machines, caches, framework semantics

- [ ] Notification/badge counters authoritative, correctly scoped, race-free
      (no caller-derived decrements against the wrong auction; init/registration
      races handled).
- [ ] "No merchants" ≠ "failed to load merchants" — distinct states, distinct
      handling.
- [ ] Query-key identity matches between page reads and mutation refetches.
- [ ] Delivery/idempotence ordering verified (see D).

## I. Architecture, migrations, boundaries

- [ ] `src/AGENTS.md` / ADR boundaries verified, not assumed; seam imports
      respected; NDK footprint guard passes (127/127) with no literal
      `@nostr-dev-kit` usage added under `src/` / `contextvm/` (Wave 0); no
      NDK type leakage across migration boundaries (ADR-0002).
- [ ] Strangler-fig discipline: one module boundary per PR, atomic revert
      possible, ratcheting footprint guard, stacked PRs merged bottom-up,
      process-wide injection points flagged as non-production.
- [ ] Migrations **lossless** with respect to current publishers: legacy
      amount formats (`toFixed(2)`), `recipient` tags, empty payment proofs
      tolerated — or existing orders silently vanish when wired.
- [ ] New rules grandfather legacy code; dependency-direction tables
      included when adding import restrictions.

## J. Security & claims hygiene

- [ ] **Secret-sensitive-path screen run on every PR** (the audited blind
      spot: a dominant protocol objection did not excuse skipping workflow/
      dependency surfaces on the same 58-file PR).
- [ ] Workflow files as a distinct trust boundary: explicit workflow-safety
      attestation before approving; shell-injection hardening verified; no
      new unvetted egress.
- [ ] Leaked keys: rotation completion required, not just removal.
- [ ] WCAG AA contrast blocking: per-token-class ratio thresholds and
      deterministic contrast checks demanded where UI tokens change.

## Approval discipline (hard rules)

- [ ] Approve only with **executed evidence**: pinned head SHA, commands
      run, exact counts ("103 tests / 0 failures"), and explicit disclosure
      of what was _not_ verifiable — **or** an explicit in-approval statement
      of delegated verification (CI/bot/named co-reviewer).
- [ ] Never a glyph approval ("LGMT"/"lg"/empty body) on a large diff, a
      protocol-adjacent surface, an unadjudicated-bot-findings PR, or within
      seconds of merge — this is the audited erosion pattern.
- [ ] Re-verify at approval time against the current head; a heavy check in
      an earlier superseded round does not carry ("LGMT after 7 stalled
      weeks" is a documented miss).
- [ ] If your blocking review is dismissed by merge mechanics, re-review
      against the fixed head and re-file the formal verdict. A merged PR
      with a stale unresolved CR is a formal-record failure even when the
      substance was honored.
- [ ] Re-posted reviews must be re-verified, not copied verbatim; formal
      states must be self-contained (no empty-body reply vehicles).
- [ ] Blocker list narrows **monotonically** across rounds; resolved items
      enumerated by quoting the prior asks; no reopening resolved items;
      explicit supersession/no-reopening statements when superseding.

## Out of scope — do NOT block on

- Style/formatting (Prettier and nits), naming bikeshedding.
- Visual/UX direction — defer to the design maintainer, with specific,
  architectural compliments.
- Per-row scalability pressure **when the author accepts ownership as a
  named follow-up**.
- Docs regressions — route to a tracking item instead of gating.
- Packaging/harness issues when the PR's own logic is correct.
- Suspected issues you cannot substantiate — **explicitly acquit them**
  rather than inflating the blocker list (e.g., strict-mode locator
  "failures" and query-hook non-issues acquitted in the record).

## Proportionality guardrails

- Light gates for docs/infra/sync PRs; deep gates for payment, protocol,
  identity, and settlement surfaces.
- Cap your own asks: no full deferred-project implementation as the price of
  a small fix; state the smallest-safe-alternative or de-scope path; de-
  escalate explicitly ("The rest of my feedback is lower priority and can be
  follow-up").
- Latency tracks risk and co-reviewer coverage, not diff size.
