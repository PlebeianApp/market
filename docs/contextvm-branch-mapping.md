# ContextVM Minimal PR → Branch Mapping

This document maps the recommendations from `docs/contextvm-minimal-pr-checklist.md` onto the currently planned split branches.

## Important note

The current branch list does **not** include a dedicated `feature/contextvm-minimal-pr` branch.

That means the practical owner for the minimal, original ContextVM pricing-fallback scope is currently:

- `feature/contextvm-review-split-integration` (`e6c6ca7e`)

Recommendation: use `feature/contextvm-review-split-integration` as the temporary landing branch for the **bare-minimum feature set only**, and only pull in additional split branches after they are proven safe.

---

## 1) `feature/contextvm-review-split-integration` — `e6c6ca7e`

### Owns the bare-minimum feature scope

These checklist items belong here first:

#### Core feature implementation

- `contextvm/currency-server.ts`
- `contextvm/schemas.ts`
- `contextvm/tools/price-sources.ts`
- `contextvm/tools/rates-cache.ts`
- `src/lib/contextvm-client.ts`
- `src/lib/constants.ts`
- `src/queries/external.tsx`
- `package.json`
- `bun.lock`
- `.env.example` *(see note below about later rename work)*
- `scripts/fetch-btc-price.ts`

#### Core automated tests

- `contextvm/__tests__/currency-server.test.ts`
- `contextvm/tools/__tests__/price-sources.test.ts`
- `contextvm/tools/__tests__/rates-cache.test.ts`
- `contextvm/tools/__tests__/schemas.test.ts`
- `src/lib/__tests__/contextvm-client.test.ts`
- `src/lib/__tests__/contextvm-client.integration.test.ts`
- `src/queries/__tests__/external.test.ts`

#### Minimal support change

- `.gitignore` — **only** the `contextvm/data/` ignore

### Why

This is the original feature set required to achieve the branch goal:

- ContextVM currency server
- multi-source aggregation
- server-side cache
- frontend ContextVM-first fetch
- Yadio fallback
- enough automated validation to prove the feature works

### Keep out of this branch for now

Do **not** pull these in yet:

- `branch-plans.md`
- `.github/workflows/ci-unit.yml`
- OpenCode/local `.gitignore` noise
- `e2e-new/playwright-contextvm.config.ts`
- `e2e-new/tests/contextvm-org.spec.ts`
- `e2e-new/tests/currency-contextvm.spec.ts`
- `src/queries/__tests__/ephemeral-signer.test.ts`
- payment-flow E2E stabilization changes
- runtime rename / ctxcn / deploy / PM2 / script-generalization changes

### Note on `.env.example`

If you want the minimal integration branch to stay strictly focused on the original feature, keep only the env documentation needed for the current server implementation.

If the `CVM_SERVER_KEY` rename is treated as reviewer-follow-up rather than original feature scope, that rename work should be layered later from `feature/contextvm-server-runtime-rename`.

---

## 2) `feature/contextvm-server-runtime-rename` — `a1e89742`

### Owns reviewer follow-up runtime naming changes

These checklist/follow-up items belong here:

- `currency-server.ts -> server.ts`
- update references to the renamed runtime entrypoint
- production-only public relay announcement behavior
- broader tool-agnostic naming (`currency` -> `ContextVM tool/server` direction)
- `CVM_SERVER_KEY` rename if treated as follow-up rather than minimum feature scope

### Why

These are architectural/naming follow-ups requested in review, but they are not required to prove the original BTC pricing fallback feature.

### Should not own

- core pricing aggregation logic
- frontend fallback logic
- ctxcn-generated client work
- PM2/deploy changes
- payment-flow E2E stabilization

---

## 3) `feature/ctxcn-client-checkin-and-naming` — `b221c189`

### Owns ctxcn adoption and checked-in generated client artifacts

These checklist/follow-up items belong here:

- `ctxcn.config.json`
- generated client artifacts intended to be checked in
- naming cleanup around generated client files/classes
- import rewrites needed to consume the generated client

### Why

This is explicitly reviewer-requested follow-up work and is separate from proving that the pricing fallback works.

### Should not own

- the original browser-safe `src/lib/contextvm-client.ts` implementation **unless** this branch is intentionally replacing it after the minimal feature lands

---

## 4) `feature/test-script-generalization` — `f4826a95`

### Owns generalized test-script cleanup

These checklist/follow-up items belong here:

- broadening `package.json` scripts like `test:unit` and `test:unit:watch`
- script naming cleanup so suite boundaries are less feature-specific
- any follow-up workflow alignment needed because of those generalized scripts
- `.github/workflows/ci-unit.yml` **if** you decide to keep it as part of the generalized test-script / CI cleanup track rather than the minimal feature branch

### Why

This is useful repo hygiene and directly responds to review feedback, but it is not necessary to prove the pricing fallback feature itself.

### Should not own

- runtime rename
- ctxcn generation
- PM2 deploy rollout
- payment-flow E2E fixes

---

## 5) `feature/deploy-contextvm-pm2` — `6460257d`

### Owns deployment/process-manager changes

These checklist/follow-up items belong here:

- PM2 process definitions for the ContextVM server
- deploy script updates to ship and run the server
- restart / reload / process naming changes
- environment/deploy docs needed specifically for deployment

### Why

Deploy/PM2 changes are operational rollout work, not part of the minimal pricing fallback feature.

### Should not own

- core feature logic
- client generation
- runtime rename unless intentionally rebased on it later
- test-only E2E stabilization

---

## 6) `feature/fix-e2e-flaky-price-and-payment-clean-split` — `5eeb15e9`

### Owns E2E stabilization work only

These checklist/follow-up items belong here:

- payment-flow E2E stabilization
- shared E2E helpers for invoice readiness / WebLN waits
- any non-feature-critical E2E hardening
- optional retention of `e2e-new/tests/btc-price.spec.ts` **if** you want one app-facing E2E smoke test to be validated separately before integrating it

### Why

The CI evidence shows this branch is isolating test-stack behavior rather than proving the pricing fallback feature itself.

### Important constraint

This branch should **not** be required for the minimal ContextVM pricing feature to land.

If `btc-price.spec.ts` is kept in the minimal feature story at all, it should only be merged from this branch after it is validated independently and shown not to drag unrelated E2E flake into the integration branch.

---

## Recommended integration order

1. **Start with `feature/contextvm-review-split-integration` containing only the bare-minimum ContextVM pricing fallback feature and its core tests.**
2. Validate unit + integration + manual happy-path behavior there.
3. Only then consider layering in follow-up branches one at a time:
   - `feature/contextvm-server-runtime-rename`
   - `feature/test-script-generalization`
   - `feature/ctxcn-client-checkin-and-naming`
   - `feature/deploy-contextvm-pm2`
4. Keep `feature/fix-e2e-flaky-price-and-payment-clean-split` separate unless you explicitly decide a validated `btc-price.spec.ts` smoke test is worth importing.

---

## Short version

- **Minimal original feature:** `feature/contextvm-review-split-integration`
- **Runtime rename / CVM naming:** `feature/contextvm-server-runtime-rename`
- **ctxcn / checked-in generated client:** `feature/ctxcn-client-checkin-and-naming`
- **generalized test scripts / CI cleanup:** `feature/test-script-generalization`
- **deploy / PM2 rollout:** `feature/deploy-contextvm-pm2`
- **E2E stabilization:** `feature/fix-e2e-flaky-price-and-payment-clean-split`
