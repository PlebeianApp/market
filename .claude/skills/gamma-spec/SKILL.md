---
name: gamma-spec
description: This skill should be used when implementing, debugging, or discussing the Gamma Markets e-commerce specification - an extension of NIP-99 for decentralized Nostr marketplaces. Provides comprehensive knowledge of event kinds (30402 products, 30405 collections, 30406 shipping), order communication flow via NIP-17 encrypted DMs, payment processing modes, and merchant preference handling. (project)
---

# Gamma Markets E-Commerce Specification

The Gamma Markets specification extends NIP-99 to support full e-commerce use cases on Nostr. It was developed collaboratively by Nostr marketplace developers (Shopstr, Cypher, Plebeian, Conduit).

**Source**: https://github.com/GammaMarkets/market-spec

## Core Concepts

### Event Kinds

| Kind  | Purpose                              |
| ----- | ------------------------------------ |
| 30402 | Product listings                     |
| 30405 | Product collections                  |
| 30406 | Shipping options                     |
| 31555 | Product reviews                      |
| 14    | General order communication (NIP-17) |
| 16    | Order processing and status (NIP-17) |
| 17    | Payment receipts (NIP-17)            |

### Key Design Principles

1. **No cascading inheritance**: Products explicitly reference collection attributes - no automatic inheritance
2. **Encrypted communication**: All sensitive order data uses NIP-17 encrypted DMs
3. **Merchant preferences**: Merchants recommend preferred apps via NIP-89 and set payment preferences in kind `0`
4. **Multiple payment methods**: Lightning, eCash, Bitcoin, and fiat gateways supported

## Standard E-Commerce Flow

1. Product discovery
2. Cart addition
3. Merchant preference verification
4. Shipping calculation
5. Payment processing
6. Order confirmation
7. Encrypted message follow-up

## Order Communication (Kind 16 Types)

| Type | Purpose          | Direction                                  |
| ---- | ---------------- | ------------------------------------------ |
| 1    | Order creation   | Buyer → Merchant                           |
| 2    | Payment request  | Either direction (depends on payment mode) |
| 3    | Status updates   | Either direction                           |
| 4    | Shipping updates | Merchant → Buyer                           |

## Reference Files

To access detailed specifications:

- **Event kinds and tag structures**: Read `references/event-kinds.md`
  - Product listing (30402) with all required/optional tags
  - Collection (30405) structure
  - Shipping options (30406) with constraints
  - Product reviews (31555) with rating calculation

- **Order flow and message types**: Read `references/order-flow.md`
  - Kind 14, 16, 17 message structures
  - All type values for Kind 16
  - Payment receipt formats

- **Merchant preferences and payment modes**: Read `references/merchant-preferences.md`
  - NIP-89 application preferences
  - Payment preference values (manual, ecash, lud16)
  - Payment processing decision tree

## Quick Reference: Common Tags

### Product (30402) Required Tags

```
["d", "<product-id>"]
["title", "<name>"]
["price", "<amount>", "<currency>"]
```

### Order Creation (Kind 16, Type 1) Required Tags

```
["p", "<merchant-pubkey>"]
["type", "1"]
["order", "<order-id>"]
["amount", "<sats>"]
["item", "30402:<pubkey>:<d-tag>", "<quantity>"]
```

### Payment Receipt (Kind 17) Required Tags

```
["p", "<merchant-pubkey>"]
["order", "<order-id>"]
["payment", "<method>", "<reference>", "<proof>"]
["amount", "<amount>"]
```

## Implementation Notes

1. All timestamps use Unix format (seconds since epoch)
2. Order IDs should be consistent across all related messages
3. Message threading follows NIP-10 conventions for replies
4. Watch-only clients need only support product rendering; full e-commerce requires NIP-17
