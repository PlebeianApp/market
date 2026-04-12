# Browser ContextVM debugging + recovery plan

This note captures the current state of the `browser-contextvm` manual validation path, the known failure modes, and the exact next steps for a future agent after a reboot or session handoff.

## Objective

Get `make browser-contextvm` to complete end-to-end without manual intervention so the browser happy path can be used as the source of truth for ContextVM / CTXCN validation.

## High-level status

### Working
- Relay startup and readiness checks.
- Relay seeding via `e2e-new/seed-relay.ts`.
- ContextVM BTC price fetch path.
- Cache behavior: first fetch uncached, second fetch cached.
- Yadio fallback at the fetch layer when the currency server is unavailable.
- `src/index.tsx` now honors `PORT` instead of hardcoding 3000.
- `Makefile` now prints port listeners for 3000 / 10547 / 34567 at the start of `browser-contextvm`.

### Still failing / uncertain
- The manual browser path still needs confirmation end-to-end after the latest cleanup changes.
- Earlier runs showed `EADDRINUSE` on port 3000 when starting the app.
- Standalone `bun run startup` and `bun run seed` fail if the relay is not already up, which is expected.
- A prior failure was caused by NDK guardrails rejecting old replaceable timestamps from `scripts/gen_nip15_products.ts`.

## What we learned

### 1) There is no obvious persistent service holding port 3000
Commands checked during debugging:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
ss -ltnp 'sport = :3000'
systemctl --user list-units --type=service --all | rg 'market|bun|node|nak'
systemctl list-units --type=service --all | rg 'market|bun|node|nak'
pm2 ls
```

Observed result:
- No persistent daemon or service was visibly listening on 3000 during the checks.
- This suggests the port conflict was likely from a transient process, stale recipe behavior, or an older run.

### 2) The app entrypoint was previously hardcoded to 3000
`src/index.tsx` used:

```ts
const PORT = Number(process.env.PORT || 3000)
```

and now explicitly passes that into `serve({ port: PORT, ... })`.

This means the app can run on a different port if `PORT` is supplied.

### 3) The browser target now picks a free port instead of assuming 3000
`Makefile` `browser-contextvm` now:
- prints current listeners for ports 3000 / 10547 / 34567
- kills stale known processes
- kills bindings on ports 10547 / 3000 / 34567
- starts the relay on `10547`
- seeds the relay
- starts the ContextVM server
- picks a free browser port in the `34567..34667` range
- starts the app on that chosen port
- checks `/api/config` and `/products` on the chosen port

### 4) The seed script had a replaceable-event timestamp issue
`scripts/gen_nip15_products.ts` was publishing kind `30018` events with old timestamps and then calling `publish()`, which tripped NDK guardrails.

The fix applied was:
- switch to `await event.publishReplaceable()` for NIP-15 products

This should be preserved; do not revert it.

### 5) Standalone startup/seed failures are expected without the relay
Running these directly without a relay produces failures like:
- `NDK connection timeout`
- `Not enough relays received the event (0 published, 1 required)`

That is not the root problem; it just means the relay was not running.

## Current relevant files

- `Makefile`
- `src/index.tsx`
- `scripts/startup.ts`
- `scripts/seed.ts`
- `scripts/gen_nip15_products.ts`
- `docs/contextvm-happy-path-runbook.md`

## Current `browser-contextvm` behavior

The target currently does approximately this:

1. Show current listeners on ports 3000 / 10547 / 34567.
2. Kill stale known processes.
3. Repeatedly kill any listeners on 10547 / 3000 / 34567 until the ports are free.
4. Start `nak serve --port 10547 --hostname 0.0.0.0`.
5. Wait for the relay to answer HTTP requests.
6. Run `e2e-new/seed-relay.ts` against the relay.
7. Start `bun run dev:contextvm-server`.
8. Poll `scripts/fetch-btc-price.ts` until the currency server responds.
9. Pick a free browser port from `34567..34667`.
10. Run `bun run startup && bun run seed && PORT=$BROWSER_CONTEXTVM_PORT bun --hot src/index.tsx --host 0.0.0.0`.
11. Wait for `/api/config` to report `needsSetup: false`.
12. Wait for `/products` to stop showing `No products found`.

## Important logs to inspect

If the target fails, inspect these files:

- `/tmp/contextvm-browser-relay.log`
- `/tmp/contextvm-browser-relay-seed.log`
- `/tmp/contextvm-browser-currency-server.log`
- `/tmp/contextvm-browser-app.log`
- `/tmp/contextvm-browser-price-check.log`
- `/tmp/browser-contextvm-run.log` if the target was wrapped with `nohup`

## Fast debugging commands

Run these immediately after a failed `make browser-contextvm` attempt:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:10547 -sTCP:LISTEN
lsof -nP -iTCP:34567 -sTCP:LISTEN
ps -ef | rg 'bun .*src/index.tsx|bun run dev|bun run startup|bun run seed|dev:contextvm-server|nak serve'
```

If `lsof` shows a listener, capture the PID and command line before killing anything.

## Probable failure modes

### A) A stale app process still owns port 3000
Symptoms:
- `EADDRINUSE` on startup
- `lsof` shows a process bound to 3000

Action:
- identify the PID with `lsof -nP -iTCP:3000 -sTCP:LISTEN`
- inspect the command line with `ps -fp <pid>`
- kill the offending process
- rerun `make browser-contextvm`

### B) The app starts on a different port than expected
Symptoms:
- the app log does not show the expected port
- the readiness checks fetch the wrong port

Action:
- confirm `PORT=$BROWSER_CONTEXTVM_PORT` is actually reaching the Bun process
- confirm `src/index.tsx` is reading `process.env.PORT`
- print the chosen `browser_port` in the Makefile if needed

### C) The seed script fails on NDK guardrails
Symptoms:
- `Publishing a replaceable event with an old created_at timestamp`
- failure in `scripts/gen_nip15_products.ts`

Action:
- keep `publishReplaceable()` for NIP-15 product events
- do not revert that change

### D) The relay is not actually reachable yet
Symptoms:
- `NDK connection timeout`
- `Not enough relays received the event (0 published, 1 required)`

Action:
- verify `nak serve` is running on 10547
- inspect `/tmp/contextvm-browser-relay.log`
- ensure the relay readiness check passed before startup/seed runs

## Recommended next steps for the next agent

1. Reboot if needed to clear any hidden stale listeners.
2. After reboot, immediately run:
   ```bash
   lsof -nP -iTCP:3000 -sTCP:LISTEN
   lsof -nP -iTCP:10547 -sTCP:LISTEN
   lsof -nP -iTCP:34567 -sTCP:LISTEN
   ```
3. Run `make browser-contextvm` exactly once and keep the logs.
4. If it fails, inspect the four `/tmp/contextvm-browser-*.log` files.
5. If the failure is port-related, use `lsof`/`ps` to identify the process owning the port.
6. If the failure is seed-related, confirm `scripts/gen_nip15_products.ts` still uses `publishReplaceable()`.
7. If the browser path completes, update the runbook with the successful evidence and close the loop.

## Do not regress

- Keep the browser happy path as the source of truth.
- Keep generated client usage aligned with `ctxcn`.
- Keep `CVM_SERVER_KEY` / runtime pubkey derivation config-driven.
- Do not reintroduce a hardcoded port 3000 assumption in the app startup path.
- Do not revert the NIP-15 `publishReplaceable()` fix.

## Short version

- No persistent service was found listening on 3000.
- The app now supports `PORT`, and the browser recipe chooses a free port.
- The remaining issue is finishing the end-to-end browser run cleanly and proving it after reboot.
