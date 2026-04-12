# ContextVM minimal apply list

This branch starts from known-green commit:

- `8ef025e0f3d03a95ebb237b62fc36d51cac7d063`

The goal is to reconstruct the **smallest useful subset** of `get-currency-context-vm` needed for the BTC pricing fallback architecture, without pulling in unrelated E2E, deploy, workflow, or refactor work.

## Source branch used for file selection

- `get-currency-context-vm`

## Apply as-is

### Core ContextVM server

- `contextvm/server.ts`
- `contextvm/schemas.ts`
- `contextvm/tools/price-sources.ts`
- `contextvm/tools/rates-cache.ts`

### Core tests for server/cache/schemas

- `contextvm/__tests__/currency-server.test.ts`
- `contextvm/tools/__tests__/price-sources.test.ts`
- `contextvm/tools/__tests__/rates-cache.test.ts`
- `contextvm/tools/__tests__/schemas.test.ts`

### Frontend/client integration

- `src/lib/ctxcn-client.ts`
- `src/lib/constants.ts`
- `src/lib/__tests__/contextvm-client.test.ts`
- `src/lib/__tests__/contextvm-client.integration.test.ts`
- `src/queries/external.tsx`
- `src/queries/__tests__/external.test.ts`

### Support files

- `scripts/fetch-btc-price.ts`
- `package.json`
- `bun.lock`

## Apply surgically

### `.env.example`

Add only the currency server env var line from `get-currency-context-vm`.

### `.gitignore`

Add only:

- `contextvm/data/`

## Do not apply in this reconstruction

### Optional / extra E2E

- `e2e-new/playwright-contextvm.config.ts`
- `e2e-new/tests/btc-price.spec.ts`
- `e2e-new/tests/contextvm-org.spec.ts`
- `e2e-new/tests/currency-contextvm.spec.ts`

### Nice-to-have but nonessential tests

- `src/queries/__tests__/ephemeral-signer.test.ts`

### Workflow / planning / branch management

- `.github/workflows/ci-unit.yml`
- `branch-plans.md`

### Anything outside the pricing fallback scope

- deploy changes
- PM2/systemd changes
- generalized E2E stabilization changes
- payment-flow fixes
- ctxcn follow-up work
- runtime rename follow-up work

## Validation after applying

Run at least:

```bash
bun test contextvm/tools/__tests__/price-sources.test.ts
bun test contextvm/tools/__tests__/rates-cache.test.ts
bun test contextvm/__tests__/currency-server.test.ts
bun test src/queries/__tests__/external.test.ts
bun test src/lib/__tests__/contextvm-client.test.ts
```

Then run integration once a local relay + local currency server are available:

```bash
bun run test:integration
```
