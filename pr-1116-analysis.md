# PR #1116 Analysis: What to Preserve, What to Drop

## Executive Summary

**PR #1116 should be CLOSED.** A focused replacement PR with the same 13 commits
should be opened from a fresh branch based on current `master`.

The PR was created against an old base (`b6869d52`) that predates the auctions
feature merge. GitHub still shows 209 files / 34,944 additions because it diffs
against that stale base. Against **current upstream `master`** (`7bce8d6d`), the
actual unique changes are:

| Metric        | PR #1116 (stale base) | vs. current master |
|---------------|----------------------|--------------------|
| Commits       | 311                  | 13                 |
| Files changed | 209                  | 13                 |
| Insertions    | 34,944               | 346                |
| Deletions     | 1,037                | 34                 |

**The auction feature (298 commits, ~196 files) is already in master.** It was
merged separately (likely via PR #1138 or direct commits). The PR body's claim
of "zero production code changes" is **true for the 13 real commits** — they are
all test infrastructure and docs. The 34,944 additions are an artifact of the
stale diff base.

---

## 1. File Categorization (all 209 PR files)

### Against current master, only 13 files have actual changes:

#### (a) Test-only changes worth keeping — 8 files
| File | Change | Commit(s) |
|------|--------|-----------|
| `e2e/tests/auth.spec.ts` | networkidle→domcontentloaded (12 sites), hydration race fix, dialog overlay JS click, timeout increase | `2490435e`, `ad4b5e0f` |
| `e2e/tests/app-settings.spec.ts` | networkidle→domcontentloaded | `40af359d` |
| `e2e/tests/user-profile.spec.ts` | networkidle→domcontentloaded | `40af359d` |
| `e2e/tests/products.spec.ts` | networkidle→domcontentloaded | `40af359d` |
| `e2e/tests/cart.spec.ts` | basket button tooltip overlay JS click | `15ab3b7d` |
| `e2e/tests/marketplace.spec.ts` | flexible payment heading selector `.or()`, WebLN stale locator re-query in loop | `4b7fc456`, `dce26ca9` |
| `e2e/tests/product-page.spec.ts` | unskip comment reaction test | `49572ef9` |
| `e2e/tests/shipping-special.spec.ts` | unskip 2 stable tests (digital delivery, local pickup) | `49572ef9` |
| `src/queries/__tests__/external.test.ts` | timeout comment (no logic change) | `f1777ea9` |

#### (b) Auction feature code — belongs to #1138, NOT #1116
**Already merged to master.** These ~196 files (AuctionFormContent.tsx +2026,
auctions.tsx +976, AuctionBidder.tsx +589, etc.) show as additions only because
the PR's base predates the auctions merge. They produce **zero diff against
current master.** No action needed — they're already upstream.

#### (c) CI/config changes — 2 files
| File | Change | Commit |
|------|--------|--------|
| `bunfig.toml` | `[test]` section: exclude `e2e/**` and `**/*.spec.ts` from bun test runner | `f660af32` |
| `package.json` | `--timeout=15000` on `test:unit`, `test:unit:watch`, `test:integration` | `f1777ea9` |

#### (d) Docs — 2 files
| File | Change | Commit(s) |
|------|--------|-----------|
| `e2e/ARCHITECTURE.md` | +44 lines: "Pragmatic Exceptions" section (hydration wait, JS click, domcontentloaded) | `ad4b5e0f` |
| `docs/adr/ADR-XXX-e2e-test-stabilization-strategy.md` | NEW (232 lines): full e2e stabilization strategy ADR | `40af359d`, `d1819b26`, `5ec3d624` |

#### (e) Noise/dead files — 0
No dead files in the 13-commit diff. The prettier formatting commits (`d6eafaf1`, `054c14a8`) touched the ADR and e2e files but produced trivial whitespace-only changes.

---

## 2. Pure Test Infrastructure Commits (Cherry-Pick Candidates)

All 13 commits are test-infrastructure only. Listed in chronological order:

| # | SHA | Message | Category |
|---|-----|---------|----------|
| 1 | `f1777ea9` | fix(test): increase bun test timeout to 15s for mock module setup | config |
| 2 | `2490435e` | fix(e2e): auth login button hydration race + dialog overlay interception | test |
| 3 | `15ab3b7d` | fix(e2e): cart basket button tooltip overlay interception | test |
| 4 | `4b7fc456` | fix(e2e): WebLN button stale locator in 4-seller checkout loop | test |
| 5 | `ad4b5e0f` | fix(e2e): migrate remaining networkidle→domcontentloaded in auth.spec + document pragmatic wait exceptions | test+docs |
| 6 | `dce26ca9` | fix(e2e): flexible payment step heading selector for marketplace | test |
| 7 | `40af359d` | fix(e2e): migrate final 3 networkidle→domcontentloaded + ADR-015 | test+docs |
| 8 | `49572ef9` | fix(e2e): unskip 3 stable tests (shipping-special x2, product-page x1) | test |
| 9 | `d6eafaf1` | style: prettier format ADR-015 | cosmetic |
| 10 | `054c14a8` | style: prettier format all e2e test files | cosmetic |
| 11 | `f660af32` | fix(test): exclude Playwright .spec.ts files from bun test runner | config |
| 12 | `d1819b26` | docs(adr): rename ADR-015 → ADR-XXX, fix PR ref, add stacked-PR history notes | docs |
| 13 | `5ec3d624` | docs(adr): add happy-path video requirement for PR review readiness | docs |

---

## 3. Auction Feature Commits

**All 298 non-test commits are already in upstream master.** They were absorbed
when the auctions feature was merged (via #1138 or direct commits to master).
Against current master, they produce zero diff. No action needed.

---

## 4. Cherry-Pick Verification: ✅ CLEAN

**Tested:** All 13 commits cherry-picked onto `upstream/master` (`7bce8d6d`)
with **zero conflicts**.

```
git checkout -b test-cherry-pick-1116 upstream/master
git log --reverse --format='%H' upstream/master..fork/fix/test-infra-and-e2e-reliability \
  | while read sha; do git cherry-pick "$sha"; done
```

Result: All 13 applied cleanly. Verification diff against the PR branch showed
differences ONLY in production files (NDK migration code, orders.tsx) that exist
on the PR's old base but not on current master. The 13 test files themselves
were identical between the cherry-picked branch and the PR branch.

**No dependencies on auction feature code.** The commits are self-contained.

---

## 5. Recommendation

### Close PR #1116

**Reasons:**
1. The PR diff is misleading — 209 files / 34,944 additions against a stale base
2. 298 of 311 commits are already in master (auctions feature)
3. Reviewers see an enormous, unreviewable diff for what is actually 346 lines
4. The ADR itself (commit `d1819b26`) says: *"PR #1116 should NOT target
   upstream directly. Instead, the e2e test-infra fixes should be shaved off
   into a focused upstream PR."*

### Open a Single Replacement PR

**Branch:** `fix/e2e-test-infra` (or similar), based on current `master`

**Content:** All 13 commits, cherry-picked in order (verified clean above)

**Suggested PR title:** `fix(e2e): test infrastructure reliability — networkidle migration, hydration fixes, bunfig exclusion`

**Suggested PR body:**
```
## Summary

Consolidated e2e test infrastructure fixes extracted from #1116.

### Changes
- **networkidle → domcontentloaded** migration across all remaining spec files
  (NDK WebSocket prevents networkidle from ever firing)
- **Auth hydration race fix** — 500ms settle wait + JS click to bypass dialog
  overlay interception
- **Cart basket tooltip fix** — JS click bypass for pointer event interception
- **WebLN stale locator** — re-query button inside checkout loop
- **Flexible payment heading selector** — `.or()` matcher for UI version drift
- **3 test unskips** — shipping-special (×2), product-page comment reaction (×1)
- **bunfig.toml** — exclude Playwright .spec.ts from bun test runner
- **Timeout increase** — `--timeout=15000` for CI runner performance
- **ADR-XXX** — e2e stabilization strategy documentation

Closes #1116 (supersedes).
```

### No Other PRs Needed

There are no auction commits to extract — they're already in master. The only
work worth preserving is the 13 test-infra commits above.
