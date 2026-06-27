# src/components/ Directory Design Decisions Overview

## Component Architecture

### Core Purpose
1. **UI Component Library** - Reusable UI components following shadcn/ui patterns
2. **Feature Components** - Domain-specific components for marketplace functionality
3. **Layout Components** - Page structure and navigation components
4. **Authentication Components** - Login and user management UI
5. **Data Display Components** - Product, user, and content presentation

### Technology Stack
1. **React 19** - Latest React features and patterns
2. **shadcn/ui** - Component library built on Radix UI primitives
3. **Tailwind CSS** - Utility-first styling with variants
4. **TypeScript** - Strong typing for component props and state
5. **Lucide React** - Icon library integration

### Component Categories
1. **UI Primitives** - Low-level components in `src/components/ui/`
2. **Data Components** - Product cards, user cards, collection displays
3. **Form Components** - Input controls, selectors, search
4. **Layout Components** - Page sections, grids, navigation
5. **Auth Components** - Login dialogs, authentication flows
6. **Feature Components** - Cart, wallet, social, checkout

## Design Patterns

### Component Structure
1. **Props Interface** - Explicit TypeScript interfaces for component props
2. **State Management** - React hooks for local state and side effects
3. **Query Integration** - TanStack Query hooks for data fetching
4. **Store Integration** - Custom store hooks for client state
5. **Event Handling** - Consistent event handler patterns with preventDefault/stopPropagation

### Styling Approach
1. **Tailwind Variants** - class-variance-authority for component variants
2. **Responsive Design** - Mobile-first responsive utilities
3. **Dark Mode Support** - Built-in dark mode styling
4. **Accessibility** - Semantic HTML and ARIA attributes
5. **Design Tokens** - Consistent spacing, colors, and typography

### Data Flow Patterns
1. **Query-Based Components** - Components that fetch their own data
2. **Props-Based Components** - Components that receive data as props
3. **Store Integration** - Components that interact with global state
4. **Event Bubbling** - Consistent event handling patterns
5. **Context Usage** - React context for cross-cutting concerns

## Contradictory Design Decisions

1. **Component Organization**:
   - UI primitives in dedicated directory
   - Feature components mixed with data components
   - Authentication components in subdirectory
   - BUT no clear categorization strategy

2. **State Management**:
   - Some components use TanStack Query
   - Others use custom stores
   - Some manage local state
   - BUT inconsistent state management patterns

3. **Data Fetching**:
   - Components fetch data directly
   - Components receive data as props
   - Components interact with stores
   - BUT no standardized data flow patterns

4. **Component Reusability**:
   - Many components are highly specialized
   - Some components are generic UI primitives
   - BUT unclear which components should be reusable

## Code Reuse Opportunities

1. **Common Component Patterns**:
   - Card-based display components
   - Form input components
   - Button and action components
   - Dialog and modal components

2. **Data Display Utilities**:
   - Price display formatting
   - Image handling utilities
   - Text truncation and ellipsis
   - Status badge components

3. **Authentication Patterns**:
   - Login dialog components
   - Private key handling
   - NIP-46 integration components
   - Error handling patterns

4. **UI Interaction Patterns**:
   - Loading and skeleton states
   - Error display components
   - Confirmation dialogs
   - User feedback components

## Test Coverage Gaps

1. **Component Testing**:
   - No unit tests for individual components
   - No snapshot testing
   - No accessibility testing
   - No visual regression testing

2. **Interaction Testing**:
   - No user interaction testing
   - No event handling validation
   - No state transition testing
   - No edge case testing

3. **Data Integration Testing**:
   - No testing of query integration
   - No testing of store integration
   - No testing of error states
   - No testing of loading states

4. **Accessibility Testing**:
   - No automated accessibility scanning
   - No keyboard navigation testing
   - No screen reader compatibility
   - No ARIA attribute validation

## Security Issues

1. **Input Validation**:
   - No client-side input validation
   - No sanitization of user-generated content
   - No XSS protection in component rendering
   - No injection attack prevention

2. **Authentication Handling**:
   - Authentication state in localStorage
   - No secure credential storage
   - No session management
   - No authentication bypass prevention

3. **Data Display**:
   - No content filtering for NSFW content
   - No user-generated content sanitization
   - No privacy protection for PII
   - No rate limiting for content display

## Performance Considerations

1. **Component Rendering**:
   - No performance optimization patterns
   - No memoization of expensive operations
   - No lazy loading of components
   - No code splitting strategies

2. **Data Fetching**:
   - No caching optimization
   - No pagination or infinite scroll patterns
   - No background data loading
   - No request deduplication

3. **Bundle Size**:
   - No component-level code splitting
   - No tree shaking optimization
   - No lazy component loading
   - No bundle analysis

## Accessibility Issues

1. **Semantic HTML**:
   - Inconsistent semantic element usage
   - Missing landmark elements
   - Incomplete heading hierarchy
   - No proper focus management

2. **ARIA Implementation**:
   - Inconsistent ARIA attribute usage
   - Missing ARIA roles and properties
   - No ARIA live regions
   - No accessible error messages

3. **Keyboard Navigation**:
   - No keyboard navigation testing
   - No focus trap implementation
   - No skip link support
   - No keyboard shortcut handling

## Maintenance Issues

1. **Component Documentation**:
   - No inline component documentation
   - No prop documentation
   - No usage examples
   - No component API documentation

2. **Component Versioning**:
   - No component version management
   - No breaking change tracking
   - No deprecation strategy
   - No component lifecycle management

3. **Code Quality**:
   - No linting or formatting standards
   - No code review requirements
   - No automated code quality checks
   - No component complexity monitoring

4. **Dependency Management**:
   - No component dependency tracking
   - No peer dependency management
   - No component-level dependency updates
   - No bundle size impact monitoring

## Component Organization Issues

1. **Directory Structure**:
   - Mixed feature and UI components
   - No clear categorization strategy
   - Inconsistent naming conventions
   - No component grouping patterns

2. **Component Coupling**:
   - Tight coupling between components
   - No clear component boundaries
   - No component interface contracts
   - No component composition patterns

3. **Component Abstraction**:
   - Inconsistent abstraction levels
   - No clear primitive vs. composite distinction
   - No component reuse patterns
   - No component extensibility

4. **Component Testing Boundaries**:
   - No clear testing boundaries
   - No component isolation strategies
   - No mocking requirements
   - No test data management