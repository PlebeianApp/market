# Decentralized Nostr Marketplace - Plebeian Market

**Nostr** (Notes and Other Stuff Transmitted by Relays) doesn't use a traditional server architecture, instead opting for a variable list of relays as back-ends.

The app uses NIP-99 and Gamma markets as its spec. Auctions are a new spec only found in Plebeian.

Centralized server for handling tasks relating to the app itself like admin, featured, blacklisting, NIP-05 and custom URLs (Vanity URLs).

ContextVMs are deployed separately and serve clients over nostr: currency conversion, live events and auction bid validation.

All app data stored decentralized on Nostr relays. Own relay is also deployed in CI/CD.

# Architecture Details

## Data Flow
- Client application communicates via WebSocket to Nostr relays for marketplace data
- Real-time event handling through WebSocket connections to relays
- Centralized server handles administrative functions and metadata
- ContextVM nodes provide specialized backend services over Nostr protocol
- All user-generated content stored as Nostr events on relays

## Deployment Model
- Application deployed as static files (bun build process)
- Centralized server component for admin/featured functions
- ContextVM nodes deployed independently for backend services
- Own relay infrastructure deployed through CI/CD pipeline
- Staging and production environments with GitHub Actions

# File Context

- `src/`: Source for the client and server
- `contextvm/`: Source for **ContextVM** nodes for backend services deployed independently over Nostr
- `e2e/`: End-to-end testing with Playwright
- `.github/`: GitHub Actions for CI/CD
- `scripts/`: various scripts
- `public/`: published app assets
- `deploy-simple/`: deployment files and scripts
- `docs/`: various documentation and spec
- `styles/`: client app styles

# App Runtime

- JS Runtime is **bun**: `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`
- Shadcn component libs in `components.json`
- Prettier for code formatting: `.prettierrc` and `.prettierignore`
- Git for source control: `.git/` & `.gitignore`
- `.depcheckrc` for dependency analysis

# Main App Libs

- React 19 for UI
- TanStack Router for file-based routing
- TanStack Query for data fetching & caching
- NDK and nostr-tools for nostr
- Tailwind CSS v4 for styling
- Shadcn UI for components

# ADR File Structure Architecture

Layered documentation hierarchy with AGENTS.md files in each directory. Root file contains link to subdirectory documentation. Each subdirectory has own AGENTS.md with decisions specific to that scope. Parent decisions inform child directory analysis. Always read AGENTS.md file in directory and also all parent directories.

# Roles

Use ADR and AGENTS.md to help with roles:
- **Product Manager**: Ensure issue spec conforms to AGENTS.md OR suggest changes to AGENTS.md in issue spec.
- **Senior Developer**: Always read AGENTS.md and follow the spec closely.
- **Maintainer/PR Reviewer**: Ensure all files and file content conform to AGENTS.md.

## Project Architecture & Build System

### Core Technology Stack
1. **Bun Runtime** - Used as the primary JavaScript runtime and build tool
2. **TypeScript** - Strict type checking with modern configuration
3. **React 19** - Latest React version with JSX runtime
4. **TanStack Router** - File-based routing system
5. **TanStack Query** - Server state management
6. **Tailwind CSS v4** - Utility-first CSS framework
7. **shadcn/ui** - Component library built on Radix UI primitives

### Build Process
1. **Custom Build Script** (`build.ts`) - Handles compilation with Tailwind plugin
2. **Bun Bundler** - Used for asset compilation and optimization
3. **HTML Entry Points** - Scans for HTML files in src/ as entry points
4. **Public Assets** - Static files copied from public/ directory during build

## Configuration Files

### TypeScript Configuration
1. **Strict Mode** - Enabled with strict null checks
2. **Modern Module Resolution** - Using "bundler" mode
3. **Path Aliases** - Configured for clean imports (@/* maps to src/*)

### Package Management
1. **Bun Package Manager** - Used for dependency management and scripts
2. **Private Package** - Marked as private in package.json
3. **ES Module Format** - Using ESM format throughout

## Script Configuration

### Development Scripts
1. **dev** - Hot reloading development server
2. **dev:seed** - Development with automatic seeding
3. **watch-routes** - Automatic route tree generation watching

### Production Scripts
1. **build** - Production build with route generation
2. **start** - Production server startup

### Testing Scripts
1. **test:unit** - Unit test runner with specific file filtering
2. **test:e2e** - End-to-end testing with Playwright
3. **test:integration** - Integration test runner

### Utility Scripts
1. **seed** - Data seeding script
2. **startup** - Initial setup script
3. **format** - Code formatting with Prettier

## Contradictory Design Decisions

1. **Multiple Environments** - Scripts exist for local, staging, and production but mixing patterns:
   - `dev`, `dev:seed`, `dev:local-only` for development
   - `start`, `start:local-only`, `start:production`, `start:staging` for running
   - Inconsistent naming and purpose documentation

2. **Testing Strategy Inconsistency**:
   - Unit tests, integration tests, and E2E tests exist
   - But test organization and coverage is inconsistent
   - No clear testing pyramid documented

3. **Build Configuration**:
   - Custom build script with CLI argument parsing
   - But also relies on default Bun build behavior
   - Some manual file copying logic in build script

## Code Reuse Opportunities

1. **Script Parameter Parsing** - The CLI argument parsing in build.ts could be extracted for reuse
2. **File Operations** - Common file operations across scripts could be unified
3. **Configuration Loading** - Environment variable loading patterns could be standardized
4. **Error Handling** - Consistent error handling patterns across scripts

## Test Coverage Gaps

1. **Build Script Testing** - The custom build.ts script lacks dedicated tests
2. **Configuration File Validation** - No validation tests for package.json, tsconfig.json, etc.
3. **Script Integration Testing** - Many scripts lack integration tests
4. **CI/CD Pipeline Testing** - No tests for the GitHub Actions workflows

## Dependencies Analysis

### Production Dependencies
1. **Nostr Libraries** - @nostr-dev-kit/ndk, nostr-tools for Nostr protocol
2. **Wallet Integration** - Lightning and Cashu wallet support
3. **UI Components** - Radix UI, Tailwind components, icons
4. **State Management** - TanStack Query and custom stores
5. **Form Handling** - @tanstack/react-form

### Development Dependencies
1. **Testing** - Playwright for E2E, testing utilities for unit tests
2. **Build Tools** - Tailwind CSS, SVGO for optimization
3. **Development Utilities** - Faker.js for seeding data

## Project Structure Observations

1. **Monorepo-like Structure** - Contains multiple logical components:
   - Client application (src/)
   - ContextVM nodes (contextvm/)
   - Documentation (docs/)
   - Deployment scripts (deploy-simple/)
   - End-to-end tests (e2e/)
   - Scripts (scripts/)

2. **Decentralized Architecture** - Multiple components working with Nostr relays:
   - Client-side marketplace
   - Server-side admin functions
   - ContextVM backend services
   - Custom relay infrastructure

# Project Architecture Overview

This section provides a comprehensive overview of the entire project architecture, referencing the detailed AGENTS.md files in each subdirectory.

## Core Architecture Components

### Client Application (`src/`)
The main marketplace application built with React 19, featuring:
- **File-based Routing**: TanStack Router for page navigation
- **Component Architecture**: Shadcn UI components with Tailwind CSS styling
- **State Management**: TanStack Store for client state with localStorage persistence
- **Nostr Integration**: NDK for decentralized data access and publishing
- **Query Management**: TanStack Query for server state and caching
- See `src/AGENTS.md` for detailed design decisions

### ContextVM Services (`contextvm/`)
Specialized backend services deployed independently over Nostr:
- **Currency Conversion**: BTC/fiat exchange rates via MCP protocol
- **Model Context Protocol**: AI-assisted development workflows
- **Price Aggregation**: Multi-source rate collection and median calculation
- **Caching Layer**: SQLite-based persistent caching with TTL expiration
- See `contextvm/AGENTS.md` for detailed design decisions

### End-to-End Testing (`e2e/`)
Comprehensive testing infrastructure with Playwright:
- **Scenario-Based Testing**: Cumulative test data seeding
- **Auth Flow Testing**: Multi-method authentication validation
- **Relay Monitoring**: WebSocket traffic capture and validation
- **Local Relay Testing**: Isolated test environment with nak relay
- See `e2e/AGENTS.md` for detailed design decisions

### Component Library (`src/components/`)
Reusable UI components following shadcn/ui patterns:
- **UI Primitives**: Low-level components built on Radix UI
- **Feature Components**: Marketplace-specific data display components
- **Auth Components**: Multi-method authentication UI flows
- **Layout Components**: Page structure and navigation components
- See `src/components/AGENTS.md` for detailed design decisions

### Data Layer (`src/queries/`)
Data fetching and caching abstraction layer:
- **Query Key Management**: Consistent cache key generation
- **React Query Integration**: Server state management patterns
- **Data Transformation**: Structured data extraction from Nostr events
- **Schema Validation**: Zod schemas for type safety and validation
- See `src/queries/AGENTS.md` for detailed design decisions

### Business Logic (`src/lib/`)
Shared utilities and core application logic:
- **State Management**: Client-side store implementations
- **Nostr Integration**: Core NDK abstraction and relay management
- **Data Validation**: Schema validation and input sanitization
- **Utility Functions**: Common helper functions and utilities
- See `src/lib/AGENTS.md` for detailed design decisions

### Routing System (`src/routes/`)
File-based routing with nested layouts:
- **Public Routes**: Marketplace browsing and product viewing
- **Dashboard Routes**: Protected admin and seller functionality
- **Authentication Routes**: Login and user management flows
- **Route Loaders**: Data preloading and parameter validation
- See `src/routes/AGENTS.md` for detailed design decisions

### Custom Hooks (`src/hooks/`)
Reusable React hook abstractions:
- **Permission Hooks**: User role and entity permission checking
- **Data Sync Hooks**: Real-time data synchronization with stores
- **UI Hooks**: Responsive design and user interaction patterns
- **Domain Hooks**: Marketplace-specific business logic encapsulation
- See `src/hooks/AGENTS.md` for detailed design decisions

### Event Publishing (`src/publish/`)
Nostr event creation and publishing utilities:
- **Event Creation**: Structured Nostr event building patterns
- **Data Validation**: Pre-publishing validation and sanitization
- **Mutation Management**: TanStack Query mutation hooks
- **Cache Invalidation**: Query cache management after operations
- See `src/publish/AGENTS.md` for detailed design decisions

## Architectural Design Principles

### Decentralization First
All user-generated content is stored as Nostr events on relays, ensuring:
- No central point of failure
- User data ownership and portability
- Censorship resistance
- Global availability and redundancy

### Progressive Enhancement
The application gracefully degrades when:
- Relays are slow or unavailable
- Network connectivity is limited
- JavaScript is disabled (basic functionality)
- Feature support varies across browsers

### Security by Design
Multiple layers of security protection:
- Client-side private key management
- Multi-method authentication support
- Content filtering and moderation
- Secure communication protocols

### Performance Optimization
Efficient resource usage through:
- Client-side caching strategies
- Lazy loading and code splitting
- Efficient data fetching patterns
- Relay connection optimization

## Integration Points

### Nostr Protocol Integration
Full implementation of relevant NIPs:
- NIP-07: Browser extension communication
- NIP-46: Remote signing (NIP-46)
- NIP-99: Classified listings
- Custom extensions for marketplace features

### Bitcoin Lightning Network
Native payment integration:
- Lightning Network payments via LNURL
- Zap receipt monitoring and validation
- Multi-wallet support (NWC, private key)
- Automatic wallet selection and balance monitoring

### AI-Assisted Development
ContextVM integration for enhanced productivity:
- Model Context Protocol for tool integration
- AI-assisted code generation and testing
- Automated workflow assistance
- Smart data analysis and insights

## Deployment and Operations

### Environment Management
Consistent deployment across environments:
- Development: Local relay and dev server
- Staging: Dedicated staging infrastructure
- Production: Public relay and production deployment
- Testing: Isolated e2e test environments

### Monitoring and Observability
Comprehensive system visibility:
- Relay performance monitoring
- User behavior analytics
- Error tracking and reporting
- Performance metrics collection

### Scalability Considerations
Designed for growth and expansion:
- Horizontal scaling capabilities
- Efficient data loading and caching
- Relay selection optimization
- Load balancing and distribution

This architecture represents a modern, decentralized marketplace that leverages the strengths of the Nostr protocol while providing a seamless user experience through careful design and implementation.
