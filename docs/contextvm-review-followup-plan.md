# ContextVM review follow-up plan

We will tackle the remaining review feedback in small, separately committed steps.

## Checklist

- [x] 1. Fix the environment variable naming mismatch
  - [x] Update `.env.example` to use `CVM_SERVER_KEY`
  - [x] Update `contextvm/currency-server.ts` to read `CVM_SERVER_KEY`
  - [x] Add `.env.local.example` for the happy path
  - [x] Create a local `.env.local` with generated keys
  - [x] Verify the local/dev default still works

- [x] 2. Replace the hand-written ContextVM client with the checked-in generated client
  - [x] Generate the `ctxcn` client in the expected checked-in location
  - [x] Swap frontend code to use the generated client
  - [x] Remove any obsolete hand-written client code if it is no longer needed
  - [x] Run unit/integration validation
  - [x] Investigate integration-test timeout in Bun harness (browser path works)

- [x] 3. Generalize the narrow package.json test scripts
  - [x] Broaden `test:unit` so it is not limited to only the current feature files
  - [x] Broaden `test:integration` similarly, or move selection out of `package.json`
  - [x] Keep test selection in workflow/Makefile/CLI usage instead of hardcoding single files

## Working agreement

After each checklist item:

1. Commit the change.
2. Stop and ask for a push.
3. Continue to the next item only after the push is confirmed.
