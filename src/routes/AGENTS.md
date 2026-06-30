# src/routes/ Directory Design Decisions Overview

## Routing Architecture

### Core Purpose
1. **Page-Level Routing** - File-based routing using TanStack Router
2. **Dashboard Organization** - Nested route structure for admin/dashboard areas
3. **Product Catalog** - Public marketplace browsing and search routes
4. **User Journeys** - Complete user workflows from browsing to checkout

### Technology Stack
1. **TanStack Router** - File-based routing with nested layouts
2. **React 19** - Latest React features and patterns
3. **TypeScript** - Strong typing for route parameters and loaders
4. **Query Integration** - TanStack Query hooks for data fetching

### Route Organization
1. **Public Routes** - Marketplace browsing and product viewing
2. **Dashboard Routes** - Protected admin and seller functionality
3. **Authentication Routes** - Login and user management
4. **Checkout Routes** - Purchase flow and order processing
5. **Special Routes** - Setup, search, and vanity URL handling

## Design Patterns

### Route Structure
1. **File-Based Routing** - Direct mapping of file structure to URLs
2. **Nested Layouts** - Shared layouts for dashboard and authenticated areas
3. **Route Loaders** - Data preloading and parameter extraction
4. **Component Separation** - Route components vs. UI components
5. **Error Boundaries** - Graceful error handling per route

### Data Loading Patterns
1. **Query Integration** - TanStack Query hooks for server state
2. **Loader Functions** - Route-level data loading and parameter validation
3. **Suspense Boundaries** - Loading state management
4. **Error Boundaries** - Error state handling
5. **Cache Management** - Query cache invalidation and refetching

### Authentication Protection
1. **Route Guards** - Protected route access control
2. **Conditional Rendering** - Role-based UI visibility
3. **Redirect Patterns** - Login flow and session management
4. **Permission Checking** - Entity-level permission validation
5. **Admin Access Control** - Multi-level admin authorization

## Known Design Inconsistencies with Parent AGENTS.md

These are acknowledged inconsistencies with the parent directory AGENTS.md design:

1. **Data Privacy Issues (#9)**: Route components may handle and display PII data without proper encryption or security measures, and authentication state management in route guards treats user identifiers without adequate privacy protection.

2. **Error Handling Inconsistencies (#10)**: Error handling in route loaders and components varies with mixed approaches to try/catch vs query error states, lacking the standardized correlation ID tracking required for traceability.

3. **Security Issues**: Route protection patterns use client-side permission checking only, without server-side authorization validation, creating potential privilege escalation vulnerabilities.

## Contradictory Design Decisions

1. **Route Organization**:
   - File-based routing structure
   - BUT inconsistent dashboard route organization
   - Mixed public/private route patterns
   - No clear route categorization strategy

2. **Data Loading**:
   - Query-based data fetching
   - BUT mixed route loader vs component query patterns
   - Inconsistent error handling approaches
   - No standardized loading state patterns

3. **Authentication Handling**:
   - Route-level protection patterns
   - BUT inconsistent guard implementation
   - Mixed redirect vs render approaches
   - No centralized auth flow management

4. **Layout Management**:
   - Nested layout patterns
   - BUT inconsistent shared layout usage
   - Mixed component composition strategies
   - No clear layout separation patterns

## Code Reuse Opportunities

1. **Route Utilities**:
   - Common route loader patterns
   - Standardized data loading utilities
   - Consistent error handling utilities
   - Shared authentication guard utilities

2. **Layout Components**:
   - Reusable dashboard layout patterns
   - Shared header/footer components
   - Common navigation patterns
   - Standardized UI element placement

3. **Data Loading Patterns**:
   - Common query integration patterns
   - Standardized loading state management
   - Consistent error boundary usage
   - Shared suspense boundary patterns

4. **Authentication Patterns**:
   - Standardized route protection utilities
   - Common permission checking utilities
   - Consistent redirect handling
   - Shared admin access control patterns

## Test Coverage Gaps

1. **Route Testing**:
   - No route-level integration testing
   - No parameter validation testing
   - No loader function testing
   - No error boundary testing

2. **Data Loading Testing**:
   - No query integration testing
   - No loading state validation
   - No error state testing
   - No cache management testing

3. **Authentication Testing**:
   - No route protection testing
   - No permission validation testing
   - No redirect flow testing
   - No session management testing

4. **Layout Testing**:
   - No layout component testing
   - No shared element testing
   - No navigation pattern testing
   - No responsive layout testing

## Security Issues

1. **Route Protection**:
   - Inconsistent authentication checking
   - No centralized authorization management
   - Mixed public/private route patterns
   - No privilege escalation prevention

2. **Data Loading**:
   - No input validation for route parameters
   - No malicious data prevention
   - No injection attack prevention
   - No sensitive data exposure prevention

3. **Authentication Handling**:
   - Mixed authentication state management
   - No secure session handling
   - No authentication bypass prevention
   - No CSRF protection

## Performance Considerations

1. **Route Loading**:
   - No route-level code splitting
   - No lazy loading optimization
   - No bundle size optimization
   - No prefetching strategies

2. **Data Fetching**:
   - No query deduplication
   - No background data loading
   - No selective data fetching
   - No cache optimization

3. **Component Rendering**:
   - No rendering optimization
   - No memoization patterns
   - No virtualization strategies
   - No efficient update patterns

4. **Network Efficiency**:
   - No request batching
   - No connection pooling
   - No relay selection optimization
   - No bandwidth usage optimization

## Maintenance Issues

1. **Route Documentation**:
   - No route-level documentation
   - No parameter documentation
   - No data loading documentation
   - No error handling documentation

2. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements
   - No automated code quality checks
   - No route complexity monitoring

3. **Version Control**:
   - No route versioning strategy
   - No breaking change tracking
   - No migration management
   - No changelog for route changes

4. **Route Organization**:
   - Inconsistent file organization
   - No clear categorization strategy
   - Mixed public/private route patterns
   - No standardized route interfaces

## Dashboard Route Issues

1. **Dashboard Structure**:
   - Nested dashboard organization
   - BUT inconsistent route grouping
   - Mixed product/sales/account routes
   - No clear dashboard module separation

2. **Admin Functionality**:
   - Admin access control patterns
   - BUT inconsistent permission checking
   - Mixed admin/user interface patterns
   - No standardized admin components

3. **Seller Features**:
   - Product management routes
   - BUT inconsistent CRUD patterns
   - Mixed form handling approaches
   - No standardized seller workflows

4. **User Experience**:
   - Dashboard navigation patterns
   - BUT inconsistent UI component usage
   - Mixed layout structures
   - No standardized dashboard patterns

## URL Structure Issues

1. **Public Routes**:
   - Product and user browsing patterns
   - BUT inconsistent vanity URL handling
   - Mixed search and filter patterns
   - No standardized SEO patterns

2. **Dashboard Routes**:
   - Protected route URL structure
   - BUT inconsistent URL organization
   - Mixed CRUD URL patterns
   - No standardized REST-like patterns

3. **Dynamic Routes**:
   - Parameter-based routing
   - BUT inconsistent parameter validation
   - Mixed URL parameter patterns
   - No standardized URL design

4. **SEO Optimization**:
   - No route-level SEO patterns
   - No meta tag management
   - No structured data patterns
   - No canonical URL patterns