# CVM Key Management

## Overview

Plebeian Market uses ContextVM (CVM) servers for currency conversion, auction validation, and live activity management. This document explains how to configure CVM keys for different deployment scenarios.

## Three Deployment Scenarios

### Scenario 1: Instance Runs a CVM

The instance runs its own CVM server process (`bun run dev:contextvm-server`).

Set the **private key**:

```env
CVM_SERVER_KEY=<64-char-hex-private-key>
```

The pubkey is derived automatically from the private key. The CVM server signs events with this key, and the app trusts events signed by the derived pubkey.

### Scenario 2: Instance Points to a Public CVM

The instance does not run a CVM but connects to one operated by someone else (e.g., the Plebeian team's public CVM).

Set the **pubkey** directly:

```env
CVM_SERVER_PUBLIC_KEY=<64-char-hex-pubkey>
```

Do NOT set `CVM_SERVER_KEY` — the instance doesn't have the private key.

### Scenario 3: Instance Uses Separate CVMs Per Service

The instance connects to different CVMs for different services — e.g., one CVM for currency conversion and another for auction validation.

Set **service-specific pubkeys**:

```env
CVM_CURRENCY_SERVER_PUBLIC_KEY=<currency_cvm_pubkey>
CVM_AUCTIONS_SERVER_PUBLIC_KEY=<auctions_cvm_pubkey>
```

Each service-specific key falls back to `CVM_SERVER_PUBLIC_KEY` if not set.

## Fallback Order

The centralized resolver (`src/lib/cvm-identity.ts`) resolves the CVM pubkey using this priority:

```
1. Service-specific pubkey (CVM_CURRENCY_SERVER_PUBLIC_KEY)  ← most specific
2. General CVM pubkey (CVM_SERVER_PUBLIC_KEY / CVM_SERVER_PUBKEY)
3. Derive from private key (CVM_SERVER_KEY)  ← least specific
4. Throw error  ← no hardcoded fallback
```

This ensures the most specific configuration takes precedence.

### Auction validator

A separate resolver, `resolveCvmAuctionsServerPubkey()` (also in `src/lib/cvm-identity.ts`), covers the case where the auction validator runs on a different key than the currency CVM (part of the `auctions/p2pk-buyer-path-custody-v1` architecture):

```
1. CVM_AUCTIONS_SERVER_PUBLIC_KEY                              ← auction-specific
2. resolveCvmServerPubkey() (currency → public → private)      ← general fallback
```

When `CVM_AUCTIONS_SERVER_PUBLIC_KEY` is not set, the auction validator transparently uses the same identity as the rest of the app.

## Environment Variable Reference

| Variable                         | Type              | Scenario | Description                                       |
| -------------------------------- | ----------------- | -------- | ------------------------------------------------- |
| `CVM_SERVER_KEY`                 | Private key (hex) | 1        | CVM server's signing key                          |
| `CVM_SERVER_PUBLIC_KEY`          | Pubkey (hex)      | 2        | CVM server's public key (preferred name)          |
| `CVM_SERVER_PUBKEY`              | Pubkey (hex)      | 2        | Deprecated alias for `CVM_SERVER_PUBLIC_KEY`      |
| `CVM_CURRENCY_SERVER_PUBLIC_KEY` | Pubkey (hex)      | 3        | Currency CVM's pubkey                             |
| `CVM_AUCTIONS_SERVER_PUBLIC_KEY` | Pubkey (hex)      | 3        | Auction validator CVM's pubkey                    |
| `CURRENCY_SERVER_PUBKEY`         | Pubkey (hex)      | 3        | Legacy alias for `CVM_CURRENCY_SERVER_PUBLIC_KEY` |

## Pre-Commit Hook

The repository includes a pre-commit hook (`scripts/git-hooks/pre-commit`) that detects hardcoded Nostr keys:

- **Tier 1 (hard fail)**: `nsec1...` strings, `process.env.X || 'hex64'` patterns, key-named variables
- **Tier 2 (warning)**: Any other 64-char hex string literal
- **Tier 3 (skip)**: Comments, hashes, commit SHAs, event IDs

Auto-installed via `bun install` (via the `prepare` script in `package.json`).

## Test Instance Keys

Test instances (E2E tests, PR deployments) use randomly generated key pairs per run. The `src/lib/test-keys.ts` utility provides `generateTestKeyPair(name)` which caches keys within a process for stability.

No hardcoded test keys exist in the codebase. The `e2e/purge-leaked-events.ts` script retains OLD compromised keys solely for cleaning up previously leaked events from public relays.

## Key Rotation

When CVM keys need to be rotated (e.g., after a compromise):

1. Generate new key pair: `nak key generate`
2. Update deployment env vars with the new key
3. Restart the CVM server process
4. Run `e2e/purge-leaked-events.ts` to clean up old events from public relays
5. Verify clients connect to the new CVM pubkey
