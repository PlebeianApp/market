# Gamma Markets Order Communication Flow

Order processing and status updates use NIP-17 encrypted direct messages with three event kinds:

| Kind | Purpose                                         |
| ---- | ----------------------------------------------- |
| 14   | Regular communication between parties           |
| 16   | Order processing and status (with `type` field) |
| 17   | Payment receipts and verification               |

Message direction is determined by author and `p` tag:

- Buyer → Merchant: event author is buyer, `p` tag contains merchant's pubkey
- Merchant → Buyer: event author is merchant, `p` tag contains buyer's pubkey

---

## Kind 16 Message Types

### Type 1: Order Creation

Sent by buyer to initiate order process.

**Required tags:**

- `p`: Merchant's public key
- `subject`: Human-friendly subject line
- `type`: "1"
- `order`: Unique identifier for the order
- `amount`: Total order amount in satoshis
- `item`: Product reference "30402:<pubkey>:<d-tag>" with quantity (MAY appear multiple times)

**Optional tags:**

- `shipping`: Reference to shipping option "30406:<pubkey>:<d-tag>"
- `address`: Shipping address details
- `email`: Customer email
- `phone`: Customer phone number

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<merchant-pubkey>"],
		["subject", "<order-info subject>"],
		["type", "1"],
		["order", "<order-id>"],
		["amount", "<total-amount-in-sats>"],
		["item", "30402:<pubkey>:<d-tag>", "<quantity>"],
		["shipping", "30406:<pubkey>:<d-tag>"],
		["address", "<shipping-address>"],
		["email", "<customer-email>"],
		["phone", "<customer-phone>"],
	],
	"content": "Order notes or special requests",
}
```

---

### Type 2: Payment Request

Two variants depending on payment processing mode.

#### Manual Processing (merchant → buyer)

Merchant initiates payment request. Used when `payment_preference` is `manual` or not set.

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<buyer-pubkey>"],
		["subject", "order-payment"],
		["type", "2"],
		["order", "<order-id>"],
		["amount", "<total-amount-in-sats>"],
		["payment", "lightning", "<bolt11-invoice|lud16>"],
		["payment", "bitcoin", "<btc-address>"],
		["payment", "ecash", "<cashu-req>"],
		["expiration", "<unix-timestamp>"],
	],
	"content": "Payment instructions and notes",
}
```

#### Automatic Processing (buyer → merchant)

Buyer initiates using merchant's payment preferences. Requires valid `payment_preference` in merchant's kind:0.

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<merchant-pubkey>"],
		["subject", "order-payment"],
		["type", "2"],
		["order", "<order-id>"],
		["amount", "<total-amount-in-sats>"],
		["payment", "lightning", "<bolt11-invoice|bolt12-offer>"],
		["payment", "ecash", "<cashu-req>"],
	],
	"content": "Service-generated payment details",
}
```

---

### Type 3: Order Status Updates

Sent by merchant after receiving payment.

**Required tags:**

- `p`: Buyer's public key
- `subject`: Human-friendly subject line
- `type`: "3"
- `order`: The original order identifier
- `status`: Current order status

**Status values:**

- `pending`: Order received but awaiting payment
- `confirmed`: Payment received and verified
- `processing`: Order is being prepared
- `completed`: Order fulfilled
- `cancelled`: Order cancelled by either party

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<buyer-pubkey>"],
		["subject", "order-info"],
		["type", "3"],
		["order", "<order-id>"],
		["status", "<pending|confirmed|processing|completed|cancelled>"],
	],
	"content": "Human readable status update",
}
```

**Buyer cancellation:**

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<merchant-pubkey>"],
		["subject", "order-info"],
		["type", "3"],
		["order", "<order-id>"],
		["status", "cancelled"],
	],
	"content": "Human readable status update",
}
```

---

### Type 4: Shipping Updates

Sent by merchant to provide delivery tracking.

**Required tags:**

- `p`: Buyer's public key
- `subject`: Human-friendly subject line
- `type`: "4"
- `order`: The original order identifier
- `status`: Shipping status

**Shipping status values:**

- `processing`: Order is being prepared for shipping
- `shipped`: Package has been handed to carrier
- `delivered`: Successfully delivered
- `exception`: Delivery issue or delay

**Optional tags:**

- `tracking`: Carrier's tracking number
- `carrier`: Name of shipping carrier
- `eta`: Expected delivery time (unix timestamp)

```jsonc
{
	"kind": 16,
	"tags": [
		["p", "<buyer-pubkey>"],
		["subject", "shipping-info"],
		["type", "4"],
		["order", "<order-id>"],
		["status", "<processing|shipped|delivered|exception>"],
		["tracking", "<tracking-number>"],
		["carrier", "<carrier-name>"],
		["eta", "<unix-timestamp>"],
	],
	"content": "Shipping status and tracking information",
}
```

---

## Kind 14: General Communication

Used for any order-related messages.

```jsonc
{
	"kind": 14,
	"tags": [
		["p", "<recipient-pubkey>"],
		["subject", "<order-id>"],
	],
	"content": "General communication message",
}
```

---

## Kind 17: Payment Receipt

Sent by buyer to confirm payment completion.

**Required tags:**

- `p`: Merchant's public key
- `subject`: Human-friendly subject line
- `order`: The original order identifier
- `payment`: Payment proof (at least one required)
- `amount`: Payment amount

**Payment formats:**

- Lightning: `["payment", "lightning", "<invoice>", "<preimage>"]`
- Bitcoin: `["payment", "bitcoin", "<address>", "<txid>"]`
- eCash: `["payment", "ecash", "<mint-url>", "<proof>"]`
- Fiat: `["payment", "fiat", "<some-id>", "<some-proof>"]`
- Generic: `["payment", "<medium>", "<medium-reference>", "<proof>"]`

```jsonc
{
	"kind": 17,
	"tags": [
		["p", "<merchant-pubkey>"],
		["subject", "order-receipt"],
		["order", "<order-id>"],
		["payment", "lightning", "<invoice>", "<preimage>"],
		["amount", "<amount>"],
	],
	"content": "Payment confirmation details",
}
```
