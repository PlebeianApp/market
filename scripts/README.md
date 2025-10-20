# Seeding Scripts

## Overview

Scripts for seeding the marketplace with test data including users, products, collections, shipping options, and payment details.

## Available Scripts

### `seed.ts`

Main seeding script that creates a complete test environment.

**Usage:**

```bash
# Basic seeding (global wallets only)
npm run seed

# With multi-wallet configuration for testing
SEED_MULTI_WALLETS=true npm run seed
```

**What it creates:**

- User profiles with realistic data
- Products (various visibility states)
- Collections
- Shipping options (pickup + standard)
- Payment details (Lightning + On-chain)
- NWC wallets (2 per user)
- V4V shares

**Multi-wallet mode** (when `SEED_MULTI_WALLETS=true`):

- Creates multiple payment wallets with different scopes for the first user
- Enables testing of the wallet selection UI during checkout
- Creates global, product-specific, and multi-product wallets

### `gen_payment_details.ts`

Utility functions for creating payment details with different scopes.

**Key Functions:**

- `generateLightningPaymentDetail()` - Create Lightning wallet with scope
- `generateOnChainPaymentDetail()` - Create on-chain wallet with scope
- `seedMultiplePaymentDetails()` - Create comprehensive multi-wallet setup

**See:** [PAYMENT_DETAILS_SEEDING.md](../docs/PAYMENT_DETAILS_SEEDING.md) for detailed documentation.

## Environment Variables

### Required

- `APP_PUBKEY` - Application public key for encryption
- `RELAYS` - Comma-separated list of relay URLs
- `WALLETED_USER_LUD16` - Lightning address for seeded users (e.g., `user@getalby.com`)

### Optional

- `SEED_MULTI_WALLETS` - Set to `'true'` to enable multi-wallet seeding (default: `false`)
- `XPUB` - Extended public key for on-chain payments (has default)

## Examples

### Basic Seeding

Creates users with single global wallet:

```bash
APP_PUBKEY=your_app_pubkey \
WALLETED_USER_LUD16=test@getalby.com \
RELAYS=wss://relay.example.com \
npm run seed
```

### Multi-Wallet Testing

Creates first user with multiple payment wallets:

```bash
APP_PUBKEY=your_app_pubkey \
WALLETED_USER_LUD16=test@getalby.com \
RELAYS=wss://relay.example.com \
SEED_MULTI_WALLETS=true \
npm run seed
```

This creates for the first user:

- 1 global wallet (all products)
- 1 single-product wallet (product 1)
- 1 multi-product wallet (products 2-3)
- 1 multi-product wallet (products 4-5, if available)

### Custom Payment Details

Use the helper functions directly:

```typescript
import { seedMultiplePaymentDetails } from './gen_payment_details'

// Your coordinates
const productCoordinates = ['30402:pubkey:product-1', '30402:pubkey:product-2', '30402:pubkey:product-3']

const collectionCoordinates = ['30405:pubkey:collection-1']

await seedMultiplePaymentDetails(signer, ndk, appPubkey, 'seller@getalby.com', productCoordinates, collectionCoordinates)
```

## Testing Multi-Wallet Checkout

1. **Seed with multi-wallets:**

   ```bash
   SEED_MULTI_WALLETS=true npm run seed
   ```

2. **Login as first user** (devUser1)

3. **View products** from devUser1's store

4. **Add multiple products to cart** (products that have different wallet configurations)

5. **Proceed to checkout**
   - Complete shipping info
   - Review order
   - **Wallet selection step appears** (if products have multiple wallet options)
   - Select preferred wallet
   - Continue to payment

6. **Expected behavior:**
   - Products with single wallet → Auto-selected, no UI shown
   - Products with multiple wallets → Wallet selector appears
   - Invoice generated with selected wallet

## Seeding Output

### Basic Mode

```
Creating profile for user f47121cd...
Published profile for laverne_armstrong
Creating payment details for user f47121cd...
✅ Published payment detail: LIGHTNING_NETWORK - test@getalby.com (global scope)
✅ Published payment detail: ON_CHAIN - xpub6... (global scope)
Creating NWC wallets for user f47121cd...
Creating shipping options for user f47121cd...
Creating products for user f47121cd...
```

### Multi-Wallet Mode

```
[... basic seeding output ...]

🎯 Creating multi-wallet configuration for first user...

🌱 Seeding multiple payment details for testing...
Lightning Address: test@getalby.com
Products: 5
Collections: 0

1️⃣ Creating GLOBAL wallet...
✅ Published payment detail: LIGHTNING_NETWORK - test@getalby.com (global scope)

2️⃣ Creating COLLECTION-SPECIFIC wallets...
(skipped - no collections)

3️⃣ Creating PRODUCT-SPECIFIC wallets...
✅ Published payment detail: LIGHTNING_NETWORK - test@getalby.com (scoped to 1 coordinate(s))
✅ Published payment detail: LIGHTNING_NETWORK - test@getalby.com (scoped to 2 coordinate(s))
✅ Published payment detail: LIGHTNING_NETWORK - test@getalby.com (scoped to 2 coordinate(s))

✨ Seeding complete: 4/4 payment details created
```

## Troubleshooting

### Payment Detail Creation Fails

**Error:** `TypeError: undefined is not an object (evaluating 'paymentDetailData.paymentDetail.substring')`

**Solution:** Make sure you're using the new API with object parameters:

```typescript
// ❌ Old way
generateLightningPaymentDetail('address@ln.com')

// ✅ New way
generateLightningPaymentDetail({
	lightningAddress: 'address@ln.com',
	scope: 'global',
})
```

### Multi-Wallet Seeding Skipped

**Message:** `⚠️ Not enough products (N) for multi-wallet seeding, skipping...`

**Solution:** Increase the number of products per user in seed.ts, or reduce the minimum required in the condition.

### No Wallet Selection UI in Checkout

**Possible causes:**

1. Only one wallet created per product → Expected behavior
2. `SEED_MULTI_WALLETS` not set to `'true'`
3. Not enough products to create multiple wallets
4. Need to clear and reseed data

**Solution:**

```bash
# Clear old data, reseed with multi-wallets
SEED_MULTI_WALLETS=true npm run seed
```

## Related Documentation

- [PAYMENT_DETAILS_SEEDING.md](../docs/PAYMENT_DETAILS_SEEDING.md) - Detailed payment details seeding guide
- [WALLET_SELECTION_IMPLEMENTATION.md](../docs/WALLET_SELECTION_IMPLEMENTATION.md) - Multi-wallet checkout implementation
- [WALLET_IMPLEMENTATION_SUMMARY.md](../docs/WALLET_IMPLEMENTATION_SUMMARY.md) - Overall wallet feature summary

## Notes

- All seeded users use the same Lightning address (for testing)
- Products are created with various visibility states (on-sale, hidden, pre-order)
- Multi-wallet configuration only applied to first user by default
- Payment details are encrypted to the app's public key
