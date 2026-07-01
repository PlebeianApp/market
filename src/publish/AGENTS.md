# src/publish/ Directory Design Decisions Overview

## Governance

- **Class:** human-only
- **Sensitive Surface:** Write-side event construction + signing for all marketplace entities; bypasses NDK validation per inconsistency #8

## Publishing Architecture

### Core Purpose

1. **Event Publishing** - Nostr event creation and signing for marketplace operations
2. **Data Validation** - Input validation and sanitization before event creation
3. **Mutation Management** - TanStack Query mutation hooks for state management
4. **Cache Invalidation** - Query cache management after successful operations

### Technology Stack

1. **Nostr Development Kit (NDK)** - Core Nostr protocol implementation
2. **TanStack Query** - Server state management and mutation handling
3. **TypeScript** - Strong typing for event creation and validation
4. **React Hooks** - Integration with React component lifecycle

### Publishing Categories

1. **Product Operations** - Product creation, update, and deletion
2. **Collection Management** - Collection creation and management
3. **Order Processing** - Order creation and status updates
4. **Payment Handling** - Payment request and receipt processing
5. **User Management** - Profile updates and settings management
6. **Configuration** - App settings and feature management
7. **Social Features** - Comments, reactions, and sharing functionality

## Design Patterns

### Event Creation Patterns

1. **Structured Event Building** - Consistent Nostr event construction
2. **Tag Management** - Standardized tag creation and formatting
3. **Content Validation** - Pre-publishing data validation and sanitization
4. **Client Tag Integration** - NIP-89 client tag support for app attribution
5. **Coordinate Handling** - Proper a-tag and naddr reference management

### Mutation Patterns

1. **Hook-Based Mutations** - TanStack Query mutation hook abstraction
2. **Validation Integration** - Input validation before mutation execution
3. **Success Handling** - Cache invalidation and UI feedback on success
4. **Error Handling** - Proper error handling and user feedback
5. **Loading State Management** - Consistent loading state patterns

### Data Validation Patterns

1. **Form Data Validation** - Structured form data validation
2. **Schema Compliance** - Nostr event schema compliance checking
3. **Business Rule Validation** - Marketplace-specific business rules
4. **Input Sanitization** - Data cleaning and normalization
5. **Error Message Formatting** - User-friendly error messaging

## Known Design Inconsistencies with Parent AGENTS.md

These are acknowledged inconsistencies with the parent directory AGENTS.md design:

1. **Nostr Event Publishing Inconsistencies (#8)**: Despite the parent requirement that all Nostr event publishing must go through the NDK abstraction layer, several publish functions in this directory submit events through direct WebSocket interfaces via `submitAppSettings` utility function, bypassing proper NDK validation and signing.

2. **Architecture Boundary Violations (#7)**: Some publishing functions in this directory directly interface with WebSocket connections and server-side logic patterns rather than going through proper abstraction layers, violating the architectural boundaries.

3. **Credential Management Issues**: The publishing functions use direct signer usage in publish functions without proper secure credential handling, violating the parent's security constraints.

4. **Error Handling Inconsistencies (#10)**: Error handling in publishing mutations varies with mixed toast-based feedback and lacks the correlation ID tracking required for traceability.

## Contradictory Design Decisions

1. **Validation Strategy**:
   - Inline validation in publish functions
   - BUT inconsistent validation patterns across files
   - Mixed client-side vs server-side validation
   - No centralized validation framework

2. **Event Creation**:
   - Standardized event building patterns
   - BUT mixed tag construction approaches
   - Inconsistent coordinate handling
   - No unified event factory patterns

3. **Mutation Management**:
   - Hook-based mutation abstraction
   - BUT inconsistent success/error handling
   - Mixed cache invalidation strategies
   - No standardized mutation patterns

4. **Error Handling**:
   - Toast-based user feedback
   - BUT inconsistent error message formatting
   - Mixed silent vs explicit error handling
   - No centralized error management

## Code Reuse Opportunities

1. **Common Event Patterns**:
   - Standardized event creation utilities
   - Consistent tag building functions
   - Reusable coordinate handling utilities
   - Shared validation utilities

2. **Mutation Hook Patterns**:
   - Standardized mutation hook creation
   - Consistent success/error handling
   - Reusable cache invalidation utilities
   - Shared loading state management

3. **Validation Utilities**:
   - Common validation functions
   - Reusable schema validation utilities
   - Shared input sanitization functions
   - Standardized error handling

4. **Data Transformation**:
   - Consistent data mapping utilities
   - Reusable tag formatting functions
   - Shared coordinate parsing utilities
   - Standardized event building patterns

## Test Coverage Gaps

1. **Event Creation Testing**:
   - No unit tests for event creation functions
   - No tag construction validation
   - No coordinate handling testing
   - No schema compliance testing

2. **Validation Testing**:
   - No input validation testing
   - No business rule validation testing
   - No error handling validation
   - No edge case testing

3. **Mutation Testing**:
   - No mutation hook testing
   - No success handling validation
   - No error handling validation
   - No cache invalidation testing

4. **Integration Testing**:
   - No end-to-end publishing testing
   - No relay interaction validation
   - No event signing validation
   - No multi-relay publishing testing

## Security Issues

1. **Data Validation**:
   - Client-side only validation
   - No input sanitization for malicious content
   - No schema enforcement for published events
   - No injection attack prevention

2. **Event Publishing**:
   - Direct event signing and publishing
   - No event review or approval workflows
   - No spam or abuse prevention
   - No content moderation integration

3. **Credential Management**:
   - Direct signer usage in publish functions
   - No secure credential handling
   - No key rotation strategies
   - No signing key management

4. **Access Control**:
   - Client-side permission checking only
   - No server-side authorization validation
   - No privilege escalation prevention
   - No authentication bypass prevention

## Performance Considerations

1. **Event Creation**:
   - No performance optimization for event building
   - No efficient tag construction
   - No batched event creation
   - No caching of expensive operations

2. **Validation Performance**:
   - No validation optimization
   - No efficient validation patterns
   - No asynchronous validation handling
   - No validation result caching

3. **Mutation Efficiency**:
   - No mutation batching
   - No efficient cache invalidation
   - No optimistic updates
   - No background processing patterns

4. **Network Efficiency**:
   - No connection pooling
   - No relay selection optimization
   - No bandwidth usage optimization
   - No request deduplication

## Maintenance Issues

1. **Publishing Documentation**:
   - Limited inline documentation
   - No API documentation
   - No usage examples
   - No error handling documentation

2. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements
   - No automated code quality checks
   - No publishing complexity monitoring

3. **Version Control**:
   - No versioning strategy
   - No breaking change tracking
   - No migration management
   - No changelog for publishing changes

4. **Publishing Organization**:
   - Inconsistent file organization
   - No clear categorization strategy
   - Mixed utility and business logic
   - No standardized interfaces

## Publishing Specific Issues

1. **Event Structure**:
   - Complex tag construction logic
   - BUT inconsistent tag formatting approaches
   - Mixed optional and required tag handling
   - No standardized event templates

2. **Coordinate Management**:
   - Complex a-tag and naddr handling
   - BUT inconsistent coordinate parsing
   - Mixed reference creation patterns
   - No unified coordinate utilities

3. **Validation Logic**:
   - Inline validation in publish functions
   - BUT inconsistent validation patterns
   - Mixed client-side validation only
   - No centralized validation framework

4. **Cache Management**:
   - Manual cache invalidation in mutations
   - BUT inconsistent invalidation patterns
   - Mixed granular vs broad invalidation
   - No automated cache management
