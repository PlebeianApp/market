# Plebeian Market - Feature Roadmap

This roadmap outlines the planned features, improvements, and priorities for Plebeian Market based on community feedback, current issues, and strategic direction.

**Last Updated**: 2025-11-20

---

## Table of Contents

1. [Current Status](#current-status)
2. [Immediate Priorities (MVP)](#immediate-priorities-mvp)
3. [Short-term (Q1 2025)](#short-term-q1-2025)
4. [Medium-term (Q2-Q3 2025)](#medium-term-q2-q3-2025)
5. [Long-term (Q4 2025+)](#long-term-q4-2025)
6. [Technical Debt](#technical-debt)
7. [Research & Exploration](#research--exploration)

---

## Current Status

### ✅ Completed Features

- React 19 + TanStack Router + TanStack Query architecture
- Nostr-based data storage with NDK
- User authentication (NIP-07, private key, Nostr Connect)
- Product creation and management
- Product collections
- Shopping cart functionality
- Lightning Network payments (NWC)
- Shipping options configuration
- Value-for-value (V4V) payment splits
- Buyer-seller messaging
- Order management
- Wallet setup and onboarding (#255)
- Profile wallet configuration verification
- Multi-wallet support

### 🚧 In Progress

- Product reviews (#43) - Figma designs ready
- NIP-15 → NIP-99 migration (#134) - Marked RFR but needs specification

### 📊 Current Metrics

- **Total Open Issues**: 17
- **Unassigned Issues**: 9
- **Critical (MVP) Issues**: 1
- **Beta Tester Feedback**: 3 issues

---

## Immediate Priorities (MVP)

These issues are critical for a production-ready marketplace and should be addressed first.

### High Priority Bugs 🐛

#### #238: Buttons are blank until mouse hover

**Severity**: High (MVP label)
**Complexity**: Low
**Effort**: 2-4 hours

**Issue**: Button text appears invisible until hover, likely black-on-black contrast issue.

**Impact**: Poor UX, confusing for new users.

**Action Items**:

- [ ] Identify affected button components
- [ ] Fix CSS color contrast
- [ ] Verify accessibility (WCAG AA compliance)
- [ ] Test across themes (light/dark)

---

#### #246: Product doesn't show in view product carousel

**Severity**: Medium
**Complexity**: Low-Medium
**Effort**: 1-2 days
**Status**: RFR (Ready For Review)

**Issue**: Clicked product doesn't display information in carousel.

**Impact**: Prevents users from viewing product details.

**Action Items**:

- [ ] Verify if already fixed in master
- [ ] Debug carousel state management
- [ ] Test with various product types
- [ ] Add E2E test to prevent regression

---

## Short-term (Q1 2025)

Features that provide immediate value and are well-specified.

### #43: Product Reviews ⭐⭐⭐⭐⭐

**Priority**: High
**Complexity**: High
**Effort**: 3-4 weeks
**Status**: Well-specified with Figma designs

**Description**: Multi-category product rating and review system.

**Features**:

- Category-based ratings (all mandatory)
- Optional comments
- Average ratings display
- Review aggregation
- Desktop and mobile UI

**Designs**:

- [Desktop Design](https://www.figma.com/design/re69Ae2WVk5yKdaGxCbnb5/Plebeian?node-id=5795-26999)
- [Mobile Design](https://www.figma.com/design/re69Ae2WVk5yKdaGxCbnb5/Plebeian?node-id=5479-13574)

**Action Items**:

- [ ] Design Nostr event structure for reviews (NIP-32 or custom)
- [ ] Implement review submission form
- [ ] Create review display components
- [ ] Build review aggregation logic
- [ ] Add spam prevention
- [ ] Verify only buyers can review (if possible)
- [ ] Write E2E tests

**Challenges**:

- Ensuring review authenticity without centralized verification
- Preventing spam/bot reviews
- Efficient aggregation of large review sets

---

### #256: Images in Sales and Purchase Messages

**Priority**: Medium
**Complexity**: Medium
**Effort**: 1-2 weeks

**Description**: Enable image attachments in buyer-seller messages.

**Needs Clarification**:

- [ ] Supported image formats (JPEG, PNG, WebP?)
- [ ] Maximum file size
- [ ] Storage solution (Blossom, NIP-96, or both?)
- [ ] Compression/optimization strategy
- [ ] Security (malicious files, NSFW filtering?)

**Action Items**:

- [ ] Gather requirements from stakeholders
- [ ] Choose image hosting solution
- [ ] Implement file upload UI
- [ ] Add image display in messages
- [ ] Handle image compression
- [ ] Test on mobile networks (data usage)

---

### #237: V4V Settings for Each Product

**Priority**: Medium
**Complexity**: Medium-High
**Effort**: 1-2 weeks

**Description**: Allow per-product V4V configuration instead of only global.

**Needs Clarification**:

- [ ] Should product V4V override or complement global V4V?
- [ ] Which V4V parameters are configurable per product?
- [ ] Use cases (promotional campaigns, charity splits)?

**Action Items**:

- [ ] Define product-level V4V data model
- [ ] Extend product creation UI
- [ ] Implement V4V precedence logic
- [ ] Update payment processing to use product V4V
- [ ] Test split calculations

---

## Medium-term (Q2-Q3 2025)

Features requiring more design and development effort.

### #86: On-chain Payment Support 🔗

**Priority**: High
**Complexity**: Very High
**Effort**: 3-4 weeks

**Description**: Allow buyers to pay with on-chain Bitcoin when seller provides xpub.

**Features**:

- xpub storage and address derivation (BIP32/BIP44)
- On-chain transaction monitoring
- Confirmation tracking
- Fee estimation
- Payment timeout handling
- Integration with existing order flow

**Challenges**:

- **Security**: Proper xpub handling, no private key exposure
- **Privacy**: Bitcoin addresses are traceable
- **Legal**: Avoid custody to prevent money transmitter licensing
- **UX**: Managing slow confirmations vs Lightning's instant payments
- **Technical**: Reliable tx monitoring, handling reorgs

**Reference**: Legacy Svelte implementation available for reference.

**Action Items**:

- [ ] Review legacy implementation
- [ ] Design on-chain payment flow
- [ ] Implement xpub management
- [ ] Build address derivation logic
- [ ] Add transaction monitoring service
- [ ] Create payment UI (QR code, address display)
- [ ] Handle edge cases (underpayment, overpayment, double-spends)
- [ ] Legal review

---

### #134: NIP-15 → NIP-99 Migration Tool

**Priority**: Medium
**Complexity**: Medium-High
**Effort**: 2-3 weeks
**Status**: RFR but no description provided

**Description**: Migrate deprecated NIP-15 product listings to NIP-99 classified listings.

**URGENT**: Needs detailed specification!

**Required Information**:

- [ ] NIP-15 event structure (if used)
- [ ] NIP-99 event structure
- [ ] Data mapping strategy
- [ ] Migration approach (bulk, gradual, manual?)
- [ ] Rollback plan
- [ ] User communication strategy

**Action Items**:

- [ ] Document current NIP-15 usage (if any)
- [ ] Research NIP-99 requirements
- [ ] Create migration specification
- [ ] Build migration tool (CLI or admin UI)
- [ ] Test with production-like data
- [ ] Create migration runbook

---

### #174: Create PM Wallets for Different Incomes

**Priority**: Low
**Complexity**: Medium
**Effort**: 1 week
**Type**: Infrastructure

**Description**: Set up multiple Lightning wallets for different income streams:

- `plebeian.services@example.com`: Future services (ContextVM)
- `plebeian.contributions@example.com`: V4V share recipient
- `plebeian@example.com`: Profile LUD16 for zaps

**Action Items**:

- [ ] Choose wallet provider(s) (Alby, LNBits, etc.)
- [ ] Set up Lightning addresses
- [ ] Configure payment routing
- [ ] Document wallet management procedures
- [ ] Set up backup/recovery processes
- [ ] Update profile and configuration

**Note**: This is project infrastructure, not a user-facing feature.

---

## Long-term (Q4 2025+)

Major features requiring extensive design and development.

### #179: Maps - Business Locations 🗺️

**Priority**: Low
**Complexity**: Very High
**Effort**: 4-6 weeks

**Description**: OpenStreetMap integration showing physical business locations with reviews.

**Needs Extensive Requirements Gathering**:

- [ ] User research: Do users want this feature?
- [ ] Privacy implications: How much location data to expose?
- [ ] Geocoding solution
- [ ] Map UI/UX design
- [ ] Mobile considerations
- [ ] International address handling

**Features (Proposed)**:

- OSM map integration
- Business location markers
- Geocoding addresses → coordinates
- Location-based search/filtering
- Review integration with map
- Privacy controls (show approximate location?)

**Challenges**:

- OSM API integration and tile server setup
- Performance with large marker sets
- Privacy concerns
- Mobile data usage
- Internationalization

**Action Items**:

- [ ] Conduct user research
- [ ] Create detailed requirements document
- [ ] Design UI/UX mockups
- [ ] Prototype map integration
- [ ] Security and privacy review

**Recommendation**: Defer until core marketplace features are stable and user demand is validated.

---

## Technical Debt

### Code Quality

#### NIP-44 Encryption Migration

**Priority**: Medium
**Effort**: 2 weeks

**Description**: Migrate from deprecated NIP-04 to NIP-44 encryption.

**Action Items**:

- [ ] Implement NIP-44 encryption helpers
- [ ] Create migration path for existing encrypted data
- [ ] Update all encryption/decryption code
- [ ] Test thoroughly
- [ ] Deploy with backward compatibility

---

#### Type Safety Improvements

**Priority**: Low
**Effort**: Ongoing

**Action Items**:

- [ ] Remove remaining `any` types
- [ ] Add stricter TypeScript rules
- [ ] Improve error type definitions
- [ ] Better event type definitions

---

#### Test Coverage

**Priority**: Medium
**Effort**: Ongoing

**Action Items**:

- [ ] Add E2E tests for critical paths
- [ ] Test cart functionality
- [ ] Test checkout flow
- [ ] Test payment processing
- [ ] Test order management

---

### Performance Optimization

#### Bundle Size Optimization

**Priority**: Low
**Effort**: 1 week

**Action Items**:

- [ ] Analyze bundle size with tools
- [ ] Implement lazy loading for heavy components
- [ ] Tree-shake unused dependencies
- [ ] Optimize image assets

---

#### Query Optimization

**Priority**: Medium
**Effort**: Ongoing

**Action Items**:

- [ ] Review slow queries
- [ ] Implement better caching strategies
- [ ] Optimize subscription filters
- [ ] Reduce unnecessary refetches

---

## Research & Exploration

### Progressive Web App (PWA)

**Timeline**: Q2 2025

**Goals**:

- Offline-first capability
- App installation
- Push notifications (if possible with Nostr)
- Background sync

---

### Cashu Integration

**Timeline**: Q3 2025

**Goals**:

- Support Cashu (ecash) payments
- Privacy-preserving payments
- Instant settlement

---

### NIP-65 Outbox Model

**Timeline**: Q2 2025

**Goals**:

- Better event discovery
- Improved relay strategy
- Reduced relay load

---

### WebRTC Messaging

**Timeline**: Q4 2025

**Goals**:

- Peer-to-peer messaging
- Video/voice calls for high-value transactions
- Reduced relay dependency

---

## Priority Matrix

```
                 │ Low Effort      │ Medium Effort     │ High Effort
─────────────────┼─────────────────┼──────────────────┼───────────────
High Impact      │ #238 (Buttons)  │ #256 (Images)     │ #43 (Reviews)
                 │                 │ #237 (V4V)        │ #86 (On-chain)
─────────────────┼─────────────────┼──────────────────┼───────────────
Medium Impact    │ #246 (Carousel) │ #134 (Migration)  │
                 │                 │ #174 (Wallets)    │
─────────────────┼─────────────────┼──────────────────┼───────────────
Low Impact       │                 │                   │ #179 (Maps)
```

---

## Suggested Development Order

### Phase 1: Bug Fixes (Week 1-2)

1. #238: Button styling ⚡
2. #246: Carousel display ⚡

### Phase 2: Core Features (Weeks 3-6)

3. #43: Product reviews ⭐
4. #256: Image messaging

### Phase 3: Payment Expansion (Weeks 7-10)

5. #237: Per-product V4V
6. #86: On-chain payments

### Phase 4: Infrastructure (Weeks 11-12)

7. #134: NIP-15 → NIP-99 migration
8. #174: Wallet setup

### Phase 5: Future Exploration (Q2+)

9. #179: Maps (deferred, needs validation)

---

## Community Involvement

### How to Influence the Roadmap

- **Submit feature requests** with detailed use cases
- **Participate in discussions** on GitHub
- **Vote on priorities** (if voting system implemented)
- **Contribute code** for features you want

### Current Feedback Sources

- GitHub Issues
- Beta tester reports
- Nostr community feedback
- Direct user feedback

---

## Success Metrics

### MVP Launch Criteria

- [ ] Zero critical bugs
- [ ] Product reviews functional
- [ ] Payment flows working (Lightning + on-chain)
- [ ] Mobile-responsive
- [ ] E2E test coverage >70%
- [ ] Documentation complete

### Post-MVP Metrics

- Active sellers
- Total products listed
- Successful transactions
- User retention rate
- Average order value
- Review participation rate

---

## Contributing to the Roadmap

Have ideas for the roadmap? Here's how to contribute:

1. **Review existing issues** to avoid duplicates
2. **Create detailed feature request** with:
   - Problem statement
   - Proposed solution
   - Use cases
   - Mockups/designs (if applicable)
3. **Participate in discussions** on prioritization
4. **Volunteer to implement** features you care about

---

**This roadmap is a living document and will be updated regularly based on community feedback, technical discoveries, and strategic priorities.**

---

**Last Updated**: 2025-11-20
**Next Review**: 2025-12-20
**Maintained By**: Plebeian Market Team
