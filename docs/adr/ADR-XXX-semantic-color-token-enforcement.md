# ADR-XXX: Semantic Color Token Enforcement

## Status

Proposed

## Date

2026-07-21

## Related

- `styles/globals.css` — existing CSS custom property system (`:root`, `.dark`, `@theme inline`)
- `src/components/ui/badge.tsx`, `src/components/ui/alert.tsx` — shadcn primitives using semantic tokens
- `src/components/ui/button.tsx` — Button component with variant system
- `src/lib/utils.ts` — `cn()` utility for class merging
- `src/components/AGENTS.md` — component-level operating guidance
- AGENTS.md §"Constraints" — state separation principles (this ADR extends the same discipline to visual representation)

## Context

The codebase has a well-established design token system in `styles/globals.css`:

- `:root` defines 30+ CSS custom properties: `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--background`, `--foreground`, `--border`, `--ring`, etc.
- `.dark` class overrides all tokens for dark mode.
- `@theme inline` maps every CSS variable to Tailwind v4 color utilities (`bg-primary`, `text-muted-foreground`, `border-destructive`, etc.).
- 259 semantic token uses already exist across components (e.g. `text-muted-foreground` x129, `text-secondary` x30, `bg-primary` x22).

Despite this, **775 raw Tailwind color class uses** bypass the token system entirely. The same semantic concept is represented by multiple inconsistent shades:

| Semantic meaning | Classes in use | Total uses | Distinct shades |
|---|---|---|---|
| Error / danger | `text-red-500`, `text-red-600`, `text-red-700`, `text-red-800`, `bg-red-50`, `bg-red-100`, `border-red-200`, `border-red-300`, `border-red-400` | 135 | 4 text shades + 2 bg shades + 3 border shades |
| Success / positive | `text-green-500`, `text-green-600`, `text-green-700`, `text-green-800`, `text-green-900`, `text-emerald-950`, `bg-green-50`, `bg-green-100`, `border-green-200`, `border-green-300` | 107 | 5 text shades + 2 bg shades + 2 border shades |
| Warning / caution | `text-yellow-600`, `text-yellow-700`, `text-yellow-800`, `text-amber-500`, `text-amber-600`, `text-amber-700`, `text-amber-800`, `bg-yellow-50`, `bg-amber-50`, `border-yellow-400`, `border-amber-200` | 99 | 7 text shades across 2 color families |
| Neutral / muted | `text-gray-400`, `text-gray-500`, `text-gray-600`, `text-gray-700`, `text-gray-900`, `bg-gray-50`, `bg-gray-100`, `bg-gray-200`, `bg-gray-300`, `border-gray-200`, `border-gray-300` | 309 | 5 text shades + 4 bg shades + 2 border shades |
| Info / primary | `text-blue-500`, `text-blue-600`, `text-blue-700`, `text-blue-800`, `bg-blue-50`, `bg-blue-100`, `border-blue-200` | 73 | 4 text shades + 2 bg shades |

Key examples of the problem:

- `src/components/WotScore.tsx:64` — `style={{ fill: 'orange' }}` — literal CSS color keyword, not even a Tailwind class
- `src/components/ProductSearch.tsx:93` — `bg-[#1c1c1c]` — arbitrary Tailwind value bypassing tokens
- `src/components/pages/ProfilePage.tsx:245,376,402` — hardcoded `linear-gradient(... #000 100%)` in inline styles
- `src/components/dialogs/PickupLocationDialog.tsx:138` — `color: #71717a` inline
- `text-gray-500` appears 70 times — `text-muted-foreground` already exists for the same semantic purpose (129 uses)
- Error display uses 4 different red shades across components for the same "something went wrong" concept

The `--destructive` token (`#bf4040` light / `hsl(0 62.8% 30.6%)` dark) exists but is used only 17 times, while raw red classes are used 135 times.

### Root cause

No enforced convention. The token system was set up correctly, but nothing prevents contributors from using raw Tailwind color utilities. Each PR can introduce more hardcoded colors. Over time, the token system has become one option among many rather than the standard.

## Decision

All UI colors MUST route through the semantic design token system defined in `styles/globals.css`. The following are **prohibited** in component code (`src/components/**/*.tsx`, `src/routes/**/*.tsx`):

1. **Raw Tailwind color utilities** — `text-red-500`, `bg-gray-100`, `border-blue-200`, etc. Use `text-destructive`, `bg-muted`, `border-primary`, etc. instead.
2. **Arbitrary Tailwind color values** — `bg-[#1c1c1c]`, `text-[#71717a]`, etc. If a color is needed that doesn't exist as a token, add it to `globals.css` first.
3. **Inline CSS color values** — `style={{ color: '#fff' }}`, `style={{ fill: 'orange' }}`, `style={{ background: 'linear-gradient(... #000 ...)' }}`. Extract to a CSS class or use a token.
4. **CSS color keywords** — `orange`, `red`, `blue`, etc. in style attributes.

### Allowed

- Semantic Tailwind utilities: `text-primary`, `bg-secondary`, `text-muted-foreground`, `border-destructive`, `text-accent-foreground`, etc.
- CSS variables in inline styles when no Tailwind utility maps: `style={{ fill: 'var(--primary)' }}` (already used in `Nip05Badge.tsx`, `WotScore.tsx`).
- Opacity modifiers on tokens: `bg-primary/50`, `text-muted-foreground/80`.

### New semantic tokens required

The current token system lacks tokens for status colors that components currently express through raw Tailwind classes. The following tokens must be added to `globals.css`:

```css
:root {
  /* Status: success */
  --success: #16a34a;          /* green-600 equivalent */
  --success-foreground: #052e16;
  --success-muted: #f0fdf4;    /* green-50 */

  /* Status: warning */
  --warning: #ca8a04;          /* amber-600/yellow-600 blend */
  --warning-foreground: #422006;
  --warning-muted: #fefce8;    /* yellow-50 */

  /* Status: info */
  --info: #2563eb;             /* blue-600 */
  --info-foreground: #eff6ff;
  --info-muted: #eff6ff;       /* blue-50 */
}

.dark {
  --success: hsl(142 70% 45%);
  --success-foreground: hsl(0 0% 98%);
  --success-muted: hsl(150 85% 12%);

  --warning: hsl(38 92% 50%);
  --warning-foreground: hsl(0 0% 98%);
  --warning-muted: hsl(38 80% 15%);

  --info: hsl(217 91% 60%);
  --info-foreground: hsl(0 0% 98%);
  --info-muted: hsl(217 80% 15%);
}
```

These map to Tailwind utilities via `@theme inline`: `text-success`, `bg-success-muted`, `border-warning`, etc.

### Enforcement

A lint rule (ESLint custom rule or Tailwind CSS linter) should reject raw color utilities in `src/components/` and `src/routes/`. The rule should:

1. Match `text-`, `bg-`, `border-` prefixes followed by a raw color family name (red, green, blue, yellow, gray, slate, zinc, orange, amber, emerald, rose, purple, indigo, teal, cyan, sky, lime, pink, violet, fuchsia, stone, neutral) and a shade number.
2. Match arbitrary value syntax: `[#hex]`, `[rgb()]`, `[hsl()]`.
3. Allow an allowlist for `src/components/ui/` (shadcn primitives that define base styles).

## Invariants

1. No raw Tailwind color utility classes (`text-red-500`, `bg-gray-100`, etc.) appear in `src/components/` or `src/routes/` (except `src/components/ui/` base primitives).
2. No arbitrary color values (`bg-[#...]`, `style={{ color: '#...' }}`) appear in component code.
3. All semantic color concepts (error, success, warning, info, muted, primary, secondary) have dedicated CSS custom properties in `globals.css`.
4. Adding a new color to the UI requires adding a token to `globals.css` first, then using the corresponding Tailwind utility.
5. The token system covers both light and dark modes for all semantic colors.

## Consequences

### Positive

- Single source of truth for all colors — changing a theme color is a one-line change in `globals.css`.
- Dark mode works automatically — tokens already switch via `.dark` class.
- Visual consistency — "error" always looks the same across the entire app.
- Onboarding clarity — new contributors use `text-destructive` instead of guessing which red shade to use.
- Design system maturity — tokens can be exported, documented, and shared with designers.

### Costs

- **Migration effort**: 775 raw color class uses need replacing. This is incremental — each PR that touches a component can migrate its colors.
- **New tokens needed**: success, warning, info tokens must be added before components can migrate those usages.
- **Lint rule maintenance**: custom ESLint rule needs upkeep as Tailwind evolves.
- **Learning curve**: contributors must learn the token names. Mitigated by the fact that 259 uses already follow this pattern.

## Rollout / PR sequence

### PR 1 — Add missing semantic tokens

Add `--success`, `--warning`, `--info` (and their `-foreground`, `-muted` variants) to `:root` and `.dark` in `styles/globals.css`. Map them via `@theme inline`.

Files: `styles/globals.css` only.

### PR 2 — Add lint rule for raw color utilities

Add a custom ESLint rule (or Tailwind CSS linter config) that rejects raw color utilities in `src/components/` and `src/routes/`, with an allowlist for `src/components/ui/`.

Files: `.eslintrc` or equivalent, custom rule file.

### PR 3+ — Migrate components incrementally

Each PR migrates one component directory or one semantic color group:
- PR 3: Replace all `text-red-*` / `bg-red-*` with `text-destructive` / `bg-destructive` across components.
- PR 4: Replace all `text-green-*` / `bg-green-*` with `text-success` / `bg-success-muted`.
- PR 5: Replace all `text-yellow-*` / `text-amber-*` with `text-warning` / `bg-warning-muted`.
- PR 6: Replace all `text-gray-*` / `bg-gray-*` with `text-muted-foreground` / `bg-muted`.
- PR 7: Replace all `text-blue-*` / `bg-blue-*` with `text-info` / `bg-info-muted`.
- PR 8: Fix inline styles and arbitrary values (WotScore, ProfilePage, ProductSearch, PickupLocationDialog, NostrConnectQR, qr-code.tsx).

Each migration PR is small, reviewable, and independently mergeable.

## Notes

- The `src/components/ui/` directory (shadcn primitives) is exempt because it defines base component styles that reference tokens, not raw colors. These files are the bridge between tokens and components.
- `getHexColorFingerprintFromHexPubkey()` and `getColorFromNpub()` in `src/lib/utils.ts` generate HSL colors from pubkey hashes for avatar identification. These are dynamic by design and exempt from the token requirement.
- `src/components/ui/qr-code.tsx` uses `#ffffff` / `#000000` as QR code defaults. QR codes require literal black/white for scanner compatibility — this is a valid exception that should be documented with a comment.
- The existing `--neo-purple`, `--neo-blue`, `--neo-gray`, `--off-black`, `--secondary-black` custom colors are brand-specific tokens and remain allowed.