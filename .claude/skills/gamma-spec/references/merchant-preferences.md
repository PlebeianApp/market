# Gamma Markets Merchant Preferences

Merchants specify preferences for user interactions, including applications and payment methods.

## Preference Mechanisms

### 1. Application Preferences (NIP-89)

- Recommended application MUST publish a kind `31990` event
- Merchant MUST publish a kind `31989` event recommending that application

### 2. Payment Preferences

Set via `payment_preference` tag in merchant's kind `0` event:

```jsonc
["payment_preference", "<manual | ecash | lud16>"]
```

| Value    | Description                                                  |
| -------- | ------------------------------------------------------------ |
| `manual` | Default. Merchant provides payment requests directly         |
| `ecash`  | Use eCash tokens (requires kind `10019` for mint preference) |
| `lud16`  | Use Lightning via merchant's `lud16` address                 |

---

## Payment Flow Decision Tree

### When `payment_preference` is `manual`:

- **If merchant recommends an app**: MUST direct users to that app
- **If no app recommendation**: Use traditional interactive flow (buyer places order, waits for merchant's payment request)

### When `payment_preference` is `ecash` or `lud16`:

- **If merchant recommends an app**: SHOULD direct users there first, MAY also offer to continue if compatible
- **If no recommendations**: Use specified payment method directly

### When no preferences are set:

- Use traditional interactive flow
  - Buyer sends order
  - Wait for merchant's payment request

---

## Payment Processing Modes

### 1. Manual Processing

- Merchant initiates payment request
- Used when no application recommended or automatic preferences set
- Merchant must manually send payment requests
- Buyer waits for merchant's payment instructions
- Merchants can have their own service that listens for orders and sends payment requests

### 2. Automatic Processing

- Buyer initiates payment request
- Requires valid `payment_preference` in merchant's kind `0`
- Supports automatic payments via:
  - eCash tokens (locked to merchant's pubkey)
  - Lightning (using merchant's `lud16` address)

### 3. Service-Based Processing

- Merchant MUST set `payment_preference` to `manual`
- Merchant SHOULD have a NIP-89 kind `31989` event recommending their preferred service
- Buyers can immediately request payment using the service
- Service handles payment details and completion monitoring

---

## eCash Considerations

When `payment_preference` is `ecash`:

1. Check for kind `10019` event to determine preferred mint
2. If `10019` not present, payment can be made by sending token from previously set mint
3. Otherwise, use merchant's preferred mint

---

## Buyer Verification

Buyers verify merchant preferences by:

1. Checking kind `31990` events for recommended applications
2. Checking kind `0` events for payment preferences

This verification helps buyers follow merchant-approved paths and avoid scams or poor experiences.
