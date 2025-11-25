# Order Flow and Shipping Process

## Order State Flow Diagram

```
    BUYER creates ORDER
         |
         v
   +-------------+
   |   PENDING   |<----- Initial state after order creation
   +-------------+
    |         |
    |         |
+---v---+     +---v---+
| SELLER|     | BUYER |
| can   |     | can   |
|confirm|     |cancel |
+---+---+     +---+---+
    |             |
    v             v
+-------------+   +-------------+
|  CONFIRMED  |   |  CANCELLED  |
+-------------+   +-------------+
    |      |          (Terminal state)
    |      |
+---v---+  +---v---+
| SELLER|  | BUYER |
| can   |  | can   |
|process|  |cancel |
+---+---+  +---+---+
    |          |
    v          v
+-------------+   +-------------+
| PROCESSING  |-->|  CANCELLED  |
+-------------+   +-------------+
    |      |          (Terminal state)
    |      |
+---v---+  +---v---+
| SELLER|  | BUYER |
| can   |  | can   |
| ship  |  |cancel |
+---+---+  +---+---+
    |          |
    v          v
+-------------+   +-------------+
|  SHIPPED    |-->|  CANCELLED  |
|(Processing +|   +-------------+
| shipping   |       (Terminal state)
|  tags)     |
+-------------+
    |      |
    |      |
+---v---+  +---v---+
| SELLER|  | BUYER |
| can   |  | can   |
|deliver|  |confirm|
|       |  |receipt|
+---+---+  +---+---+
    |          |
    v          v
+-------------+
|  COMPLETED  |
+-------------+
  (Terminal state)
```

## State Transition Rules & Reasoning

### PENDING

- **Buyer can**: Cancel (it's their order)
- **Seller can**: Cancel (optional, administrative)
- **Seller can**: Confirm (accepting the order)
- **Reasoning**: Only the seller should confirm receipt of a new order. Cancellation is allowed only before confirmation.

### CONFIRMED

- **Buyer cannot cancel**: Cancellation is only allowed before confirmation
- **Seller can**: Process (move to fulfillment)
- **Reasoning**: Once confirmed by the merchant, the order progresses to fulfillment; refunds are handled off-protocol via messaging between parties.

### PROCESSING

- **Buyer cannot cancel**
- **Seller can**: Ship (send shipping update with tracking)
- **Reasoning**: Primary actions are with seller as they handle order fulfillment

### SHIPPED (PROCESSING + shipping updates)

- **Buyer can**: Confirm receipt (sets order to Completed)
- **Seller cannot**: Complete orders
- **Reasoning**: Only buyers can mark orders as completed after shipment; delivery confirmation is buyer-driven.

### COMPLETED / CANCELLED

- **No further actions**: These are terminal states
- **Reasoning**: Order lifecycle is finished

## Technical Implementation

### Nostr Events and Message Types

The order flow uses the following Nostr event types:

- **ORDER_CREATION** (Type 1): Initial order event
- **PAYMENT_REQUEST** (Type 2): Payment request from seller
- **STATUS_UPDATE** (Type 3): Status changes (pending, confirmed, processing, completed, cancelled)
- **SHIPPING_UPDATE** (Type 4): Shipping-specific updates (processing, shipped, delivered, exception)

### Shipping Updates

Shipping is represented exclusively via **Type 4** events. Order status (Type 3) and shipping status (Type 4) are separate streams. Shipping updates carry tracking, carrier, and status such as `processing`, `shipped`, `delivered`, or `exception`.

### UI Representation

- Display order status from Type 3 events
- Display shipping status from Type 4 events (e.g. show "Shipped" with truck icon)
- Completion is a buyer action available only after a `shipped` shipping update exists

### Permissions Control

Status transitions are enforced through conditional rendering in `OrderActions.tsx`:

```typescript
// Shipping action only available to seller for processing orders not yet shipped
const canShip = isSeller && status === ORDER_STATUS.PROCESSING && !hasBeenShipped

// Complete order button changes text based on shipping state
{isSeller && canComplete && (
  <DropdownMenuItem onClick={() => handleStatusUpdate(ORDER_STATUS.COMPLETED)}>
    <PackageCheck className="mr-2 h-4 w-4" />
    {hasBeenShipped ? 'Mark as Delivered' : 'Complete Order'}
  </DropdownMenuItem>
)}
```

### Detecting Shipping State

The application detects if an order has been shipped by checking for shipping updates:

```typescript
const hasBeenShipped = order.shippingUpdates.some((update) => update.tags.find((tag) => tag[0] === 'status')?.[1] === 'shipped')
```

## Implementation Benefits

- **Clear Visual Feedback**: Users can easily see shipping status
- **Flexible Workflow**: Supports physical and digital goods
- **Protocol Compatibility**: Maintains Nostr event structure
- **User-appropriate Actions**: Shows relevant actions to each party

## Seeding and Testing the Complete Order Flow

To test the full order lifecycle, the application uses a seeding mechanism that creates orders in every possible state. The `seed.ts` script is designed to generate a complete spectrum of order scenarios:

### Seeded Order States

1. **PENDING Orders**

   - Only the order creation and payment request events are created
   - No payment receipt or status updates
   - Allows testing of initial order display and seller confirmation flow

2. **CONFIRMED Orders**

   - Includes order creation, payment request and receipt
   - Adds a status update to CONFIRMED
   - Tests the payment confirmation handling

3. **PROCESSING Orders**

   - Full flow through CONFIRMED
   - Adds PROCESSING status
   - Tests the order processing interface and shipping preparation

4. **SHIPPED Orders**

   - Includes CONFIRMED and PROCESSING states
   - Adds a shipping update with SHIPPING_STATUS.SHIPPED
   - Tests the hybrid status representation (PROCESSING + shipping tag)
   - Validates the visual shipping indicators (orange color, truck icon)

5. **COMPLETED Orders**

   - Full order lifecycle through all states
   - Demonstrates the complete flow from creation to delivery
   - Tests final state handling and order history display

6. **CANCELLED Orders**
   - Tests cancellation at various stages:
     - Cancellation in PENDING state
     - Cancellation in CONFIRMED state
     - Cancellation in PROCESSING state
   - Includes random selection of which party (buyer or seller) performs the cancellation
   - Validates cancellation permissions based on order state

This seeding approach ensures comprehensive testing of all UI components and business logic across the entire order flow spectrum, providing confidence that the application correctly handles all possible order states and transitions.
