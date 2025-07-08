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
- **Seller can**: Confirm (accepting the order)
- **Reasoning**: Only the seller should confirm receipt of a new order, and both parties can cancel before confirmation

### CONFIRMED

- **Buyer can**: Cancel (still before processing)
- **Seller can**: Process (move to fulfillment)
- **Reasoning**: After payment confirmation, seller needs to process the order, but buyer can still cancel if needed

### PROCESSING

- **Buyer can**: Cancel (though impact is limited after processing started)
- **Seller can**: Ship (mark as shipped) & Complete (for digital goods)
- **Reasoning**: Primary actions are with seller as they handle order fulfillment

### SHIPPED (PROCESSING + shipping updates)

- **Buyer can**: Confirm receipt
- **Seller can**: Mark as delivered/completed
- **Reasoning**: Either party can complete the transaction - buyer upon receiving goods or seller when delivery is confirmed

### COMPLETED / CANCELLED

- **No further actions**: These are terminal states
- **Reasoning**: Order lifecycle is finished

## Technical Implementation

### Nostr Events and Message Types

The order flow uses the following Nostr event types:

- **ORDER_CREATION** (Type 1): Initial order event
- **PAYMENT_REQUEST** (Type 2): Payment request from seller
- **STATUS_UPDATE** (Type 3): Status changes (pending, confirmed, processing, completed, cancelled)
- **SHIPPING_UPDATE** (Type 4): Shipping-specific updates (shipped, delivered)

### Dual-Track Approach for Shipping

When an order is shipped, two events are generated:

1. **Status Update** (Type 3): Maintains the "PROCESSING" state
2. **Shipping Update** (Type 4): Records shipping details (tracking, carrier)

This approach:

- Preserves the linear order workflow
- Treats shipping as a sub-state of processing
- Allows for shipping-specific details while maintaining compatibility

### UI Representation

The UI displays shipping status through a hybrid approach:

- Underlying `ORDER_STATUS` remains "PROCESSING"
- UI checks for shipping updates to display "Shipped" with:
  - Orange color scheme
  - Truck icon
  - Updated action buttons ("Mark as Delivered" vs "Complete Order")

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
