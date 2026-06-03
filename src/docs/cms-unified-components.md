# Unified CMS Components

This document explains the new unified approach for CMS components that fetch and display product data.

## Overview

We've replaced the separate static and dynamic implementations with unified components that use a flexible data source configuration. This simplifies the codebase and provides a consistent interface for content editors.

## New Components

### CMSProductGrid
Replaces `ProductGridStatic` and `ProductGridDynamic`.

**Features:**
- Supports both static ID lists and dynamic Nostr filters
- Configurable grid layout (columns for desktop/tablet/mobile)
- Toggle for quick add and vendor display

### CMSFeaturedProductCard
Replaces `FeaturedProductCardStatic` and `FeaturedProductCardDynamic`.

**Features:**
- Supports both static ID lists and dynamic Nostr filters
- Toggle for price and description display

## Data Source Configuration

Both components use a unified `DataSource` type:

```typescript
type DataSourceType = 'static' | 'dynamic'

interface StaticDataSource {
  type: 'static'
  ids: string[]
}

interface DynamicDataSource {
  type: 'dynamic'
  kind?: number
  limit?: number
  authors?: string[]
  tags?: string[][]
  relayUrl?: string
}

type DataSource = StaticDataSource | DynamicDataSource
```

## Custom Field

The `DataSourceField` component provides a user-friendly interface in the CMS editor for configuring data sources:

- Toggle between static and dynamic modes
- For static: Add/remove product IDs
- For dynamic: Configure kind, limit, authors, tags, and relay URL

## Implementation Details

The `useProductData` hook handles data fetching for both static and dynamic sources:

1. **Static**: Fetches events by specific IDs
2. **Dynamic**: Builds and executes Nostr filters based on configuration

The base components (`ProductGridBase` and `FeaturedProductCardBase`) handle rendering regardless of data source type.

## Migration

Old components are no longer used:
- `ProductGridStatic` → `CMSProductGrid` with static data source
- `ProductGridDynamic` → `CMSProductGrid` with dynamic data source
- `FeaturedProductCardStatic` → `CMSFeaturedProductCard` with static data source
- `FeaturedProductCardDynamic` → `CMSFeaturedProductCard` with dynamic data source