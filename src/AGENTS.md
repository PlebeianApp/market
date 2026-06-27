# src/ Development Guidelines

## Routing
Routes are file-based using TanStack Router. Place route files in `src/routes/` using `createFileRoute`. The dashboard uses a `_dashboard-layout` layout route pattern.

## Server State Management
All relay queries use TanStack Query. Implement queries and mutations through hooks located in `src/queries/`.

## Client State Management
Client state uses a custom Store class with setState method. There are 13 stores (authStore, ndkStore, cartStore, nip60Store, etc.). This is a hand-rolled observable pattern, not using Zustand or Jotai.

## Styling
Styling uses Tailwind CSS with shadcn/ui components. Component library is in `src/components/ui/` with Radix primitives wrapped with Tailwind variants.

# Comprehensive Design Decisions Overview

## Core Architecture Patterns

1. **File-based routing** with TanStack Router (`src/routes/`) using `createFileRoute`
2. **Query-based data fetching** with TanStack Query (`src/queries/`) for all relay interactions
3. **Custom Store pattern** for client state management (13 different stores in `src/lib/stores/`)
4. **Component library** using shadcn/ui with Tailwind CSS (`src/components/ui/`)
5. **Hook-based logic extraction** for reusable behaviors (`src/hooks/`)

## Contradictory Design Decisions

1. **State Management Inconsistency**:
   - Custom Store pattern is used for client state
   - React Query is used for server state
   - BUT some components manage local state with useState/useReducer directly

2. **Component Structure Inconsistency**:
   - Some components are in `src/components/` directory directly
   - Others are in feature-specific subdirectories (`src/components/auth/`, `src/components/checkout/`, etc.)
   - UI primitives are in `src/components/ui/`

3. **Test Coverage Inconsistency**:
   - Some stores have tests (`src/lib/stores/cart.test.ts`, `src/lib/stores/product-navigation.test.ts`, `src/lib/stores/product-session.test.ts`)
   - Some queries have tests (`src/queries/__tests__/`)
   - BUT most components and hooks lack dedicated test files

4. **Query Organization**:
   - Queries are organized by entity type in `src/queries/`
   - BUT some logic is duplicated across query files (e.g., error handling patterns)

## Code Reuse Opportunities

1. **Error Handling Patterns**:
   - Many query files implement similar error handling
   - Could extract common error handling into reusable utilities

2. **Loading States**:
   - Components frequently implement similar loading skeletons
   - Could create more generic loading components

3. **Form Handling**:
   - Multiple components implement form validation
   - Could standardize form handling with a common approach

4. **Nostr Event Processing**:
   - Multiple stores and queries process Nostr events similarly
   - Could extract common Nostr processing logic

5. **Pagination Patterns**:
   - Several query files implement infinite scroll pagination
   - Could standardize pagination handling

## Test Coverage Gaps

1. **Component Testing**:
   - Most components in `src/components/` lack dedicated test files
   - No comprehensive component testing strategy documented

2. **Hook Testing**:
   - Hooks in `src/hooks/` have no dedicated test files
   - Critical hooks like `useV4VManager.ts` and `useNotificationMonitor.ts` are untested

3. **Store Testing**:
   - Only 3 out of 13 stores have test files (`cart.test.ts`, `product-navigation.test.ts`, `product-session.test.ts`)
   - Critical stores like `auth.ts`, `ndk.ts`, `wallet.ts` lack tests

4. **Route Testing**:
   - Route components in `src/routes/` have no dedicated test files
   - No integration testing for route loading states or error boundaries

5. **Utility Function Testing**:
   - Utility functions in `src/lib/utils/` and `src/lib/nostr/` lack comprehensive test coverage
   - Core logic functions may have edge cases that aren't tested

