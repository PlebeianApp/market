# src/queries/ Directory Design Decisions Overview

## Query Architecture

### Core Purpose
1. **Data Fetching Layer** - Abstraction over Nostr event fetching and caching
2. **Query Key Management** - Consistent caching and invalidation strategies
3. **React Query Integration** - TanStack Query hooks for server state management
4. **Data Transformation** - Extraction and parsing of structured data from Nostr events

### Technology Stack
1. **TanStack Query** - Server state management and caching
2. **Nostr Development Kit (NDK)** - Nostr protocol implementation
3. **Zod** - Schema validation and type inference
4. **TypeScript** - Strong typing for query functions and results

### Query Organization
1. **Entity-Based Files** - Separate files for products, profiles, orders, etc.
2. **Query Key Factories** - Centralized cache key management
3. **Data Fetching Functions** - Low-level event fetching utilities
4. **React Query Options** - Pre-configured query configurations
5. **Hook Abstractions** - High-level data access patterns

## Design Patterns

### Query Structure
1. **Query Key Factory Pattern** - Consistent cache key generation
2. **Data Fetching Functions** - Reusable event fetching logic
3. **Query Options Pattern** - Standardized query configurations
4. **Hook Abstraction Pattern** - Easy data consumption APIs
5. **Data Transformation Layer** - Structured data extraction from events

### Caching Strategy
1. **Stale-While-Revalidate** - Immediate cache return with background refresh
2. **Query Key Hierarchies** - Nested cache invalidation patterns
3. **Selective Refetching** - Granular cache updates
4. **LocalStorage Integration** - Persistent client-side state
5. **Timeout Handling** - Graceful degradation for slow relays

### Error Handling
1. **Graceful Fallbacks** - Default values for missing data
2. **Timeout Management** - Bounded query execution
3. **Network Resilience** - Retry and recovery patterns
4. **Blacklist Filtering** - Event filtering for blocked content
5. **Deletion Tracking** - Local deletion state management

## Contradictory Design Decisions

1. **Query Organization**:
   - Entity-based file organization
   - BUT inconsistent query key factory patterns
   - Some files mix multiple entity types
   - No clear separation of concerns

2. **Data Fetching**:
   - Direct NDK integration
   - BUT inconsistent timeout handling
   - Mixed use of fetchEvents vs fetchEventsWithTimeout
   - No standardized relay selection strategy

3. **Caching Strategy**:
   - TanStack Query caching
   - BUT inconsistent staleTime configurations
   - Mixed refetch policies
   - No cache invalidation coordination

4. **Error Handling**:
   - Graceful error handling patterns
   - BUT inconsistent error boundary usage
   - Mixed use of try/catch vs query error states
   - No centralized error handling strategy

## Code Reuse Opportunities

1. **Common Query Patterns**:
   - Base query options patterns
   - Standardized error handling
   - Consistent timeout configurations
   - Reusable data transformation utilities

2. **Data Fetching Utilities**:
   - Relay connection management
   - Event filtering utilities
   - Blacklist filtering functions
   - Deletion tracking mechanisms

3. **Query Key Management**:
   - Standardized key factory patterns
   - Hierarchical key organization
   - Consistent invalidation strategies
   - Cache coordination utilities

4. **Data Transformation**:
   - Schema validation utilities
   - Tag extraction functions
   - Coordinate parsing utilities
   - Event property accessors

## Test Coverage Gaps

1. **Query Function Testing**:
   - No unit tests for data fetching functions
   - No schema validation testing
   - No error handling validation
   - No timeout scenario testing

2. **Query Options Testing**:
   - No testing of query key generation
   - No cache configuration validation
   - No refetch behavior testing
   - No staleTime behavior validation

3. **Hook Testing**:
   - No hook integration testing
   - No loading state validation
   - No error state testing
   - No data transformation testing

4. **Data Transformation Testing**:
   - No individual tag extraction testing
   - No coordinate parsing validation
   - No schema compliance testing
   - No edge case data handling

## Security Issues

1. **Data Validation**:
   - No input sanitization for relay data
   - No schema enforcement for events
   - No malicious event filtering
   - No content injection prevention

2. **Cache Security**:
   - No cache poisoning prevention
   - No secure cache key generation
   - No sensitive data in cache keys
   - No cache access control

3. **Network Security**:
   - No relay connection validation
   - No certificate verification
   - No encrypted transport enforcement
   - No malicious relay filtering

## Performance Considerations

1. **Query Optimization**:
   - No query deduplication
   - No batched request handling
   - No parallel request optimization
   - No lazy loading strategies

2. **Data Fetching**:
   - No pagination optimization
   - No infinite scroll patterns
   - No background data prefetching
   - No selective data loading

3. **Cache Management**:
   - No cache size limits
   - No cache eviction policies
   - No memory usage monitoring
   - No cache warming strategies

4. **Network Efficiency**:
   - No connection pooling
   - No relay selection optimization
   - No bandwidth usage optimization
   - No network error recovery

## Maintenance Issues

1. **Query Documentation**:
   - No inline query documentation
   - No query dependency tracking
   - No performance impact documentation
   - No breaking change tracking

2. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements
   - No automated code quality checks
   - No query complexity monitoring

3. **Version Control**:
   - No query versioning strategy
   - No migration management
   - No changelog for query changes
   - No deprecation management

4. **Query Organization**:
   - Inconsistent file organization
   - No clear query categorization
   - No standardized query interfaces
   - No query composition patterns

## Data Consistency Issues

1. **Event Processing**:
   - No standardized event validation
   - Mixed schema enforcement
   - Inconsistent tag extraction
   - No event version handling

2. **Data Transformation**:
   - No centralized transformation layer
   - Inconsistent data access patterns
   - Mixed validation approaches
   - No data integrity checking

3. **Cache Coherency**:
   - No cache invalidation coordination
   - Mixed staleTime configurations
   - No cache consistency guarantees
   - No distributed cache management

4. **State Management**:
   - No clear state transition patterns
   - Mixed client/server state handling
   - No state synchronization strategies
   - No conflict resolution patterns