# `@plebeian/contract` — package spec

**Package version `0.1.0` · implements `contract/0.1.0-draft` (see `CONTRACT.md`, this directory).**

The overarching contract. The **only artifact shared between implementations**: `@plebeian/web` and
`@plebeian/napplet` share this and no code with each other, and modules (`@plebeian/product`,
`@plebeian/browse`) depend on it and never on an implementation.

## 1. What it owns

- **The interface** — `ModuleEnvironment`: the tool set a module is handed, grouped by grant
  (`CONTRACT.md` §2). Read tools today; `sign`/`publish` reserved and ungranted.
- **The shared vocabulary** — `QueryFilter` (the shape a module uses to ask for anything),
  `ReadResult`/`ReadFailureReason` (failures as values, in codes), `CONFIG_KEYS` (so no host invents a
  spelling), `ThemeTokens`, `Capability`.
- **The injectable defaults** — `TOKEN_FLOOR` (the token layer's values, paired with `tokens.css`),
  `DEFAULT_SEARCH_RELAYS`. Values a build inlines or a host overrides; **not** a component's own styling.
- **The boundary labels** — `TrustBoundary`, `ImplementationDescriptor`. Every implementation names
  itself, its boundary and the contract revision it satisfies.
- **The fixture implementation** (`./testing`) — an in-memory implementation used by every package's
  tests, including the cross-adapter conformance test.

## 2. What it must not contain

No I/O, no network client, no framework, no host, and **no dependency on any other `@plebeian` package**.
That last one is the load-bearing rule, and it is enforced by a test
(`packages/__tests__/conformance.test.ts`), because the LSP cannot catch it: an earlier draft of this very
file imported `QueryFilter` from `@plebeian/product` and inverted the dependency arrow. The filter shape
moved here instead.

## 3. Versioning

Three tracks, never conflated (`CONTRACT.md` §5): the contract (`contract/0.1.0-draft`), a module's feature
spec (e.g. `browsing-explore-search/0.5.0-draft`), and an implementation (its descriptor at runtime).
`CONTRACT_VERSION` is exported so an implementation cannot drift from the revision it claims.

## 4. Verification

- `src/__tests__/contract.test.ts` — the fixture implementation, the shape of a result, and that no
  implementation is granted a write capability.
- `src/__tests__/tokens.test.ts` — **the coherence check**: `TOKEN_FLOOR` and `tokens.css` are two
  encodings of one fact, and this test fails the pair when they disagree, in both directions.
- `packages/__tests__/conformance.test.ts` — the import-direction and no-policy-literals rules.

## 5. Open

- Whether `sign`/`publish` stay declared here or move to a separate write contract.
- O1: `config.get` is synchronous in the interface and asynchronous in a sandbox — a sandboxed surface
  must resolve the preference once at boot. Recorded, not hidden (`@plebeian/napplet`).
