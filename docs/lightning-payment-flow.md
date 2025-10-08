# Lightning Payment Flow Diagram

## Zap Payment Flow (V4V)

```mermaid
sequenceDiagram
    participant User
    participant LPP as LightningPaymentProcessor
    participant NDK as NDK Store
    participant Zapper as NDKZapper
    participant Relay as Zap Relays
    participant Wallet as User's Wallet

    User->>LPP: Opens payment dialog
    LPP->>LPP: Check if active
    LPP->>NDK: connectZapNdk()
    NDK->>Relay: Connect to zap relays

    LPP->>Zapper: Generate zap invoice
    Zapper->>LPP: Return bolt11 invoice
    LPP->>LPP: Display QR code

    LPP->>NDK: monitorZapPayment(bolt11)
    NDK->>Relay: Subscribe to zap receipts

    User->>LPP: Click "Pay with NWC/WebLN"
    alt NWC Payment
        LPP->>Wallet: Pay via NWC
        Wallet->>Relay: Publish zap receipt
    else WebLN Payment
        LPP->>Wallet: Pay via WebLN
        Wallet->>Relay: Publish zap receipt
    else QR Code
        User->>Wallet: Scan QR & pay
        Wallet->>Relay: Publish zap receipt
    end

    Relay->>NDK: Zap receipt event
    NDK->>NDK: Filter by bolt11
    NDK->>LPP: onZapReceived(preimage)
    LPP->>LPP: handlePaymentSuccess()
    LPP->>User: Show success feedback
    LPP->>NDK: Cleanup monitoring
```

## Regular Invoice Flow (Merchant Payment)

```mermaid
sequenceDiagram
    participant User
    participant LPP as LightningPaymentProcessor
    participant Wallet as User's Wallet

    User->>LPP: Opens payment with bolt11
    LPP->>LPP: Display QR code

    User->>LPP: Click "Pay with NWC/WebLN"
    alt NWC Payment
        LPP->>Wallet: Pay via NWC
        Wallet->>LPP: Payment result
        LPP->>User: Immediate success
    else WebLN Payment
        LPP->>Wallet: Pay via WebLN
        Wallet->>LPP: Payment result + preimage
        LPP->>User: Immediate success
    else QR Code
        User->>Wallet: Scan QR & pay
        User->>LPP: Enter preimage manually
        LPP->>LPP: Validate preimage
        LPP->>User: Success after validation
    end
```

## Checkout Multi-Invoice Flow

```mermaid
sequenceDiagram
    participant User
    participant Checkout
    participant PC as PaymentContent
    participant LPP1 as Processor 1 (Merchant)
    participant LPP2 as Processor 2 (V4V)

    User->>Checkout: Complete shipping
    Checkout->>Checkout: Generate invoices
    Checkout->>PC: Load PaymentContent

    PC->>LPP1: Render (active=true)
    PC->>LPP2: Render (active=false)

    User->>PC: Pay invoice 1
    LPP1->>PC: onPaymentComplete()
    PC->>PC: Update invoice state
    PC->>PC: Auto-advance to next

    PC->>LPP1: active=false
    PC->>LPP2: active=true

    User->>PC: Pay invoice 2
    LPP2->>PC: onPaymentComplete()
    PC->>Checkout: All payments complete
    Checkout->>User: Show order confirmation
```

## Bulk Payment with NWC

```mermaid
sequenceDiagram
    participant User
    participant PC as PaymentContent
    participant LPP1 as Processor 1
    participant LPP2 as Processor 2
    participant LPP3 as Processor 3
    participant NWC as NWC Wallet

    User->>PC: Click "Pay All with NWC"
    PC->>PC: Get all pending invoices

    loop For each invoice
        PC->>LPP1: triggerNwcPayment()
        LPP1->>NWC: Pay invoice 1
        NWC->>LPP1: Success
        LPP1->>PC: onPaymentComplete()
        PC->>User: Show progress (1/3)

        PC->>PC: Wait 1 second

        PC->>LPP2: triggerNwcPayment()
        LPP2->>NWC: Pay invoice 2
        NWC->>LPP2: Success
        LPP2->>PC: onPaymentComplete()
        PC->>User: Show progress (2/3)

        PC->>PC: Wait 1 second

        PC->>LPP3: triggerNwcPayment()
        LPP3->>NWC: Pay invoice 3
        NWC->>LPP3: Success
        LPP3->>PC: onPaymentComplete()
        PC->>User: Show progress (3/3)
    end

    PC->>User: All payments complete! 🎉
```

## State Transitions

```mermaid
stateDiagram-v2
    [*] --> Idle: Component mounts
    Idle --> GeneratingInvoice: Zap needs invoice
    GeneratingInvoice --> ShowingInvoice: Invoice generated
    GeneratingInvoice --> Failed: Generation failed

    ShowingInvoice --> ProcessingPayment: User initiates payment
    ProcessingPayment --> Monitoring: Payment sent (zap)
    ProcessingPayment --> Success: Payment sent (regular)

    Monitoring --> Success: Zap receipt detected
    Monitoring --> Timeout: No receipt (90s)

    Success --> [*]: Cleanup & notify parent
    Failed --> ShowingInvoice: Retry
    Timeout --> ShowingInvoice: Retry
```

## Component Lifecycle

```mermaid
graph TD
    A[Component Mount] -->|active=true| B[Initialize]
    B --> C{isZap?}
    C -->|Yes| D[Generate Invoice]
    C -->|No| E[Use Provided bolt11]

    D --> F[Start Monitoring]
    E --> G[Display QR Code]
    F --> G

    G --> H{User Action}
    H -->|NWC| I[Pay with NWC]
    H -->|WebLN| J[Pay with WebLN]
    H -->|QR Scan| K[External Payment]

    I --> L{isZap?}
    J --> L
    K --> L

    L -->|Yes| M[Wait for Receipt]
    L -->|No| N[Immediate Success]

    M -->|Receipt Found| O[handlePaymentSuccess]
    M -->|Timeout| P[Show Timeout Message]
    N --> O

    O --> Q[Cleanup Monitoring]
    Q --> R[Notify Parent]
    R --> S[Component Unmount/Inactive]

    S --> T[Stop All Subscriptions]
    T --> U[Clear Timeouts]
    U --> V[Reset State]
```

## Error Handling Flow

```mermaid
graph TD
    A[Payment Initiated] --> B{Invoice Valid?}
    B -->|No| C[Show Error]
    B -->|Yes| D{NWC Available?}

    D -->|No & Required| C
    D -->|Yes| E[Attempt Payment]

    E --> F{Payment Success?}
    F -->|No| G{Error Type}

    G -->|Network| H[Show Retry Option]
    G -->|Insufficient Funds| I[Show Balance Error]
    G -->|Invalid Invoice| J[Show Invoice Error]
    G -->|Timeout| K[Show Timeout Message]

    H --> L{User Retry?}
    L -->|Yes| E
    L -->|No| M[Cancel]

    F -->|Yes| N{isZap?}
    N -->|Yes| O{Receipt Received?}
    N -->|No| P[Complete]

    O -->|Yes| P
    O -->|No - Timeout| Q[Payment Likely Succeeded]

    Q --> R[Suggest Manual Verification]
```

## Key Decision Points

### Should Generate Invoice?

```typescript
if (data.isZap && !invoice && !isGeneratingInvoice && !hasRequestedInvoice && active) {
	generateZapInvoice()
}
```

### Should Start Monitoring?

```typescript
if (invoice && data.isZap && !paymentMonitoring && active) {
	startZapMonitoring()
}
```

### Should Cleanup?

```typescript
if (!active && paymentMonitoring) {
	paymentMonitoring() // Stop monitoring
	setPaymentMonitoring(null)
}
```

### Should Regenerate?

```typescript
if (data.isZap && invoice && (amountChanged || descriptionChanged)) {
	// Clear and regenerate
	setInvoice(null)
	hasRequestedInvoiceRef.current = false
}
```

## Best Practices

### 1. Always Cleanup

```typescript
useEffect(() => {
	// ... start monitoring

	return () => {
		if (paymentMonitoring) {
			paymentMonitoring() // Always cleanup
		}
	}
}, [dependencies])
```

### 2. Prevent Duplicates

```typescript
const hasCompletedRef = useRef(false)

const handlePaymentSuccess = (preimage: string) => {
	if (hasCompletedRef.current) return // Prevent duplicates
	hasCompletedRef.current = true
	// ... handle success
}
```

### 3. Active Control

```typescript
// Only active processor should generate invoices and monitor
active={index === currentIndex}
```

### 4. Proper Error Context

```typescript
onPaymentFailed?.({
	success: false,
	error: error.message,
	paymentHash: data.invoiceId, // Include context
})
```

## Testing Scenarios

| Scenario                 | Expected Behavior                                             |
| ------------------------ | ------------------------------------------------------------- |
| Zap with NWC             | Invoice generated → Payment sent → Receipt detected → Success |
| Zap with WebLN           | Invoice generated → Payment sent → Receipt detected → Success |
| Zap with QR              | Invoice generated → User scans → Receipt detected → Success   |
| Regular with NWC         | Show QR → Payment sent → Immediate success                    |
| Regular with WebLN       | Show QR → Payment sent → Immediate success                    |
| Change amount mid-flow   | Old invoice cleared → New invoice generated                   |
| Cancel during generation | Generation aborted → Cleanup                                  |
| Network timeout          | Informative timeout message → Option to retry                 |
| Multiple invoices        | Sequential processing → Progress updates                      |
| Bulk NWC payment         | All invoices paid → Success feedback                          |
