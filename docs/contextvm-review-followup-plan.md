# ContextVM review follow-up plan

We will tackle the remaining review feedback in small, separately committed steps.

## Checklist

- [x] 1. Fix the environment variable naming mismatch
  - [x] Update `.env.example` to use `CVM_SERVER_KEY`
  - [x] Update `contextvm/server.ts` to read `CVM_SERVER_KEY`
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

- [ ] 4. Align ContextVM naming and server/client terminology
  - [x] Rename the server entrypoint to `server.ts`
  - [x] Standardize the generated client naming (`PlebianCurrenycServerClient` → `PlebianServerClient` → `PlebianCurrencyClient` as applicable)
  - [x] Replace any typoed or transitional names in docs, code, and tests
  - [x] Treat `CVM_SERVER_KEY` as the shared server key for multiple ContextVM tools, not just currency pricing

- [x] 5. Finalize the ctxcn generation/check-in workflow
  - [x] Keep `ctxcn.config.json` checked in as the source for client generation
  - [x] Ensure the generated client stays checked in so we do not need to regenerate it manually every time
  - [x] Confirm frontend code imports the checked-in generated client directly
  - [x] Document the dev/update flow for adding future ContextVM tools

- [x] 6. Wire runtime and deployment behavior
  - [x] Only announce the currency server to public relays in production
  - [x] Add the ContextVM server startup to `deploy.sh` / pm2 as requested
  - [x] Verify deployment/runtime env config matches the new naming and key handling

## Working agreement

After each checklist item:

1. Commit the change.
2. Stop and ask for a push.
3. Continue to the next item only after the push is confirmed.
