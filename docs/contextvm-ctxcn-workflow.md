# CTXCN client workflow

This repository checks in the generated ContextVM client so we do not need to regenerate it manually on every change.

## Source of truth

- `ctxcn.config.json` is checked in and acts as the local configuration for client generation.
- `src/lib/ctxcn-client.ts` is the checked-in generated client that the app uses at runtime.

## How the frontend uses it

The frontend imports the generated client directly from `@/lib/ctxcn-client`.

## Updating the client

When adding or refreshing ContextVM tools:

1. Update `ctxcn.config.json` if the relay/source settings change.
2. Regenerate the client with the `ctxcn` CLI.
3. Commit the updated generated client in `src/lib/ctxcn-client.ts`.
4. Update any tests or docs that depend on the client shape.

## Notes

- The old compatibility wrapper has been removed.
- The generated client name is `PlebianCurrencyClient`.
- The shared server key is derived from `CVM_SERVER_KEY`.
