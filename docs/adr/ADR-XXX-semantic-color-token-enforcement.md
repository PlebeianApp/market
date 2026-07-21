# ADR-XXX: Semantic Color Token Enforcement

## Status

Proposed

## Date

2026-07-21

## Related

- `styles/globals.css` — existing CSS variable token system (`:root`, `.dark`, `@theme inline`)
- `src/components/ui/badge.tsx` — example of correct token-based styling
- `src/components/ui/alert.tsx` — Alert component using token-based variants
- `src/lib/utils.ts` — `cn()` utility for class merging
- AGENTS.md §Constraints — principle of preserving distinct semantic boundaries

## Context

The codebase has a functional CSS design token system in `styles/globals.css`. It defines `:root` CSS variables for both light and dark mode, custom brand colors, and a Tailwind v4 `@theme inline` block that maps them to semantic utility classes.

Available semantic tokens (proven by 259 existing correct uses):

- `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`
- `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`
- `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`
- Custom: `--neo-purple` (#ff3eb5), `--neo-blue`, `--light-gray`, `--off-black`, `--secondary-black`, `--tertiary-black`

Despite this system working, components routinely bypass it with raw Tailwind color utilities. Analysis of `src/components/**/*.tsx` reveals:

### Scale of the Problem

| Metric                                                                  | Count |
| ----------------------------------------------------------------------- | ----- |
| Raw Tailwind color class uses (text-/bg-/border- + named color + shade) | 775   |
| Distinct raw color classes                                              | 38    |
| Existing semantic token uses (proves the system works)                  | 259   |
| Inline `style={{}}` objects in components                               | 38    |

### Same Semantic Meaning, Different Shades

The same concept is rendered with multiple incompatible shades across files:

| Semantic meaning | Classes used                                                                                                     | Total uses | Distinct shades |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | --------------- |
| Error/danger     | `text-red-500/600/700/800`, `bg-red-50/100`, `border-red-200/300/400`                                            | 135        | 11              |
| Success/positive | `text-green-500/600/700/800/900`, `bg-green-50/100`, `border-green-200/300`                                      | 107        | 9               |
| Warning/caution  | `text-yellow-600/700/800`, `text-amber-500/600/700/800`, `text-orange-500/600`, + bg/border variants             | 99         | 16              |
| Neutral/muted    | `text-gray-400/500/600/700/900`, `bg-gray-50/100/200/300/400`, `border-gray-200/300`, `text-zinc-*`, `bg-zinc-*` | 309        | 14              |

Notably, `text-muted-foreground` already exists and is used 129 times — yet 309 additional uses of `text-gray-*` serve the same semantic purpose.

### Worst Offenders (verified)

| File                                              | Line(s)       | Violation                                                  |
| ------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| `src/components/WotScore.tsx`                     | 64            | `fill: 'orange'` — literal CSS color keyword               |
| `src/components/ProductSearch.tsx`                | 93            | `bg-[#1c1c1c]` — arbitrary Tailwind bracket value          |
| `src/components/dialogs/PickupLocationDialog.tsx` | 138           | `color: #71717a` — hardcoded hex inline                    |
| `src/components/pages/ProfilePage.tsx`            | 245, 376, 402 | `linear-gradient(45deg, ... #000 100%)` — hardcoded `#000` |
| `src/components/auth/NostrConnectQR.tsx`          | 373-374       | `#ffffff`, `#000000` hardcoded                             |
| `src/components/ui/qr-code.tsx`                   | 24-25         | Same `#ffffff`/`#000000` defaults                          |

### Root Cause

The token system exists and works. The problem is enforcement. Nothing stops a contributor from typing `text-red-500` instead of `text-destructive`. Every PR that introduces a raw color class compounds the inconsistency.

## Decision

**All colors in component code MUST route through the semantic CSS variable / Tailwind token system.** Raw Tailwind color utilities are prohibited.

### Rules

1. **No raw Tailwind named-color utilities**: `text-red-500`, `bg-gray-100`, `border-blue-200`, etc. are prohibited in `src/components/**/*.tsx`.
2. **No arbitrary Tailwind bracket values**: `bg-[#1c1c1c]`, `text-[#71717a]` are prohibited.
3. **No literal CSS color keywords**: `'orange'`, `'red'`, `'white'`, `'black'` in inline styles are prohibited.
4. **No hardcoded hex/rgb/hsl values** in inline styles or CSS-in-JS within component code.
5. **Semantic status tokens** that are missing from the system must be added: `--success`, `--warning`, `--info` (with light/dark variants and `@theme inline` mappings). The current system only has `--destructive` for error/danger.

### Exceptions

QR code rendering and canvas/SVG binary image output may use literal colors when the output is a binary black-and-white image (not a UI element). These cases must include a comment: `// ADR exception: QR binary output`.

## Invariants

- Every color visible in the rendered UI traces to a CSS variable defined in `styles/globals.css`.
- Adding a new color to the UI requires adding a token to `globals.css` first, then the `@theme inline` mapping.
- Dark mode works automatically because all colors are token-mapped — no per-component dark mode overrides.
- `grep -rnE '(text|bg|border)-(red|green|blue|yellow|gray|slate|zinc|orange|amber|emerald|rose|purple|indigo)-[0-9]+' src/components/` returns zero results (after migration completes).

## Consequences

### Positive

- Dark mode support becomes automatic — no per-component overrides.
- Brand color changes are a single-variable edit in `globals.css`.
- Visual consistency: the same semantic concept always renders the same shade.
- Semantic status colors (success/warning/error) are consistent across the entire app.
- Easier onboarding — one pattern instead of guessing hex values.
- Lint enforcement prevents regression.

### Costs

- ~775 raw color uses need migration (incremental, see Rollout).
- Missing `--success`/`--warning`/`--info` tokens must be designed and added first.
- Edge cases (gradients, canvas) need token-compatible solutions or documented exceptions.
- Slightly more friction for quick prototypes — must define or find a token.

## Rollout

### Phase 0: Add Missing Semantic Tokens

Add `--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--info`, `--info-foreground` to `:root` and `.dark` in `styles/globals.css`. Add corresponding `@theme inline` entries so `bg-success`, `text-warning`, etc. become available.

### Phase 1: Fix Worst Offenders (separate commits)

- `WotScore.tsx`: replace `fill: 'orange'` with `fill: 'var(--warning)'`
- `ProductSearch.tsx`: replace `bg-[#1c1c1c]` with nearest token
- `PickupLocationDialog.tsx`: replace `color: #71717a` with `text-muted-foreground` equivalent
- `ProfilePage.tsx`: replace `#000` gradients with token-based gradients

### Phase 2: Migrate by Color Family (one PR per family)

- Error family: all `text-red-*`, `bg-red-*`, `border-red-*` → `--destructive`
- Success family: all `text-green-*`, `bg-green-*`, `border-green-*` → `--success`
- Warning family: all `text-yellow-*`, `text-amber-*`, `text-orange-*` → `--warning`
- Neutral family: all `text-gray-*`, `bg-gray-*`, `border-gray-*` → `--muted`, `--muted-foreground`, `--accent`, `--border`

### Phase 3: Lint Enforcement

Add a CI script or ESLint rule that rejects raw Tailwind color utilities and arbitrary bracket values in `src/components/**/*.tsx`. Model it after the existing `scripts/check-ndk-footprint.sh` ratchet pattern.

### Phase 4: QR Code Exception

Document inline exception comments for QR rendering files.

## Notes

The token system is not broken — 259 correct uses prove it works. This ADR addresses the enforcement gap, not an infrastructure gap. The problem is governance: without a rule and a lint check, every new PR introduces more raw colors.

This ADR reinforces the AGENTS.md principle of preserving clean separation between concerns. Just as state types must remain distinct (not collapsed into booleans), color semantics must remain distinct (success ≠ green-600 ≠ arbitrary hex) — they route through tokens that carry semantic meaning.
