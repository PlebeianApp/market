# Branch Plans

## 1) feature/fix-e2e-flaky-price-and-payment

### Goal

Stabilize flaky e2e tests on main and ensure they run earlier in branch workflows.

### Scope

- Fix timing assumptions in BTC price e2e checks.
- Fix payment-step readiness waits used by checkout/order/shipping e2e tests.
- Expand e2e workflow trigger coverage to include feature work before merge.

### Planned changes

- Update `e2e-new/tests/btc-price.spec.ts`:
  - replace immediate card text snapshot checks with explicit waits for sats/fiat rendering.
  - keep assertions semantic (price content), not layout-fragile.
- Add a shared helper (for example `e2e-new/utils/payment-waits.ts`) to:
  - wait for invoice readiness,
  - wait for and click `Pay with WebLN` reliably,
  - provide clear timeout diagnostics.
- Refactor payment flow tests to use the shared helper:
  - `e2e-new/tests/checkout.spec.ts`
  - `e2e-new/tests/shipping-special.spec.ts`
  - `e2e-new/tests/order-lifecycle.spec.ts`
  - `e2e-new/tests/order-messaging.spec.ts`
  - `e2e-new/tests/payments.spec.ts`
- Expand `.github/workflows/e2e.yml` trigger coverage:
  - include `feature/**` in `on.push.branches` (at minimum),
  - preserve existing `pull_request` triggers for `main`/`master`.

### Validation

- `bun run test:e2e-new` locally (or targeted subset first, then full suite).
- Confirm workflow syntax valid and e2e triggers on feature branch push.

### Out of scope

- App/payment business logic changes unless required for deterministic test behavior.
- Deploy/runtime/ContextVM server refactors.

---

## 2) feature/contextvm-server-runtime-rename

### Goal

Rename ContextVM server entrypoint and align runtime relay publicity behavior by environment.

### Scope

- Rename `contextvm/currency-server.ts` -> `contextvm/server.ts`.
- Update all references to the new path.
- Ensure public relay announcement happens only in production.

### Planned changes

- Rename file and imports/scripts referencing it:
  - `package.json` (`dev:currency-server`, any server script refs)
  - CI workflow references that start server
  - helper scripts/docs that call old path
- In server runtime:
  - production: public relays + public server mode,
  - staging/dev: scoped relays only, no public announcement.

### Validation

- `bun run dev:currency-server`
- `bun run test:unit`
- `bun run test:integration`

### Out of scope

- Deploy PM2 rollout, ctxcn artifacts, frontend client renames.

---

## 3) feature/ctxcn-client-checkin-and-naming

### Goal

Check in dev-mode ctxcn client artifacts and normalize client naming for frontend usage.

### Scope

- Add/check in `ctxcn.config.json` for dev-oriented generation workflow.
- Check in generated client artifact(s) intended to be versioned.
- Apply naming cleanup:
  - `PlebianCurrenycServerClient.ts` -> `PlebeianServerClient.ts`
  - `PlebianServerClient` -> `PlebeianCurrencyClient` (or final canonical choice)

### Planned changes

- Add/adjust files under `src/lib/ctxcn/`.
- Update imports/usages in frontend query/client layers and relevant tests.
- Keep browser runtime path decisions explicit (if retaining nostr-tools runtime path).

### Validation

- Typecheck/build (`bun run build` if applicable).
- Unit tests touching external/query/client paths.

### Out of scope

- Runtime server path rename, deploy/PM2 changes, broad test script changes.

---

## 4) feature/test-script-generalization

### Goal

Generalize test scripts to run broader suites (not only currency-specific unit subsets).

### Scope

- Update `package.json` test scripts:
  - `test:unit`
  - `test:unit:watch`
- Keep integration script explicit and stable.

### Planned changes

- Replace narrow path targets with intended broader directories.
- Verify CI workflow commands still match script names and expected behavior.

### Validation

- `bun run test:unit`
- `bun run test:integration`

### Out of scope

- E2E flake fixes, ContextVM runtime/deploy changes, ctxcn naming changes.

---

## 5) feature/deploy-contextvm-pm2

### Goal

Deploy ContextVM server as a managed PM2 process alongside the app.

### Scope

- Update deploy script(s) to package and run ContextVM server.
- Ensure env templates/docs include `CVM_SERVER_KEY`.
- Add explicit PM2 process names/log paths/restart behavior.

### Planned changes

- Update deploy orchestration (for example `deploy-simple/deploy.sh`).
- Include server runtime directory/files in deployment bundle.
- Add PM2 app entry for ContextVM server using canonical path (`contextvm/server.ts` once rename lands).
- Ensure stop/reload/save handles both web and ContextVM processes.

### Validation

- Dry-run deploy script checks where possible.
- Staging deployment verification:
  - PM2 process list includes ContextVM server,
  - logs show successful startup,
  - app currency flow works via ContextVM.

### Out of scope

- E2E flake fixes and ctxcn codegen concerns.
