# ContextVM Minimal PR Checklist

This checklist identifies the bare minimum changes needed from `master..get-currency-context-vm` to achieve the original branch goal without feature creep.

## Original goal

Implement a BTC pricing fallback architecture based on a dedicated ContextVM currency server, with:

- multi-source BTC price aggregation,
- server-side cache,
- frontend ContextVM-first pricing fetch,
- fallback to Yadio when ContextVM is unavailable,
- enough automated coverage to validate the feature.

---

## Keep in the minimal PR

### Core feature implementation

- [x] `contextvm/currency-server.ts`
- [x] `contextvm/schemas.ts`
- [x] `contextvm/tools/price-sources.ts`
- [x] `contextvm/tools/rates-cache.ts`
- [x] `src/lib/contextvm-client.ts`
- [x] `src/lib/constants.ts`
- [x] `src/queries/external.tsx`
- [x] `package.json`
- [x] `bun.lock`
- [x] `.env.example`
- [x] `scripts/fetch-btc-price.ts`

### Keep only the relevant `.gitignore` change

- [x] `contextvm/data/`
- [ ] Do **not** include unrelated local OpenCode artifact ignores

### Core automated tests

- [x] `contextvm/__tests__/currency-server.test.ts`
- [x] `contextvm/tools/__tests__/price-sources.test.ts`
- [x] `contextvm/tools/__tests__/rates-cache.test.ts`
- [x] `contextvm/tools/__tests__/schemas.test.ts`
- [x] `src/lib/__tests__/contextvm-client.test.ts`
- [x] `src/lib/__tests__/contextvm-client.integration.test.ts`
- [x] `src/queries/__tests__/external.test.ts`

### Optional: keep a single app-facing E2E smoke test

- [ ] `e2e-new/tests/btc-price.spec.ts` — keep only if you want one narrow UI confidence check

---

## Drop from the minimal PR

These changes are useful as follow-up work or separate branches, but are not required to achieve the original pricing fallback goal.

### Branch-management / planning artifacts

- [ ] `branch-plans.md`

### Extra CI/workflow changes

- [ ] `.github/workflows/ci-unit.yml`

### Extra E2E additions beyond the minimal app-facing check

- [ ] `e2e-new/playwright-contextvm.config.ts`
- [ ] `e2e-new/tests/contextvm-org.spec.ts`
- [ ] `e2e-new/tests/currency-contextvm.spec.ts`

### Nice-to-have but nonessential test additions

- [ ] `src/queries/__tests__/ephemeral-signer.test.ts`

### Unrelated local ignore noise

- [ ] `.gitignore` entries for:
  - [ ] `/.opencode/`
  - [ ] `/Makefile`
  - [ ] `/scripts/docs_summary.py`
  - [ ] `/scripts/gitignore_audit.py`
  - [ ] `/scripts/verify_subagents.py`
  - [ ] `/tatus`

---

## Do not pull into this PR

These belong to separate follow-up branches and should stay out of the minimal pricing fallback PR:

- [ ] server runtime rename work (`currency-server.ts -> server.ts`)
- [ ] `ctxcn` client generation / naming cleanup
- [ ] generalized test script refactor beyond what is strictly needed
- [ ] PM2 / deployment rollout changes
- [ ] payment-flow E2E stabilization changes
- [ ] app-side loading/UI tweaks unless directly required by the pricing fallback feature

---

## Minimal validation plan

Run these before integrating the minimal PR branch:

### Unit / targeted tests

- [ ] `bun test contextvm/tools/__tests__/price-sources.test.ts`
- [ ] `bun test contextvm/tools/__tests__/rates-cache.test.ts`
- [ ] `bun test contextvm/__tests__/currency-server.test.ts`
- [ ] `bun test src/queries/__tests__/external.test.ts`
- [ ] `bun test src/lib/__tests__/contextvm-client.test.ts`
- [ ] `bun test src/lib/__tests__/contextvm-client.integration.test.ts`

### Broader suite

- [ ] `bun run test:unit` (only if the script remains aligned with the minimal kept tests)
- [ ] `bun run test:integration`

### Optional E2E

- [ ] Run `e2e-new/tests/btc-price.spec.ts` if retained

### Manual verification

- [ ] Start local relay
- [ ] Start the app
- [ ] Start `contextvm/currency-server.ts`
- [ ] Verify `scripts/fetch-btc-price.ts` returns uncached then cached results
- [ ] Verify product list/detail show sats + fiat pricing
- [ ] Verify currency switch updates displayed fiat denomination
- [ ] Verify fallback to Yadio when the currency server is stopped

---

## Recommendation

Build the integration candidate around the **Keep in the minimal PR** section only.

If additional work is needed to satisfy reviewer feedback, land it in follow-up branches rather than expanding the pricing fallback PR itself. This keeps CI signal clear and avoids mixing the original feature with unrelated E2E, deploy, naming, or workflow changes.
