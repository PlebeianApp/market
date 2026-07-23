# ADR-XXX: Error Boundary Strategy & Production Observability

## Status

Proposed

## Date

2026-07-23

## Related

- AGENTS.md: "Treat relay data as untrusted until validated" (unvalidated relay
  data can trigger the render errors this ADR addresses)
- ADR-XXX-relay-data-validation-enforcement (validated data prevents the most
  common cause of render crashes)

---

## Problem

Plebeian Market is a Single Page Application (SPA). The entire user interface
is rendered by JavaScript in the browser. When a component throws an error
during rendering, React unmounts the entire component tree — the user sees a
blank white screen with no recovery path. Unlike a traditional multi-page
website, there is no "navigate to another page" fallback.

Two architectural gaps make this worse:

1. **Zero React Error Boundaries.** No `ErrorBoundary`, `componentDidCatch`,
   or `errorElement` exists anywhere in the application (410 files audited).
   Any uncaught render error — from a malformed relay event to a null
   reference — crashes the entire SPA.

2. **Production console suppression is total.** `src/frontend.tsx:17-20`
   replaces ALL console methods (including `console.error`) with empty
   functions in production builds. This was done to keep the console clean
   for users, but it also blinds the team completely: when errors occur in
   production, there is no log, no trace, no error report. No one knows.

## Decision

### Part 1: Error Boundary Placement

Add React Error Boundaries at two levels:

**Per-Route Boundaries (minimum requirement):**
Each top-level route wraps its content in an `<ErrorBoundary>` with a
fallback UI ("Something went wrong. Click here to retry."). A render error
in one route does not affect other routes or the app shell.

**Per-Feature Boundaries (recommended for high-risk areas):**
Components that consume external data (relay events, payment responses,
wallet state) get their own error boundaries. This isolates failures to the
specific component rather than the entire route.

**App-Shell Boundary (safety net):**
A root-level boundary catches any error that escapes route/feature
boundaries. Shows a global fallback with a "reload" button.

### Part 2: Production Error Reporting

Replace the nuclear console suppression with a tiered approach:

**Keep silenced in production:**
- `console.log` — development-only debug noise
- `console.debug` — verbose debugging
- `console.info` — non-critical information

**RESTORE in production:**
- `console.error` — critical. Errors must be visible.

**Add structured error reporting (privacy-preserving):**
Errors are reported to a backend endpoint (or error tracking service) with:
- Error message and stack trace (sanitized — no user data)
- Route/URL where the error occurred (path only, no query params)
- App version / git commit hash
- Timestamp
- Error boundary that caught it (route-level vs feature-level)

**Explicitly NOT reported:**
- User pubkey, npub, or any Nostr identity
- Payment details, invoice numbers, amounts
- Relay connection details or relay URLs
- localStorage contents
- Wallet state or seed material
- Any PII

The error reporter sends only technical diagnostic data: what broke, where
it broke, and the stack trace. Think of it like a crash report from a desktop
app — the app says "function X threw error Y at line Z" without including
any of the user's data.

### Part 3: Floating Promise Policy

Promises without `.catch()` silently swallow rejections. The application has
9+ floating promises. Decision: add an ESLint rule (`no-floating-promises`
from typescript-eslint) to catch these at build time.

---

## Current Violations (Transient — remove as fixed)

### Missing Error Boundaries

| Location | Severity | Notes |
|----------|----------|-------|
| App root (`src/frontend.tsx`) | Critical | No root-level boundary — any uncaught error kills the SPA |
| All route components | High | No per-route boundaries |
| Payment flow components | High | `LightningPaymentProcessor` handles external data, no boundary |
| Relay-consuming components | High | `NostrConnectQR`, `ProfileSearch`, `MigrationForm` — all do raw `JSON.parse` in render |

### Console Suppression

| File | Line | Issue |
|------|------|-------|
| `src/frontend.tsx` | 17-20 | All console methods silenced in production, including `console.error` |

### Floating Promises (no `.catch()`)

| File | Line | Code |
|------|------|------|
| `src/routes/_dashboard-layout/dashboard/products/shipping-options.tsx` | 153, 1157 | `getUser().then(setUser)` |
| `src/components/migration/MigrationForm.tsx` | 111 | `getUser().then(setNdkUser)` |
| `src/components/auth/LoginDialog.tsx` | 141 | `.then(() => handleLoginSuccess())` |
| `src/lib/ctxcn-client.ts` | 177, 200 | `.catch(() => {})` — catches but swallows |

### Silent Catches

| File | Line | Issue |
|------|------|-------|
| `src/components/messages/ChatMessageBubble.tsx` | 105 | `} catch {}` — swallows message parse errors |
| `src/lib/ctxcn-client.ts` | 177, 200 | Catches relay publish failures silently |

---

## Consequences

### Positive

- Render errors show user-friendly fallback UI instead of white screen
- Production errors are visible to developers — faster bug detection and fixes
- Error reports contain no user data — privacy-preserving
- Floating promise rejections are caught at build time, not silently lost
- Per-route boundaries mean a broken feature doesn't kill the entire app

### Costs

- Error boundaries must be added incrementally (start with app root, expand)
- Error reporting backend endpoint or service needs setup
- Sanitization of stack traces requires care (strip user paths, keys)
- `no-floating-promises` ESLint rule has a learning curve for contributors

## Notes

This ADR follows the "persistent rule + transient violations" pattern:
- The Problem and Decision sections define the permanent standard
- The "Current Violations" section tracks specific codebase issues — entries
  are removed as PRs fix each one. When all are fixed, the section is deleted.
