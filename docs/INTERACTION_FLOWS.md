# Plebian Market - Complete Interaction Flow Analysis

## Overview

This document provides a comprehensive analysis of all user interaction paths and flows in the Plebian Market web application. The app is a Nostr-based marketplace built with React, TanStack Router, and NDK (Nostr Development Kit).

## Table of Contents

1. [Application Architecture](#application-architecture)
2. [Authentication Flows](#authentication-flows)
3. [Product Management Flows](#product-management-flows)
4. [Collection Management Flows](#collection-management-flows)
5. [Shopping Cart & Checkout Flows](#shopping-cart--checkout-flows)
6. [Payment Processing Flows](#payment-processing-flows)
7. [Order Management & Communication Flows](#order-management--communication-flows)
8. [V4V (Value for Value) System](#v4v-value-for-value-system)
9. [Dashboard Navigation](#dashboard-navigation)
10. [Admin Functions](#admin-functions)

---

## Application Architecture

### Core Technologies
- **Frontend**: React 19 with TypeScript
- **Routing**: TanStack Router (file-based routing)
- **State Management**: TanStack Store
- **Data Fetching**: TanStack Query
- **Forms**: TanStack Form with Zod validation
- **UI**: Radix UI + Tailwind CSS
- **Nostr**: NDK (Nostr Development Kit)
- **Payments**: Lightning Network (NWC, WebLN, QR codes)

### Key Stores
- `authStore`: User authentication state
- `cartStore`: Shopping cart management
- `ndkStore`: Nostr connection management
- `uiStore`: UI state (drawers, dialogs)
- `configStore`: App configuration
- `walletStore`: Lightning wallet management

---

## Authentication Flows

### 1. Login Methods

#### Private Key Login
```
User → Login Dialog → Private Key Tab → Enter nsec → Set Password → Auto-login Option → Dashboard
```

**Components**: `PrivateKeyLogin.tsx`, `DecryptPasswordDialog.tsx`
**Store**: `authStore`
**Actions**: `loginWithPrivateKey()`, `decryptAndLogin()`

#### NIP-07 Extension Login
```
User → Login Dialog → Extension Tab → Browser Extension → Authorize → Dashboard
```

**Components**: `LoginDialog.tsx`
**Actions**: `loginWithExtension()`

#### NIP-46 Bunker Connect
```
User → Login Dialog → Bunker Tab → Enter Bunker URL → Connect → Dashboard
```

**Components**: `BunkerConnect.tsx`
**Actions**: `loginWithNip46()`

### 2. Auto-Login Flow
```
App Start → Check localStorage → Auto-login enabled? → Decrypt/Connect → Dashboard
```

**Triggers**: App initialization, page refresh
**Storage**: `localStorage` for encrypted keys and settings

### 3. Logout Flow
```
User → Logout Button → Clear localStorage → Clear cart → Reset auth state → Home page
```

**Actions**: `logout()` - clears all stored data and resets state

---

## Product Management Flows

### 1. Adding a New Product

#### Dashboard Flow
```
Dashboard → Products → Add Product → Product Form → Fill Details → Publish → Product Created
```

**Route**: `/dashboard/products/products/new`
**Components**: `NewProductContent.tsx`, `ProductFormContent.tsx`
**Store**: `productFormStore`
**Publish**: `publishProduct()` in `publish/products.tsx`

#### Product Form Steps
1. **Basic Info**: Title, description, price, currency
2. **Images**: Upload and order product images
3. **Categories**: Main category + additional tags
4. **Specifications**: Key-value pairs for product specs
5. **Shipping**: Select shipping options with costs
6. **Collection**: Optional collection assignment
7. **Weight/Dimensions**: Physical product details

#### Product Data Structure (Nostr Kind 30402)
```json
{
  "kind": 30402,
  "content": "Product description",
  "tags": [
    ["d", "product_id"],
    ["title", "Product Name"],
    ["price", "1000", "sats"],
    ["image", "url", "800x600", "1"],
    ["t", "category"],
    ["spec", "key", "value"],
    ["shipping_option", "30406:pubkey:id"],
    ["weight", "1.5", "kg"],
    ["collection", "collection_id"]
  ]
}
```

### 2. Editing Existing Product
```
Dashboard → Products → Product List → Edit Button → Pre-filled Form → Update → Product Updated
```

**Route**: `/dashboard/products/products/$productId`
**Actions**: `updateProduct()` - creates new event with updated data

### 3. Product Visibility Management
```
Product List → Toggle Visibility → Hidden/Visible → Update Nostr Event
```

**Actions**: `toggleProductVisibility()` - updates product event tags

### 4. Product Deletion
```
Product List → Delete Button → Confirmation → Delete Event → Remove from List
```

**Actions**: `deleteProduct()` - publishes deletion event

---

## Collection Management Flows

### 1. Creating a New Collection

#### Dashboard Flow
```
Dashboard → Collections → Add Collection → Collection Form → Fill Details → Publish → Collection Created
```

**Route**: `/dashboard/products/collections/new`
**Components**: `NewCollectionContent.tsx`, `CollectionFormContent.tsx`
**Store**: `collectionFormStore`
**Publish**: `publishCollection()` in `publish/collections.tsx`

#### Collection Form Steps
1. **Basic Info**: Name, description, header image
2. **Products**: Select products to include in collection
3. **Shipping**: Configure collection-wide shipping options
4. **Location**: Optional location and geohash

#### Collection Data Structure (Nostr Kind 30405)
```json
{
  "kind": 30405,
  "content": "Collection description",
  "tags": [
    ["d", "collection_id"],
    ["title", "Collection Name"],
    ["image", "header_image_url"],
    ["a", "30402:pubkey:product_id"],
    ["shipping_option", "30406:pubkey:id"]
  ]
}
```

### 2. Editing Collection
```
Dashboard → Collections → Collection List → Edit Button → Pre-filled Form → Update → Collection Updated
```

**Route**: `/dashboard/products/collections/$collectionId`
**Actions**: `updateCollection()` - creates new event with updated data

### 3. Collection Product Management
```
Collection Form → Products Tab → Select/Deselect Products → Update Collection
```

**Components**: `ProductsTab.tsx` - shows user's products with checkboxes

---

## Shopping Cart & Checkout Flows

### 1. Adding Items to Cart

#### Product Page Flow
```
Product Page → Add to Cart → Cart Store Update → Cart Drawer Opens
```

**Components**: `ProductCard.tsx`, `CartContent.tsx`
**Actions**: `cartActions.addProduct()`
**Store**: `cartStore`

#### Cart Data Structure
```typescript
interface NormalizedCart {
  products: Record<string, CartProduct>
  sellers: Record<string, CartSeller>
  v4vShares: Record<string, V4VDTO[]>
}
```

### 2. Cart Management

#### Cart Drawer Operations
```
Cart Drawer → View Items → Modify Quantities → Select Shipping → Clear Cart → Checkout
```

**Components**: `CartContent.tsx`, `CartItem.tsx`, `CartSummary.tsx`
**Actions**: 
- `updateProductAmount()` - change quantities
- `removeProduct()` - remove items
- `clear()` - empty cart
- `updateShippingMethod()` - select shipping options

### 3. Checkout Process

#### Multi-Step Checkout Flow
```
Cart → Checkout → Shipping Info → Order Summary → Payment → Order Complete
```

**Route**: `/checkout`
**Components**: `CheckoutProgress.tsx`, `ShippingAddressForm.tsx`, `PaymentContent.tsx`

#### Checkout Steps
1. **Shipping Information**
   - Collect buyer's shipping address
   - Validate required fields
   - Store in `shippingData` state

2. **Order Summary**
   - Display cart contents
   - Show shipping costs
   - Calculate totals
   - Create order events

3. **Payment Processing**
   - Generate invoices for each seller
   - Handle V4V payments
   - Process Lightning payments
   - Track payment status

4. **Order Completion**
   - Show order confirmation
   - Clear cart
   - Navigate to orders page

#### Order Creation Process
```typescript
// Creates separate orders for each seller
publishOrderWithDependencies({
  shippingData,
  sellers,
  productsBySeller,
  sellerData,
  v4vShares
})
```

---

## Payment Processing Flows

### 1. Lightning Payment Methods

#### NWC (Nostr Wallet Connect)
```
Payment Dialog → NWC Button → Connect Wallet → Pay Invoice → Confirm Payment
```

**Components**: `LightningPaymentProcessor.tsx`
**Actions**: `handleNwcPayment()`
**Flow**: Connect to NWC service → Pay invoice → Wait for confirmation

#### WebLN (Browser Extension)
```
Payment Dialog → WebLN Button → Extension Payment → Immediate Confirmation
```

**Actions**: `handleWeblnPayment()`
**Flow**: Use browser extension → Pay invoice → Get preimage immediately

#### QR Code Payment
```
Payment Dialog → Display QR → User Scans → External Payment → Manual Preimage Entry
```

**Actions**: `handleManualVerification()`
**Flow**: Show QR code → User pays externally → Enter preimage manually

### 2. Multi-Invoice Payment Flow

#### Sequential Payment Processing
```
Checkout → Generate Invoices → Process Invoice 1 → Complete → Process Invoice 2 → Complete → All Done
```

**Components**: `PaymentContent.tsx`
**State**: `currentInvoiceIndex`, `invoices[]`
**Actions**: Auto-advance to next invoice after payment completion

#### Bulk NWC Payment
```
Payment Dialog → "Pay All with NWC" → Process All Invoices → Show Progress → Complete
```

**Flow**: Process all pending invoices sequentially with 1-second delays

### 3. Payment Types

#### Merchant Payments
- Direct payment to seller's Lightning address
- Immediate confirmation via WebLN/NWC
- Manual verification for QR payments

#### V4V (Value for Value) Payments
- Zap-based payments to community members
- Requires zap receipt monitoring
- 90-second timeout for receipt detection

#### On-Chain Payments
- Bitcoin address payments
- Manual verification required
- 30-minute expiry by default

### 4. Payment Verification

#### Lightning Payment Verification
```typescript
// For regular invoices
const result = await wallet.lnPay({ pr: invoice })
handlePaymentSuccess('nwc-payment-preimage')

// For zaps
const zapper = new NDKZapper(recipient, amount, 'msat')
await zapper.zap()
// Wait for zap receipt event
```

#### Payment Receipt Monitoring
- Subscribe to zap receipt events
- Filter by bolt11 invoice
- Handle timeout scenarios
- Clean up subscriptions

---

## Order Management & Communication Flows

### 1. Order Lifecycle

#### Order States
```
PENDING → CONFIRMED → PROCESSING → SHIPPED → COMPLETED
         ↘ CANCELLED
```

**Components**: `OrderDetailComponent.tsx`, `OrderActions.tsx`
**Store**: Order status managed via Nostr events

#### Order Status Transitions
- **PENDING**: Initial order creation
- **CONFIRMED**: Seller accepts order
- **PROCESSING**: Seller preparing order
- **SHIPPED**: Order sent with tracking
- **COMPLETED**: Buyer confirms receipt
- **CANCELLED**: Order cancelled by either party

### 2. Order Communication System

#### Message Types (Nostr Events)
- **Kind 14**: General communication
- **Kind 16**: Order processing messages
  - Type 1: Order creation
  - Type 2: Payment requests
  - Type 3: Status updates
  - Type 4: Shipping updates
- **Kind 17**: Payment receipts

#### Communication Flow
```
Buyer/Seller → Message Input → Encrypted DM → Nostr Relay → Recipient Notification
```

**Components**: `MessageInput.tsx`, `ChatMessageBubble.tsx`
**Queries**: `useConversationMessages()`, `sendChatMessage()`

### 3. Order Actions by Role

#### Buyer Actions
- **PENDING**: Cancel order
- **SHIPPED**: Confirm receipt (complete order)
- **Any Status**: Send messages

#### Seller Actions
- **PENDING**: Confirm or cancel order
- **CONFIRMED**: Process order (move to processing)
- **PROCESSING**: Ship order (add tracking info)
- **Any Status**: Send messages, update status

### 4. Shipping Updates

#### Shipping Status Flow
```
Seller → Ship Order → Add Tracking → Shipping Update Event → Buyer Notification
```

**Components**: `OrderActions.tsx`
**Actions**: `updateOrderStatus()` with shipping details
**Tags**: `tracking`, `carrier`, `eta`, `status`

---

## V4V (Value for Value) System

### 1. V4V Configuration

#### Setup Flow
```
Dashboard → Profile → V4V Setup → Configure Recipients → Set Percentages → Save
```

**Components**: `V4VSetupDialog.tsx`, `V4VManager.tsx`
**Store**: V4V shares stored as Nostr events (Kind 30078)

#### V4V Manager Features
- Add/remove recipients by npub
- Set percentage allocations
- Validate zap capability
- Preview seller vs V4V split

### 2. V4V Data Structure
```json
{
  "kind": 30078,
  "content": "[{\"zap\": \"recipient_pubkey\", \"percentage\": 0.1}]",
  "tags": [
    ["d", "uuid"],
    ["l", "v4v_share"]
  ]
}
```

### 3. V4V in Checkout Process

#### Payment Calculation
```
Order Total → Calculate V4V Share → Generate V4V Invoices → Process Payments
```

**Components**: `publishOrderWithDependencies()`
**Flow**: 
1. Calculate V4V percentage of order total
2. Generate separate invoices for each V4V recipient
3. Process V4V payments alongside merchant payments

#### V4V Recipients
- Platform/app developers
- Content creators
- Community contributors
- Infrastructure providers

---

## Dashboard Navigation

### 1. Dashboard Structure

#### Main Sections
```
Dashboard
├── SALES
│   ├── Sales (orders)
│   ├── Messages (communications)
│   └── Circular Economy
├── PRODUCTS
│   ├── Products (manage listings)
│   ├── Collections (group products)
│   ├── Receive Payments (wallet setup)
│   └── Shipping Options
├── ACCOUNT
│   ├── Profile (user info)
│   ├── Make Payments (wallet management)
│   ├── Your Purchases (order history)
│   └── Network (Nostr connections)
└── APP SETTINGS (Admin Only)
    ├── App Miscellaneous
    ├── Team Management
    ├── Blacklists
    └── Featured Items
```

### 2. Navigation Flow
```
Dashboard → Section → Sub-section → Action → Result
```

**Components**: `DashboardLayout.tsx`, `DashboardListItem.tsx`
**Routing**: File-based routing with `_dashboard-layout.tsx`

### 3. Mobile Navigation
```
Mobile → Hamburger Menu → Section List → Sub-section → Content
```

**Components**: `MobileMenu.tsx`
**Behavior**: Sidebar collapses on mobile, shows full-screen content

---

## Admin Functions

### 1. Admin Access Control

#### Admin Verification
```
User Login → Check Admin Status → Grant/Deny Access → Filter Navigation
```

**Components**: `useAmIAdmin()` hook
**Protection**: Route-level admin checks in `__root.tsx`

### 2. Admin Features

#### Blacklist Management
```
Admin → Blacklists → Add/Remove Users/Products → Update Blacklist Events
```

**Components**: `BlacklistsComponent.tsx`
**Actions**: Add/remove from blacklist via Nostr events

#### Featured Items
```
Admin → Featured Items → Select Products → Set Featured Status → Update Events
```

**Components**: `FeaturedItemsComponent.tsx`
**Actions**: Toggle featured status for products/collections

#### Team Management
```
Admin → Team → Add/Remove Team Members → Update Permissions
```

**Components**: Team management interface
**Actions**: Manage admin permissions and team access

### 3. App Settings

#### App Configuration
```
Admin → App Miscellaneous → Configure Settings → Update App Config
```

**Components**: App settings interface
**Actions**: Update app-wide configuration and settings

---

## Key Interaction Patterns

### 1. Nostr Event Flow
```
User Action → Form Validation → Create NDK Event → Sign Event → Publish to Relays → Update UI
```

### 2. State Management Pattern
```
User Interaction → Store Action → State Update → UI Re-render → Persist to Storage
```

### 3. Error Handling Pattern
```
Action → Try/Catch → Error State → User Notification → Retry Option
```

### 4. Loading States
```
Action Triggered → Loading State → Background Processing → Success/Error → Update UI
```

---

## Technical Implementation Details

### 1. Nostr Event Kinds Used
- **30402**: Product listings
- **30405**: Product collections
- **30406**: Shipping options
- **30407**: Order events
- **30408**: Payment requests
- **30078**: V4V shares
- **14**: Direct messages
- **16**: Order processing messages
- **17**: Payment receipts

### 2. Key Components Architecture
```
Page Components → Feature Components → UI Components → Store Actions → Nostr Events
```

### 3. Data Flow
```
Nostr Relays → NDK → TanStack Query → React Components → User Interface
```

### 4. Payment Integration
```
Lightning Network → NWC/WebLN → NDK → Payment Processors → Order Completion
```

---

This comprehensive analysis covers all major interaction paths and flows in the Plebian Market application. Each flow is designed to work seamlessly with the Nostr protocol while providing a modern, responsive user experience.
