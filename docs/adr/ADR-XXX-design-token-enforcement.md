# ADR-XXX: Design Token Enforcement — All Colors Through the Token System

## Status

Proposed

## Date

2026-07-21

## Related

- `src/styles/globals.css` — existing CSS variable token system (light/dark mode, custom colors, Tailwind v4 `@theme` mapping)
- `src/components/ui/` — shadcn/ui primitives that already follow token-based styling
- `AGENTS.md` §Constraints — "Preserve the distinction between UI/form state, query/cache state..."

## Context

The codebase has a well-structured CSS design token system in `src/styles/globals.css`. It defines CSS variables for both light and dark mode, custom brand colors (`--neo-purple`, `--secondary-black`, `--off-black`), border radius tokens, and a Tailwind v4 `@theme` mapping that exposes these as semantic utility classes (`bg-background`, `text-foreground`, `text-primary`, `text-destructive`, etc.).

Despite this system existing, components routinely bypass it with hardcoded values:

| File | Line(s) | Violation |
|------|---------|-----------|
| `src/components/pages/ProfilePage.tsx` | 245, 376, 402 | `linear-gradient(45deg, ... #000 100%)` — hardcoded `#000` |
| `src/components/ProductSearch.tsx` | 93 | `bg-[#1c1c1c]` — arbitrary Tailwind bracket value |
| `src/components/dialogs/PickupLocationDialog.tsx` | 138 | `color: #71717a` — inline style |
| `src/components/WotScore.tsx` | 64 | `fill: 'orange'` — literal CSS color keyword |
| `src/components/auth/NostrConnectQR.tsx` | 373-374 | `#ffffff`, `#000000` hardcoded for QR rendering |
| `src/components/ui/qr-code.tsx` | 24-25 | Same `#ffffff`/`#000000` defaults |

Additionally, semantic status colors (success, warning, error) are applied inconsistently. Success is sometimes `text-green-600` (raw Tailwind palette) and sometimes a token. Warning uses the literal keyword `'orange'`. Error sometimes uses the `--destructive` token and sometimes doesn't.

## Decision

**All colors MUST route through the CSS variable / Tailwind token system.** Specifically:

1. **No hardcoded hex/rgb/hsl values** in component code (inline styles, Tailwind classes, or CSS modules).
2. **No arbitrary Tailwind bracket values** (`bg-[#1c1c1c]`, `text-[#71717a]`).
3. **No literal CSS color keywords** (`'orange'`, `'red'`, `'white'`) in component code.
4. **No inline `style={{ color/background/border }}`** with color values. Inline styles for layout properties are acceptable.
5. **Semantic status colors** (success, warning, error, info) get dedicated CSS variables and corresponding Tailwind utilities: `--success`, `--warning`, `--error`, `--info` with light/dark variants.

**Exception:** QR code rendering and canvas/SVG image generation may use literal colors when the output is a binary/black image, not a UI element. These cases are documented inline with a comment.

## Invariants

- Every color visible in the rendered UI traces back to a CSS variable.
- Adding a new color to the UI requires adding a token to `globals.css` first.
- Dark mode works automatically because all colors are token-mapped.
- A grep for hex color patterns (`#[0-9a-fA-F]{3,8}`) in `src/components/` returns only documented exceptions.

## Consequences

### Positive

- Dark mode support becomes automatic — no per-component dark mode overrides needed.
- Brand color changes are a single-variable edit in `globals.css`.
- Visual consistency improves — the same semantic concept always renders the same color.
- Easier onboarding — contributors follow one pattern instead of guessing hex values.

### Costs

- Existing violations need migration (see Migration section).
- Edge cases (gradients, canvas operations) require token-compatible solutions or documented exceptions.
- Slightly more friction for quick prototypes — must define a token or use an existing one.

## Notes

### Migration Strategy

1. **Add missing semantic tokens** to `globals.css`: `--success`, `--warning`, `--error`, `--info` with light/dark values.
2. **Add Tailwind `@theme` mappings** for the new tokens.
3. **Fix violations file-by-file**, each as a separate commit for reviewability:
   - Replace `#000` in ProfilePage gradients with `var(--secondary-black)` or appropriate token.
   - Replace `bg-[#1c1c1c]` in ProductSearch with the nearest token (likely `bg-secondary` or a new `--surface-dark` token).
   - Replace `#71717a` in PickupLocationDialog with `text-muted-foreground`.
   - Replace `'orange'` in WotScore with `var(--warning)` or `text-warning`.
   - QR code files: document as exception or parametrize with tokens where feasible.
4. **Add a lint check** (CI script or ESLint rule) that flags hardcoded hex values and arbitrary Tailwind bracket values in `.tsx` files under `src/components/`.

### Alignment with AGENTS.md

This ADR reinforces the AGENTS.md principle of preserving clean separation between concerns. Just as state types must remain distinct (not collapsed into booleans), color semantics must remain distinct (success ≠ green-600 ≠ arbitrary hex) — they route through tokens that carry semantic meaning.
