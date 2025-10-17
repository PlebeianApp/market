# Plebian Market - Testing Checklist

## Overview

This document provides a comprehensive testing checklist for all interaction flows in the Plebian Market web application. Each section corresponds to the flows described in the `INTERACTION_FLOWS.md` document.

---

## Application Architecture Testing

### Core Technologies
- [ ] React 19 with TypeScript compiles without errors
- [ ] TanStack Router file-based routing works correctly
- [ ] TanStack Store state management functions properly
- [ ] TanStack Query data fetching works as expected
- [ ] TanStack Form with Zod validation functions correctly
- [ ] Radix UI + Tailwind CSS styling renders properly
- [ ] NDK (Nostr Development Kit) connects to relays
- [ ] Lightning Network payment integration works

### Key Stores
- [ ] `authStore` manages authentication state correctly
- [ ] `cartStore` manages shopping cart state properly
- [ ] `ndkStore` manages Nostr connections effectively
- [ ] `uiStore` manages UI state (drawers, dialogs) correctly
- [ ] `configStore` manages app configuration properly
- [ ] `walletStore` manages Lightning wallet state correctly

---

## Authentication Flows Testing

### 1. Login Methods

#### Private Key Login
- [ ] Login dialog opens when clicking login button
- [ ] Private key tab is accessible and functional
- [ ] User can enter nsec private key
- [ ] Password setting form appears after key entry
- [ ] Auto-login option can be enabled/disabled
- [ ] User is redirected to dashboard after successful login
- [ ] `PrivateKeyLogin.tsx` component renders correctly
- [ ] `DecryptPasswordDialog.tsx` appears when needed
- [ ] `loginWithPrivateKey()` action executes successfully
- [ ] `decryptAndLogin()` action works with stored encrypted keys

#### NIP-07 Extension Login
- [ ] Login dialog opens correctly
- [ ] Extension tab is accessible
- [ ] Browser extension detection works
- [ ] User can authorize through extension
- [ ] Dashboard redirects after successful authorization
- [ ] `LoginDialog.tsx` component functions properly
- [ ] `loginWithExtension()` action executes successfully

#### NIP-46 Bunker Connect
- [ ] Login dialog opens correctly
- [ ] Bunker tab is accessible
- [ ] User can enter Bunker URL
- [ ] Connection to Bunker service works
- [ ] Dashboard redirects after successful connection
- [ ] `BunkerConnect.tsx` component functions properly
- [ ] `loginWithNip46()` action executes successfully

### 2. Auto-Login Flow
- [ ] App checks localStorage on initialization
- [ ] Auto-login triggers when enabled
- [ ] Encrypted keys are decrypted correctly
- [ ] User is automatically logged in on page refresh
- [ ] Auto-login can be disabled
- [ ] localStorage stores authentication data correctly

### 3. Logout Flow
- [ ] Logout button is accessible
- [ ] localStorage is cleared on logout
- [ ] Cart is cleared on logout
- [ ] Auth state is reset properly
- [ ] User is redirected to home page
- [ ] `logout()` action executes successfully

---

## Product Management Flows Testing

### 1. Adding a New Product

#### Dashboard Flow
- [ ] Dashboard navigation to Products works
- [ ] "Add Product" button is accessible
- [ ] Product form opens correctly
- [ ] Form can be filled with product details
- [ ] Product is published successfully
- [ ] New product appears in product list
- [ ] Route `/dashboard/products/products/new` works
- [ ] `NewProductContent.tsx` component renders
- [ ] `ProductFormContent.tsx` component functions
- [ ] `productFormStore` manages form state
- [ ] `publishProduct()` action executes successfully

#### Product Form Steps
- [ ] **Basic Info**: Title, description, price, currency fields work
- [ ] **Images**: Image upload and ordering functions
- [ ] **Categories**: Main category and additional tags work
- [ ] **Specifications**: Key-value pairs can be added/removed
- [ ] **Shipping**: Shipping options can be selected with costs
- [ ] **Collection**: Optional collection assignment works
- [ ] **Weight/Dimensions**: Physical product details can be entered

#### Product Data Structure (Nostr Kind 30402)
- [ ] Product events are created with correct kind (30402)
- [ ] All required tags are included in the event
- [ ] Product data is properly structured
- [ ] Events are published to Nostr relays successfully

### 2. Editing Existing Product
- [ ] Product list displays existing products
- [ ] Edit button is accessible for each product
- [ ] Edit form is pre-filled with existing data
- [ ] Form can be updated with new information
- [ ] Product is updated successfully
- [ ] Updated product appears in the list
- [ ] Route `/dashboard/products/products/$productId` works
- [ ] `updateProduct()` action executes successfully

### 3. Product Visibility Management
- [ ] Product list shows visibility status
- [ ] Toggle visibility button works
- [ ] Products can be hidden/shown
- [ ] Nostr events are updated with visibility changes
- [ ] `toggleProductVisibility()` action executes successfully

### 4. Product Deletion
- [ ] Delete button is accessible for each product
- [ ] Confirmation dialog appears before deletion
- [ ] Product is deleted successfully
- [ ] Product is removed from the list
- [ ] `deleteProduct()` action executes successfully

---

## Collection Management Flows Testing

### 1. Creating a New Collection

#### Dashboard Flow
- [ ] Dashboard navigation to Collections works
- [ ] "Add Collection" button is accessible
- [ ] Collection form opens correctly
- [ ] Form can be filled with collection details
- [ ] Collection is published successfully
- [ ] New collection appears in collection list
- [ ] Route `/dashboard/products/collections/new` works
- [ ] `NewCollectionContent.tsx` component renders
- [ ] `CollectionFormContent.tsx` component functions
- [ ] `collectionFormStore` manages form state
- [ ] `publishCollection()` action executes successfully

#### Collection Form Steps
- [ ] **Basic Info**: Name, description, header image fields work
- [ ] **Products**: Products can be selected for inclusion
- [ ] **Shipping**: Collection-wide shipping options can be configured
- [ ] **Location**: Optional location and geohash can be set

#### Collection Data Structure (Nostr Kind 30405)
- [ ] Collection events are created with correct kind (30405)
- [ ] All required tags are included in the event
- [ ] Collection data is properly structured
- [ ] Events are published to Nostr relays successfully

### 2. Editing Collection
- [ ] Collection list displays existing collections
- [ ] Edit button is accessible for each collection
- [ ] Edit form is pre-filled with existing data
- [ ] Form can be updated with new information
- [ ] Collection is updated successfully
- [ ] Updated collection appears in the list
- [ ] Route `/dashboard/products/collections/$collectionId` works
- [ ] `updateCollection()` action executes successfully

### 3. Collection Product Management
- [ ] Collection form shows products tab
- [ ] Products can be selected/deselected with checkboxes
- [ ] Collection is updated when products are modified
- [ ] `ProductsTab.tsx` component functions correctly

---

## Shopping Cart & Checkout Flows Testing

### 1. Adding Items to Cart

#### Product Page Flow
- [ ] Product page displays "Add to Cart" button
- [ ] Items are added to cart successfully
- [ ] Cart store is updated correctly
- [ ] Cart drawer opens automatically
- [ ] `ProductCard.tsx` component functions
- [ ] `CartContent.tsx` component renders
- [ ] `cartActions.addProduct()` executes successfully
- [ ] `cartStore` manages cart state properly

#### Cart Data Structure
- [ ] Cart maintains proper data structure
- [ ] Products are stored correctly
- [ ] Sellers are grouped properly
- [ ] V4V shares are calculated correctly

### 2. Cart Management

#### Cart Drawer Operations
- [ ] Cart drawer opens and closes correctly
- [ ] Cart items are displayed properly
- [ ] Quantities can be modified
- [ ] Items can be removed from cart
- [ ] Shipping options can be selected
- [ ] Cart can be cleared completely
- [ ] Checkout button is accessible
- [ ] `CartContent.tsx` component functions
- [ ] `CartItem.tsx` component works
- [ ] `CartSummary.tsx` component displays totals
- [ ] `updateProductAmount()` action works
- [ ] `removeProduct()` action works
- [ ] `clear()` action works
- [ ] `updateShippingMethod()` action works

### 3. Checkout Process

#### Multi-Step Checkout Flow
- [ ] Checkout page is accessible from cart
- [ ] Multi-step process works correctly
- [ ] Progress indicator shows current step
- [ ] Navigation between steps works
- [ ] Route `/checkout` functions properly
- [ ] `CheckoutProgress.tsx` component works
- [ ] `ShippingAddressForm.tsx` component functions
- [ ] `PaymentContent.tsx` component works

#### Checkout Steps
- [ ] **Shipping Information**: Address form collects data correctly
- [ ] **Order Summary**: Cart contents and totals display properly
- [ ] **Payment Processing**: Invoices are generated correctly
- [ ] **Order Completion**: Confirmation is shown and cart is cleared

#### Order Creation Process
- [ ] Separate orders are created for each seller
- [ ] Order dependencies are handled correctly
- [ ] `publishOrderWithDependencies()` executes successfully

---

## Payment Processing Flows Testing

### 1. Lightning Payment Methods

#### NWC (Nostr Wallet Connect)
- [ ] Payment dialog displays NWC button
- [ ] Wallet connection process works
- [ ] Invoice payment executes successfully
- [ ] Payment confirmation is received
- [ ] `LightningPaymentProcessor.tsx` component functions
- [ ] `handleNwcPayment()` action works correctly

#### WebLN (Browser Extension)
- [ ] Payment dialog displays WebLN button
- [ ] Browser extension integration works
- [ ] Invoice payment executes successfully
- [ ] Immediate confirmation is received
- [ ] `handleWeblnPayment()` action works correctly

#### QR Code Payment
- [ ] Payment dialog displays QR code
- [ ] QR code is scannable and valid
- [ ] Manual preimage entry works
- [ ] Payment verification succeeds
- [ ] `handleManualVerification()` action works correctly

### 2. Multi-Invoice Payment Flow

#### Sequential Payment Processing
- [ ] Multiple invoices are generated correctly
- [ ] Sequential processing works
- [ ] Auto-advance to next invoice functions
- [ ] Progress tracking works
- [ ] `PaymentContent.tsx` component manages state
- [ ] `currentInvoiceIndex` and `invoices[]` state work

#### Bulk NWC Payment
- [ ] "Pay All with NWC" button is accessible
- [ ] All invoices are processed sequentially
- [ ] Progress indicator shows completion status
- [ ] 1-second delays between payments work

### 3. Payment Types

#### Merchant Payments
- [ ] Direct payments to seller addresses work
- [ ] Immediate confirmation via WebLN/NWC works
- [ ] Manual verification for QR payments works

#### V4V (Value for Value) Payments
- [ ] Zap-based payments to community members work
- [ ] Zap receipt monitoring functions
- [ ] 90-second timeout for receipt detection works

#### On-Chain Payments
- [ ] Bitcoin address payments work
- [ ] Manual verification is required and works
- [ ] 30-minute expiry functions correctly

### 4. Payment Verification

#### Lightning Payment Verification
- [ ] Regular invoice payments are verified correctly
- [ ] Zap payments are verified through receipt monitoring
- [ ] Payment success handlers execute properly

#### Payment Receipt Monitoring
- [ ] Zap receipt events are subscribed to correctly
- [ ] Filtering by bolt11 invoice works
- [ ] Timeout scenarios are handled properly
- [ ] Subscriptions are cleaned up correctly

---

## Order Management & Communication Flows Testing

### 1. Order Lifecycle

#### Order States
- [ ] Order states transition correctly: PENDING → CONFIRMED → PROCESSING → SHIPPED → COMPLETED
- [ ] Cancellation path works: PENDING → CANCELLED
- [ ] `OrderDetailComponent.tsx` displays order information
- [ ] `OrderActions.tsx` provides correct actions
- [ ] Order status is managed via Nostr events correctly

#### Order Status Transitions
- [ ] **PENDING**: Initial order creation works
- [ ] **CONFIRMED**: Seller can accept orders
- [ ] **PROCESSING**: Seller can move orders to processing
- [ ] **SHIPPED**: Seller can mark orders as shipped
- [ ] **COMPLETED**: Buyer can confirm receipt
- [ ] **CANCELLED**: Either party can cancel orders

### 2. Order Communication System

#### Message Types (Nostr Events)
- [ ] **Kind 14**: General communication works
- [ ] **Kind 16**: Order processing messages work
  - [ ] Type 1: Order creation messages
  - [ ] Type 2: Payment request messages
  - [ ] Type 3: Status update messages
  - [ ] Type 4: Shipping update messages
- [ ] **Kind 17**: Payment receipt messages work

#### Communication Flow
- [ ] Message input is accessible
- [ ] Encrypted DMs are sent successfully
- [ ] Messages are published to Nostr relays
- [ ] Recipients receive notifications
- [ ] `MessageInput.tsx` component functions
- [ ] `ChatMessageBubble.tsx` component displays messages
- [ ] `useConversationMessages()` query works
- [ ] `sendChatMessage()` function executes successfully

### 3. Order Actions by Role

#### Buyer Actions
- [ ] **PENDING**: Buyer can cancel orders
- [ ] **SHIPPED**: Buyer can confirm receipt (complete order)
- [ ] **Any Status**: Buyer can send messages

#### Seller Actions
- [ ] **PENDING**: Seller can confirm or cancel orders
- [ ] **CONFIRMED**: Seller can process orders (move to processing)
- [ ] **PROCESSING**: Seller can ship orders (add tracking info)
- [ ] **Any Status**: Seller can send messages and update status

### 4. Shipping Updates

#### Shipping Status Flow
- [ ] Seller can access ship order functionality
- [ ] Tracking information can be added
- [ ] Shipping update events are created
- [ ] Buyer receives notifications
- [ ] `OrderActions.tsx` component provides shipping actions
- [ ] `updateOrderStatus()` action works with shipping details
- [ ] Shipping tags (tracking, carrier, eta, status) are included

---

## V4V (Value for Value) System Testing

### 1. V4V Configuration

#### Setup Flow
- [ ] Dashboard navigation to Profile works
- [ ] V4V Setup option is accessible
- [ ] Recipients can be configured
- [ ] Percentages can be set
- [ ] Configuration is saved successfully
- [ ] `V4VSetupDialog.tsx` component functions
- [ ] `V4VManager.tsx` component works
- [ ] V4V shares are stored as Nostr events (Kind 30078)

#### V4V Manager Features
- [ ] Recipients can be added/removed by npub
- [ ] Percentage allocations can be set
- [ ] Zap capability is validated
- [ ] Seller vs V4V split is previewed correctly

### 2. V4V Data Structure
- [ ] V4V events are created with correct kind (30078)
- [ ] Event content is properly structured
- [ ] Required tags are included
- [ ] Events are published to Nostr relays successfully

### 3. V4V in Checkout Process

#### Payment Calculation
- [ ] V4V share is calculated from order total
- [ ] Separate invoices are generated for V4V recipients
- [ ] V4V payments are processed alongside merchant payments
- [ ] `publishOrderWithDependencies()` handles V4V correctly

#### V4V Recipients
- [ ] Platform/app developers receive payments
- [ ] Content creators receive payments
- [ ] Community contributors receive payments
- [ ] Infrastructure providers receive payments

---

## Dashboard Navigation Testing

### 1. Dashboard Structure

#### Main Sections
- [ ] **SALES** section is accessible
  - [ ] Sales (orders) sub-section works
  - [ ] Messages (communications) sub-section works
  - [ ] Circular Economy sub-section works
- [ ] **PRODUCTS** section is accessible
  - [ ] Products (manage listings) sub-section works
  - [ ] Collections (group products) sub-section works
  - [ ] Receive Payments (wallet setup) sub-section works
  - [ ] Shipping Options sub-section works
- [ ] **ACCOUNT** section is accessible
  - [ ] Profile (user info) sub-section works
  - [ ] Make Payments (wallet management) sub-section works
  - [ ] Your Purchases (order history) sub-section works
  - [ ] Network (Nostr connections) sub-section works
- [ ] **APP SETTINGS** section is accessible (Admin Only)
  - [ ] App Miscellaneous sub-section works
  - [ ] Team Management sub-section works
  - [ ] Blacklists sub-section works
  - [ ] Featured Items sub-section works

### 2. Navigation Flow
- [ ] Dashboard navigation works correctly
- [ ] Section navigation functions properly
- [ ] Sub-section navigation works
- [ ] Actions within sections execute successfully
- [ ] `DashboardLayout.tsx` component functions
- [ ] `DashboardListItem.tsx` component works
- [ ] File-based routing with `_dashboard-layout.tsx` works

### 3. Mobile Navigation
- [ ] Mobile hamburger menu is accessible
- [ ] Section list is displayed correctly
- [ ] Sub-section navigation works on mobile
- [ ] Content is displayed properly
- [ ] `MobileMenu.tsx` component functions
- [ ] Sidebar collapses on mobile correctly
- [ ] Full-screen content is shown on mobile

---

## Admin Functions Testing

### 1. Admin Access Control

#### Admin Verification
- [ ] User login works correctly
- [ ] Admin status is checked properly
- [ ] Access is granted/denied based on admin status
- [ ] Navigation is filtered for non-admins
- [ ] `useAmIAdmin()` hook functions correctly
- [ ] Route-level admin checks in `__root.tsx` work

### 2. Admin Features

#### Blacklist Management
- [ ] Admin can access blacklists section
- [ ] Users can be added/removed from blacklist
- [ ] Products can be added/removed from blacklist
- [ ] Blacklist events are updated correctly
- [ ] `BlacklistsComponent.tsx` component functions
- [ ] Add/remove from blacklist actions work

#### Featured Items
- [ ] Admin can access featured items section
- [ ] Products can be selected for featuring
- [ ] Featured status can be set/toggled
- [ ] Featured events are updated correctly
- [ ] `FeaturedItemsComponent.tsx` component functions
- [ ] Toggle featured status actions work

#### Team Management
- [ ] Admin can access team management
- [ ] Team members can be added/removed
- [ ] Permissions can be updated
- [ ] Team management interface functions correctly

### 3. App Settings

#### App Configuration
- [ ] Admin can access app miscellaneous settings
- [ ] App-wide configuration can be updated
- [ ] Settings are saved successfully
- [ ] App settings interface functions correctly

---

## Key Interaction Patterns Testing

### 1. Nostr Event Flow
- [ ] User actions trigger form validation
- [ ] NDK events are created correctly
- [ ] Events are signed properly
- [ ] Events are published to relays
- [ ] UI is updated after successful publication

### 2. State Management Pattern
- [ ] User interactions trigger store actions
- [ ] State updates occur correctly
- [ ] UI re-renders with new state
- [ ] State is persisted to storage

### 3. Error Handling Pattern
- [ ] Actions are wrapped in try/catch blocks
- [ ] Error states are managed properly
- [ ] User notifications are shown for errors
- [ ] Retry options are provided when appropriate

### 4. Loading States
- [ ] Loading states are triggered for actions
- [ ] Background processing is handled correctly
- [ ] Success/error states are managed
- [ ] UI is updated appropriately

---

## Technical Implementation Testing

### 1. Nostr Event Kinds Used
- [ ] **30402**: Product listings work correctly
- [ ] **30405**: Product collections work correctly
- [ ] **30406**: Shipping options work correctly
- [ ] **30407**: Order events work correctly
- [ ] **30408**: Payment requests work correctly
- [ ] **30078**: V4V shares work correctly
- [ ] **14**: Direct messages work correctly
- [ ] **16**: Order processing messages work correctly
- [ ] **17**: Payment receipts work correctly

### 2. Key Components Architecture
- [ ] Page components render correctly
- [ ] Feature components function properly
- [ ] UI components work as expected
- [ ] Store actions execute successfully
- [ ] Nostr events are created and published

### 3. Data Flow
- [ ] Nostr relays are connected properly
- [ ] NDK manages connections correctly
- [ ] TanStack Query fetches data successfully
- [ ] React components render with data
- [ ] User interface displays correctly

### 4. Payment Integration
- [ ] Lightning Network integration works
- [ ] NWC/WebLN connections function
- [ ] NDK handles payment processing
- [ ] Payment processors work correctly
- [ ] Order completion is handled properly

---

## Cross-Browser Testing

### Desktop Browsers
- [ ] Chrome (latest version)
- [ ] Firefox (latest version)
- [ ] Safari (latest version)
- [ ] Edge (latest version)

### Mobile Browsers
- [ ] Chrome Mobile
- [ ] Safari Mobile
- [ ] Firefox Mobile
- [ ] Samsung Internet

### Responsive Design
- [ ] Mobile view (320px - 768px)
- [ ] Tablet view (768px - 1024px)
- [ ] Desktop view (1024px+)

---

## Performance Testing

### Load Times
- [ ] Initial page load < 3 seconds
- [ ] Navigation between pages < 1 second
- [ ] Form submissions < 2 seconds
- [ ] Payment processing < 5 seconds

### Memory Usage
- [ ] No memory leaks in long sessions
- [ ] Proper cleanup of event listeners
- [ ] Efficient state management

### Network Efficiency
- [ ] Minimal API calls
- [ ] Efficient Nostr relay usage
- [ ] Proper caching strategies

---

## Security Testing

### Authentication
- [ ] Private keys are encrypted in localStorage
- [ ] Sessions expire appropriately
- [ ] Admin routes are protected
- [ ] CSRF protection is in place

### Data Validation
- [ ] All user inputs are validated
- [ ] Nostr events are properly signed
- [ ] Payment amounts are verified
- [ ] File uploads are restricted

### Privacy
- [ ] Encrypted messages work correctly
- [ ] User data is not exposed
- [ ] Payment information is secure
- [ ] Nostr relay connections are secure

---

## Accessibility Testing

### WCAG Compliance
- [ ] Keyboard navigation works
- [ ] Screen reader compatibility
- [ ] Color contrast meets standards
- [ ] Focus indicators are visible
- [ ] Alt text for images
- [ ] Form labels are associated correctly

### Usability
- [ ] Clear error messages
- [ ] Intuitive navigation
- [ ] Consistent UI patterns
- [ ] Helpful tooltips and hints

---

## Integration Testing

### Nostr Protocol
- [ ] Relay connections are stable
- [ ] Event publishing works reliably
- [ ] Event subscription works correctly
- [ ] Message encryption/decryption works

### Lightning Network
- [ ] Invoice generation works
- [ ] Payment processing is reliable
- [ ] Multiple wallet types work
- [ ] Payment verification is accurate

### Third-Party Services
- [ ] Image upload services work
- [ ] External payment processors work
- [ ] Analytics tracking works (if applicable)
- [ ] Error monitoring works (if applicable)

---

## Regression Testing

### Critical Paths
- [ ] User registration and login
- [ ] Product creation and management
- [ ] Shopping cart and checkout
- [ ] Payment processing
- [ ] Order management
- [ ] Communication system

### Edge Cases
- [ ] Network connectivity issues
- [ ] Payment failures
- [ ] Invalid user inputs
- [ ] Concurrent user actions
- [ ] Large data sets
- [ ] Timeout scenarios

---

## Test Environment Setup

### Prerequisites
- [ ] Test Nostr relays are configured
- [ ] Test Lightning Network nodes are available
- [ ] Test user accounts are created
- [ ] Test products and collections are seeded
- [ ] Test payment methods are configured

### Test Data
- [ ] Sample products with various configurations
- [ ] Test collections with different products
- [ ] Test users with different roles
- [ ] Test orders in various states
- [ ] Test payment scenarios

### Cleanup
- [ ] Test data is cleaned up after tests
- [ ] Test accounts are reset
- [ ] Test transactions are reversed
- [ ] Test events are removed from relays

---

## Test Execution Checklist

### Pre-Test
- [ ] Test environment is set up correctly
- [ ] All dependencies are installed
- [ ] Test data is prepared
- [ ] Test accounts are ready
- [ ] Test relays are accessible

### During Test
- [ ] Each test case is executed systematically
- [ ] Results are documented
- [ ] Issues are logged with details
- [ ] Screenshots are taken for failures
- [ ] Performance metrics are recorded

### Post-Test
- [ ] Test results are compiled
- [ ] Issues are prioritized
- [ ] Test environment is cleaned up
- [ ] Test report is generated
- [ ] Follow-up actions are planned

---

## Sign-off

### Test Completion
- [ ] All test cases have been executed
- [ ] All critical issues have been resolved
- [ ] Performance benchmarks are met
- [ ] Security requirements are satisfied
- [ ] Accessibility standards are met

### Approval
- [ ] QA Team Lead Approval: ________________
- [ ] Product Owner Approval: ________________
- [ ] Technical Lead Approval: ________________
- [ ] Date: ________________

---

*This testing checklist should be used as a comprehensive guide for testing all aspects of the Plebian Market application. Each checkbox should be verified and checked off as tests are completed.*
