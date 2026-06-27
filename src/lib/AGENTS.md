# src/lib/ Directory Design Decisions Overview

## Library Architecture

### Core Purpose
1. **Shared Utilities** - Common functions and helpers used across the application
2. **State Management** - Client-side state stores using TanStack Store
3. **Nostr Integration** - Core Nostr protocol integration and event handling
4. **Application Constants** - Configuration values and system constants
5. **Data Schemas** - Zod schemas for data validation and type inference
6. **Business Logic** - Core marketplace domain logic and workflows

### Technology Stack
1. **TanStack Store** - Client state management library
2. **Nostr Development Kit (NDK)** - Nostr protocol implementation
3. **Zod** - Schema validation and type inference
4. **TypeScript** - Strong typing throughout the codebase
5. **Tailwind CSS** - Utility-first styling helpers

### Library Organization
1. **Stores** - State management modules for different domain areas
2. **Utilities** - Helper functions and common utilities
3. **Constants** - Configuration values and system constants
4. **Schemas** - Data validation schemas and types
5. **Nostr** - Nostr-specific utilities and helpers
6. **Types** - Shared TypeScript type definitions

## Design Patterns

### State Management
1. **Store Pattern** - Centralized state management with TanStack Store
2. **Action Pattern** - State mutation functions with clear side effects
3. **Hook Pattern** - React hook abstractions for store consumption
4. **Persistence Pattern** - LocalStorage integration for state persistence
5. **Authentication Pattern** - Multi-method authentication state management

### Nostr Integration
1. **NDK Abstraction** - Wrapper around Nostr Development Kit
2. **Relay Management** - Multi-relay connection and write strategies
3. **Event Publishing** - Stage-aware event publishing restrictions
4. **Zap Monitoring** - Lightning payment receipt monitoring
5. **Signer Management** - Multiple authentication method support

### Data Validation
1. **Zod Schemas** - Runtime schema validation and type inference
2. **Query Key Factories** - Consistent TanStack Query key generation
3. **Data Transformation** - Structured data extraction from Nostr events
4. **Input Validation** - Client-side input validation utilities
5. **Error Handling** - Consistent error handling patterns

## Contradictory Design Decisions

1. **State Management**:
   - TanStack Store for client state
   - BUT inconsistent persistence strategies across stores
   - Mixed use of localStorage and custom persistence
   - No centralized state management patterns

2. **Nostr Integration**:
   - NDK wrapper for Nostr protocol
   - BUT complex relay management logic
   - Mixed staging/production relay strategies
   - Inconsistent signer management approaches

3. **Data Validation**:
   - Zod schemas for validation
   - BUT mixed validation at component vs query levels
   - Inconsistent error handling patterns
   - No centralized schema validation strategy

4. **Authentication**:
   - Multi-method authentication support
   - BUT complex localStorage state management
   - Mixed migration and backward compatibility strategies
   - No clear authentication state lifecycle

## Code Reuse Opportunities

1. **Common Utilities**:
   - Text truncation and formatting utilities
   - Color generation and fingerprint utilities
   - Validation and sanitization functions
   - Clipboard and image utilities

2. **State Management Patterns**:
   - Store initialization and persistence patterns
   - Action function patterns
   - Hook abstraction patterns
   - State synchronization utilities

3. **Nostr Integration Utilities**:
   - Relay connection management
   - Event publishing utilities
   - Zap monitoring utilities
   - Signer management utilities

4. **Data Validation Utilities**:
   - Schema validation helpers
   - Query key factory patterns
   - Data transformation utilities
   - Error handling utilities

## Test Coverage Gaps

1. **Store Testing**:
   - No unit tests for store logic
   - No persistence validation testing
   - No state transition testing
   - No error handling validation

2. **Utility Testing**:
   - Limited utility function testing
   - No edge case validation
   - No performance testing
   - No security testing

3. **Nostr Integration Testing**:
   - No NDK integration testing
   - No relay management testing
   - No event publishing validation
   - No zap monitoring testing

4. **Data Validation Testing**:
   - No schema validation testing
   - No input sanitization testing
   - No error handling validation
   - No migration scenario testing

## Security Issues

1. **Credential Management**:
   - Private keys in localStorage
   - No secure credential storage
   - No key rotation strategies
   - No encryption at rest for sensitive data

2. **State Persistence**:
   - Sensitive data in localStorage
   - No secure storage mechanisms
   - No data encryption for persistence
   - No secure state synchronization

3. **Input Validation**:
   - Client-side validation only
   - No server-side validation
   - No malicious input sanitization
   - No injection attack prevention

4. **Authentication Security**:
   - Complex authentication state management
   - No secure session management
   - No authentication bypass prevention
   - No privilege escalation protection

## Performance Considerations

1. **State Management**:
   - No state size optimization
   - No efficient persistence strategies
   - No memory usage monitoring
   - No state cleanup mechanisms

2. **Nostr Integration**:
   - No connection pooling
   - No efficient relay management
   - No background synchronization
   - No request deduplication

3. **Data Validation**:
   - No validation optimization
   - No caching of validated data
   - No batched validation patterns
   - No schema compilation optimization

4. **Utility Functions**:
   - No performance profiling
   - No efficient algorithm usage
   - No caching of expensive operations
   - No lazy evaluation patterns

## Maintenance Issues

1. **Code Documentation**:
   - Limited inline documentation
   - No API documentation
   - No usage examples
   - No architecture documentation

2. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements
   - No automated code quality checks
   - No code complexity monitoring

3. **Version Control**:
   - No versioning strategy
   - No migration management
   - No changelog for library changes
   - No backward compatibility tracking

4. **Library Organization**:
   - Inconsistent file organization
   - No clear categorization strategy
   - Mixed utility and business logic
   - No standardized interfaces

## Dependency Management Issues

1. **Library Dependencies**:
   - No dependency version management
   - No peer dependency tracking
   - No bundle size impact monitoring
   - No security vulnerability scanning

2. **External Integration**:
   - No clear integration boundaries
   - Mixed direct and wrapper usage
   - No abstraction layers for external services
   - No fallback and error handling patterns

3. **Type Safety**:
   - Inconsistent type usage
   - No type safety enforcement
   - Mixed type inference and explicit typing
   - No type compatibility checking

4. **Configuration Management**:
   - No centralized configuration
   - No environment-specific configurations
   - No configuration validation
   - No dynamic configuration updates