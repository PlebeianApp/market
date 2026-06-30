# Plebeian Market - API & Nostr Events Documentation

## Table of Contents

1. [Overview](#overview)
2. [Event Kinds Reference](#event-kinds-reference)
3. [App Configuration Events](#app-configuration-events)
4. [User Profile Events](#user-profile-events)
5. [Product Events](#product-events)
6. [Order Events](#order-events)
7. [Payment Events](#payment-events)
8. [Shipping Events](#shipping-events)
9. [Messaging Events](#messaging-events)
10. [Collection Events](#collection-events)
11. [Admin Events](#admin-events)
12. [Encryption Standards](#encryption-standards)

---

## Overview

Plebeian Market is built entirely on the Nostr protocol. All data is stored as Nostr events on relays, eliminating the need for traditional databases. This document describes all event kinds, their structure, and usage patterns.

### Nostr Basics

Each Nostr event has:

```json
{
  "id": "<32-byte hex event id>",
  "pubkey": "<32-byte hex public key>",
  "created_at": "<unix timestamp>",
  "kind": "<event kind number>",
  "tags": [["tag", "value"], ...],
  "content": "<event content>",
  "sig": "<64-byte hex signature>"
}
```

### Key Concepts

- **Replaceable Events**: Events with kind `10000-19999` and `30000-39999` are replaceable by newer events from the same author with the same kind and `d` tag
- **Parameterized Replaceable**: Events with kind `30000-39999` use a `d` tag as unique identifier
- **Encrypted Content**: NIP-04 or NIP-44 encryption for sensitive data
- **Coordinate**: Reference to replaceable events: `<kind>:<pubkey>:<d-tag>`

---

## Event Kinds Reference

| Kind      | NIP    | Type          | Purpose                           | Signed By |
| --------- | ------ | ------------- | --------------------------------- | --------- |
| **0**     | NIP-01 | Replaceable   | User metadata/profile             | User      |
| **14**    | -      | Regular       | Order general communication       | User/App  |
| **16**    | -      | Regular       | Order processing & status updates | App       |
| **17**    | -      | Regular       | Payment receipts                  | App       |
| **10000** | NIP-51 | Replaceable   | Mute/ban list                     | App       |
| **10002** | NIP-65 | Replaceable   | Relay list                        | User/App  |
| **30000** | NIP-51 | Parameterized | User roles (admins/editors/plebs) | App       |
| **30003** | NIP-51 | Parameterized | Featured collections list         | User/App  |
| **30078** | NIP-78 | Parameterized | App-specific data (encrypted)     | User/App  |
| **30402** | -      | Parameterized | Product listings                  | User      |
| **30405** | -      | Parameterized | Product collections               | User      |
| **30406** | -      | Parameterized | Shipping options                  | User      |
| **31990** | NIP-89 | Parameterized | App handler                       | App       |

---

## App Configuration Events

### Kind 31990: App Handler (NIP-89)

**Purpose**: Public app configuration and handler information

**Signed By**: App's private key

**Structure**:

```json
{
	"kind": 31990,
	"pubkey": "<app's pubkey>",
	"content": "{\"name\":\"Plebeian Market\",\"displayName\":\"Plebeian Market\",\"picture\":\"https://...\",\"banner\":\"https://...\",\"ownerPk\":\"<owner hex pubkey>\",\"allowRegister\":true,\"defaultCurrency\":\"SATS\",\"blossom_server\":\"https://...\",\"nip96_server\":\"https://...\"}",
	"tags": [
		["d", "<random-uuid>"],
		["k", "30402"],
		["k", "30405"],
		["k", "30406"],
		["web", "https://market.example.com/a/<bech32>", "nevent"],
		["web", "https://market.example.com/p/<bech32>", "nprofile"],
		["r", "wss://relay.example.com"]
	]
}
```

**Content Fields**:

| Field             | Type    | Required | Description                 |
| ----------------- | ------- | -------- | --------------------------- |
| `name`            | string  | Yes      | App name                    |
| `displayName`     | string  | Yes      | Display name                |
| `picture`         | string  | No       | App logo URL                |
| `banner`          | string  | No       | App banner URL              |
| `ownerPk`         | string  | Yes      | Owner's hex pubkey          |
| `allowRegister`   | boolean | Yes      | Allow new user registration |
| `defaultCurrency` | string  | Yes      | Default currency (ISO code) |
| `blossom_server`  | string  | No       | Blossom image server URL    |
| `nip96_server`    | string  | No       | NIP-96 media server URL     |

**Tags**:

- `d`: Unique identifier (UUID)
- `k`: Supported event kinds
- `web`: URL handlers for Nostr entities
- `r`: App's relay URL

### Kind 30078: Extended App Settings (NIP-78)

**Purpose**: Extended or encrypted app configuration

**Signed By**: App's private key

**Structure**:

```json
{
	"kind": 30078,
	"pubkey": "<app's pubkey>",
	"content": "{\"extended_field\":\"value\",\"field_to_encrypt\":\"value\"}",
	"tags": [["d", "<same-uuid-as-31990>"]]
}
```

**Note**: Must use the same `d` tag as the corresponding kind 31990 event.

---

## User Profile Events

### Kind 0: User Metadata (NIP-01)

**Purpose**: User profile information

**Signed By**: User

**Structure**:

```json
{
	"kind": 0,
	"pubkey": "<user's pubkey>",
	"content": "{\"name\":\"username\",\"display_name\":\"Display Name\",\"about\":\"Bio\",\"picture\":\"https://...\",\"banner\":\"https://...\",\"nip05\":\"user@domain.com\",\"lud16\":\"user@lightning.address\"}",
	"tags": []
}
```

**Content Fields**:

| Field          | Type   | Description                              |
| -------------- | ------ | ---------------------------------------- |
| `name`         | string | Username (unique identifier)             |
| `display_name` | string | Display name                             |
| `about`        | string | User bio/description                     |
| `picture`      | string | Profile picture URL                      |
| `banner`       | string | Banner image URL                         |
| `nip05`        | string | NIP-05 identifier (user@domain.com)      |
| `lud16`        | string | Lightning address for receiving payments |

### Kind 10002: Relay List (NIP-65)

**Purpose**: User's preferred relays for read/write

**Signed By**: User or App

**Structure**:

```json
{
	"kind": 10002,
	"pubkey": "<user's pubkey>",
	"content": "",
	"tags": [
		["r", "wss://relay1.example.com"],
		["r", "wss://relay2.example.com", "write"],
		["r", "wss://relay3.example.com", "read"]
	]
}
```

---

## Product Events

### Kind 30402: Product Listing

**Purpose**: Product information for sale

**Signed By**: Seller (user)

**Structure**:

```json
{
	"kind": 30402,
	"pubkey": "<seller's pubkey>",
	"content": "{\"name\":\"Product Name\",\"description\":\"Product description\",\"images\":[\"https://image1.jpg\",\"https://image2.jpg\"],\"price\":10000,\"currency\":\"SATS\",\"quantity\":100,\"specs\":[[\"Color\",\"Blue\"],[\"Size\",\"M\"]]}",
	"tags": [
		["d", "<product-uuid>"],
		["t", "electronics"],
		["t", "gadgets"],
		["l", "on-sale"],
		["shipping", "<30406:pubkey:shipping-option-id>"]
	]
}
```

**Content Fields**:

| Field         | Type       | Required | Description                                      |
| ------------- | ---------- | -------- | ------------------------------------------------ |
| `name`        | string     | Yes      | Product name                                     |
| `description` | string     | Yes      | Product description                              |
| `images`      | string[]   | No       | Array of image URLs                              |
| `price`       | number     | Yes      | Price in specified currency                      |
| `currency`    | string     | Yes      | Currency code (SATS, BTC, USD, etc.)             |
| `quantity`    | number     | No       | Available quantity (-1 for unlimited)            |
| `specs`       | string[][] | No       | Product specifications `[["key", "value"], ...]` |

**Tags**:

- `d`: Unique product identifier (UUID)
- `t`: Product tags/categories (multiple allowed)
- `l`: Product status label (`on-sale`, `hidden`, `sold-out`, `pre-order`)
- `shipping`: Shipping option coordinates (multiple allowed)

**Product Statuses** (`l` tag):

- `on-sale`: Available for purchase
- `hidden`: Not visible to buyers
- `sold-out`: Out of stock
- `pre-order`: Available for pre-order

---

## Order Events

### Kind 14: Order General Communication

**Purpose**: General messages related to an order

**Signed By**: User or App

**Structure**:

```json
{
	"kind": 14,
	"pubkey": "<sender's pubkey>",
	"content": "<message text or encrypted content>",
	"tags": [
		["e", "<order-event-id>"],
		["p", "<recipient-pubkey>"]
	]
}
```

### Kind 16: Order Processing & Status Updates

**Purpose**: Order status changes and processing updates

**Signed By**: App

**Structure**:

```json
{
	"kind": 16,
	"pubkey": "<app's pubkey>",
	"content": "{\"orderId\":\"<order-id>\",\"status\":\"pending\",\"timestamp\":<unix-timestamp>}",
	"tags": [
		["e", "<original-order-event-id>"],
		["p", "<buyer-pubkey>"],
		["p", "<seller-pubkey>"],
		["status", "pending"]
	]
}
```

**Order Statuses**:

- `pending`: Order received, awaiting payment
- `paid`: Payment confirmed
- `processing`: Being prepared for shipment
- `shipped`: Shipped to customer
- `delivered`: Delivered to customer
- `cancelled`: Order cancelled
- `refunded`: Order refunded

### Kind 17: Payment Receipt

**Purpose**: Payment confirmation and receipt

**Signed By**: App

**Structure**:

```json
{
	"kind": 17,
	"pubkey": "<app's pubkey>",
	"content": "{\"orderId\":\"<order-id>\",\"amount\":<amount>,\"currency\":\"SATS\",\"paymentMethod\":\"lightning\",\"timestamp\":<unix-timestamp>}",
	"tags": [
		["e", "<order-event-id>"],
		["p", "<buyer-pubkey>"],
		["amount", "<amount>", "<currency>"],
		["bolt11", "<lightning-invoice>"]
	]
}
```

---

## Payment Events

### Kind 30078: Payment Details (User → App)

**Purpose**: Store user's payment receiving methods (encrypted)

**Signed By**: User

**Label**: `payment_detail`

**Structure**:

```json
{
	"kind": 30078,
	"pubkey": "<user's pubkey>",
	"content": "<encrypted: {\"payment_method\":\"ln\",\"payment_detail\":\"user@lightning.address\"}>",
	"tags": [
		["d", "<random-uuid>"],
		["l", "payment_detail"],
		["p", "<app's pubkey>"],
		["a", "<30402:seller-pubkey:product-id>"]
	]
}
```

**Encrypted Content Fields**:

| Field            | Type   | Description                                           |
| ---------------- | ------ | ----------------------------------------------------- |
| `payment_method` | string | Payment method: `ln` (Lightning), `on-chain`, `cashu` |
| `payment_detail` | string | Lightning address, xpub, or BTC address               |

**Tags**:

- `d`: Unique identifier
- `l`: Label `payment_detail`
- `p`: App's pubkey (encryption target)
- `a`: (Optional) Product/collection coordinates for scoped payment

**Scope Levels**:

1. **Global**: No `a` tag - applies to all products
2. **Product-specific**: One `a` tag - applies to specific product
3. **Multi-product**: Multiple `a` tags - applies to multiple products

### Kind 30078: Wallet Details (App → User)

**Purpose**: Track wallet state (e.g., on-chain address index)

**Signed By**: App

**Label**: `wallet_detail`

**Structure**:

```json
{
	"kind": 30078,
	"pubkey": "<app's pubkey>",
	"content": "<encrypted to user: {\"key\":\"on-chain-index\",\"value\":\"1\"}>",
	"tags": [
		["d", "<random-uuid>"],
		["l", "wallet_detail"],
		["a", "<30078:user-pubkey:payment-detail-id>"]
	]
}
```

### Kind 30078: NWC String

**Purpose**: Store Nostr Wallet Connect connection string

**Signed By**: User

**Label**: `nwc_string`

**Structure**:

```json
{
	"kind": 30078,
	"pubkey": "<user's pubkey>",
	"content": "<encrypted: nostr+walletconnect://...>",
	"tags": [
		["d", "<random-uuid>"],
		["l", "nwc_string"],
		["p", "<app's pubkey>"]
	]
}
```

### Kind 30078: V4V Shares

**Purpose**: Value-for-value payment splits

**Signed By**: User

**Label**: `v4v_share`

**Structure**:

```json
{
	"kind": 30078,
	"pubkey": "<user's pubkey>",
	"content": "[[\"zap\",\"<pubkey1>\",\"50\"],[\"zap\",\"<pubkey2>\",\"30\"],[\"zap\",\"<pubkey3>\",\"20\"]]",
	"tags": [
		["d", "<random-uuid>"],
		["l", "v4v_share"],
		["p", "<app's pubkey>"]
	]
}
```

**Content Format**: Array of `["zap", "<pubkey>", "<weight>"]`

**Example**: Split 50% to pubkey1, 30% to pubkey2, 20% to pubkey3

---

## Shipping Events

### Kind 30406: Shipping Option

**Purpose**: Define shipping methods and costs

**Signed By**: Seller

**Structure**:

```json
{
	"kind": 30406,
	"pubkey": "<seller's pubkey>",
	"content": "{\"name\":\"Standard Shipping\",\"cost\":500,\"currency\":\"SATS\",\"regions\":[\"US\",\"CA\",\"MX\"],\"estimatedDays\":\"5-7\"}",
	"tags": [
		["d", "<shipping-option-uuid>"],
		["t", "standard"],
		["region", "US"],
		["region", "CA"]
	]
}
```

**Content Fields**:

| Field           | Type     | Description                                  |
| --------------- | -------- | -------------------------------------------- |
| `name`          | string   | Shipping method name                         |
| `cost`          | number   | Shipping cost                                |
| `currency`      | string   | Currency code                                |
| `regions`       | string[] | Supported country codes (ISO 3166-1 alpha-2) |
| `estimatedDays` | string   | Estimated delivery time                      |

---

## Collection Events

### Kind 30405: Product Collection

**Purpose**: Group related products into collections

**Signed By**: User (seller or app)

**Structure**:

```json
{
	"kind": 30405,
	"pubkey": "<user's pubkey>",
	"content": "{\"name\":\"Summer Collection\",\"description\":\"Summer products\",\"image\":\"https://...\"}",
	"tags": [
		["d", "<collection-uuid>"],
		["a", "30402:<pubkey>:<product-id-1>"],
		["a", "30402:<pubkey>:<product-id-2>"],
		["t", "seasonal"]
	]
}
```

**Tags**:

- `d`: Collection identifier
- `a`: Product coordinates (multiple)
- `t`: Collection tags

### Kind 30003: Featured Collections List (NIP-51)

**Purpose**: List of featured collections

**Signed By**: User or App

**Structure**:

```json
{
	"kind": 30003,
	"pubkey": "<user's pubkey>",
	"content": "",
	"tags": [
		["d", "featured_collections"],
		["a", "30405:<pubkey>:<collection-id-1>"],
		["a", "30405:<pubkey>:<collection-id-2>"]
	]
}
```

---

## Admin Events

### Kind 10000: Ban List (NIP-51)

**Purpose**: Mute/ban list for the marketplace

**Signed By**: App

**Structure**:

```json
{
	"kind": 10000,
	"pubkey": "<app's pubkey>",
	"content": "",
	"tags": [
		["p", "<banned-pubkey-1>"],
		["p", "<banned-pubkey-2>"],
		["t", "spam"],
		["word", "badword"]
	]
}
```

**Tags**:

- `p`: Banned user pubkeys
- `t`: Banned hashtags
- `word`: Banned words/phrases

### Kind 30000: User Roles (NIP-51)

**Purpose**: Assign roles to users

**Signed By**: App

**Structure**:

```json
{
	"kind": 30000,
	"pubkey": "<app's pubkey>",
	"content": "",
	"tags": [
		["d", "admins"],
		["p", "<admin-pubkey-1>"],
		["p", "<admin-pubkey-2>"]
	]
}
```

**Roles** (via `d` tag):

- `admins`: Full administrative access
- `editors`: Content moderation access
- `plebs`: Regular users (default)

---

## Encryption Standards

### NIP-04 Encryption (Deprecated, but still used)

**Algorithm**: ECIES using secp256k1

**Usage**: Encrypt content for specific recipient

```typescript
import { nip04 } from 'nostr-tools'

// Encrypt
const encrypted = await nip04.encrypt(privateKey, recipientPubkey, plaintext)

// Decrypt
const plaintext = await nip04.decrypt(privateKey, senderPubkey, encrypted)
```

### NIP-44 Encryption (Recommended, future)

**Algorithm**: XChaCha20-Poly1305

**Status**: Planned migration

---

## Query Patterns

### Fetching User Products

```json
{
	"kinds": [30402],
	"authors": ["<seller-pubkey>"],
	"#l": ["on-sale"]
}
```

### Fetching Product by ID

```json
{
	"kinds": [30402],
	"authors": ["<seller-pubkey>"],
	"#d": ["<product-uuid>"]
}
```

### Fetching Payment Details

```json
{
	"kinds": [30078],
	"authors": ["<user-pubkey>"],
	"#l": ["payment_detail"]
}
```

### Fetching Orders for Buyer

```json
{
	"kinds": [14, 16, 17],
	"#p": ["<buyer-pubkey>"]
}
```

---

## Best Practices

### Event Publishing

1. **Always verify signatures** before trusting event data
2. **Use NDK or nostr-tools** for event creation/verification
3. **Encrypt sensitive data** (payment details, addresses, etc.)
4. **Use proper `d` tags** for replaceable events
5. **Include relevant tags** for better discoverability

### Data Modeling

1. **Use coordinates** for referencing replaceable events
2. **Normalize data** across events (avoid duplication)
3. **Use labels (`l` tags)** to categorize kind 30078 events
4. **Tag related events** with `e` and `a` tags

### Performance

1. **Cache events** using NDK's Dexie adapter
2. **Batch queries** when possible
3. **Use REQ filters** efficiently (specific kinds, authors, tags)
4. **Limit subscriptions** to necessary events only

---

## Error Handling

### Common Errors

| Error               | Cause                              | Solution                   |
| ------------------- | ---------------------------------- | -------------------------- |
| `Invalid signature` | Event signature doesn't match      | Re-create and sign event   |
| `Duplicate event`   | Event ID already exists            | Expected for idempotency   |
| `Rate limited`      | Too many requests to relay         | Implement backoff strategy |
| `Blocked`           | Relay rejected event               | Check relay policies       |
| `pow: difficulty`   | Missing/insufficient proof-of-work | Add required PoW           |

---

## References

- [NIP-01: Basic protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-04: Encrypted Direct Messages](https://github.com/nostr-protocol/nips/blob/master/04.md)
- [NIP-51: Lists](https://github.com/nostr-protocol/nips/blob/master/51.md)
- [NIP-65: Relay List Metadata](https://github.com/nostr-protocol/nips/blob/master/65.md)
- [NIP-78: App-specific data](https://github.com/nostr-protocol/nips/blob/master/78.md)
- [NIP-89: App handlers](https://github.com/nostr-protocol/nips/blob/master/89.md)

---

**Last Updated**: 2025-11-20
**Maintained By**: Plebeian Market Team
