# Plebeian Market

A decentralized marketplace built on the Nostr protocol, enabling peer-to-peer trading with Bitcoin Lightning Network payments.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.2.4+)
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (for containerized deployment)
- OR [Go](https://golang.org/doc/install) (for local relay setup)

### Option 1: Docker Development Deployment (Recommended)

The fastest way to get started is using Docker Compose, which automatically sets up both the Nostr relay and web application:

```bash
# Clone and navigate to the project
git clone <repository-url>
cd market

# Build and start all services
docker-compose up --build

# Or run in detached mode
docker-compose up --build -d
```

This will start:

- **Orly Relay** on `localhost:10547` (Nostr relay for development)
- **Web Application** on `localhost:3000`

The Docker setup automatically:

- Installs and configures the next.orly.dev relay
- Sets up the web application with proper environment variables
- Configures networking between services
- Includes health checks and auto-restart policies

#### Docker Commands

```bash
# Stop all services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild and restart services
docker-compose up --build --force-recreate

# Clean up (removes containers, networks, and volumes)
docker-compose down -v --remove-orphans
```

### Option 2: Local Development Setup

For local development without Docker:

#### Install Dependencies

```bash
bun install
```

#### Start Development Server

```bash
# With seeded data
bun dev:seed

# Fresh start without seed data
bun dev
```

#### Production Build

```bash
bun start
```

## Getting Started

### Initial Setup

1. Install dependencies with `bun install`
2. Copy `.env.example` to `.env` and configure your environment variables:
   - `APP_RELAY_URL`: Your relay URL
   - `APP_PRIVATE_KEY`: Your private key for initialization
3. Set up a development relay (required for local development)
   - We recommend using [nak](https://github.com/fiatjaf/nak) for development:

     ```bash
     # Install nak
     go install github.com/fiatjaf/nak@latest

     # Start a local relay
     nak serve
     ```

   - The relay will be available at `ws://localhost:10547`
   - Update your `.env` file with this relay URL

4. Initialize the application with default settings:
   ```bash
   bun run startup
   ```
   This will create:
   - Default app settings
   - User roles configuration
   - Ban list
   - Relay list

### First Run

When you first start the application:

1. If no settings are found in the configured relay, you'll be automatically redirected to `/setup`
2. The first user to complete the setup process becomes the administrator
   - Skip this step if you've run the startup script, as it creates default admin users
3. Complete the setup form to configure your marketplace settings
   - Skip this if you've run the startup script and want to use the default configuration

### Development Workflow

1. Start the development server:

   ```bash
   bun dev:seed
   ```

   _start without seeding for a fresh start with no setup data_

   ```bash
   bun dev
   ```

2. In a separate terminal, run the route watcher:

   ```bash
   bun run watch-routes
   ```

3. Optional: Seed the relay with test data:
   ```bash
   bun seed
   ```

## React Query

This project uses TanStack React Query (v5) for data fetching, caching, and state management. React Query helps with:

- Fetching, caching, and updating server state in your React applications
- Automatic refetching when data becomes stale
- Loading and error states handling
- Pagination and infinite scrolling

In our implementation, query functions and options are defined in the `src/queries` directory, using a pattern that separates query key factories and query functions.

Example:

```tsx
// Query key factory pattern for organized cache management
export const postKeys = {
	all: ['posts'] as const,
	details: (id: string) => [...postKeys.all, id] as const,
}

// Query options for use in routes and components
export const postsQueryOptions = queryOptions({
	queryKey: postKeys.all,
	queryFn: fetchPosts,
})
```

## Routing and Prefetching

This project uses TanStack Router for file-based routing with built-in prefetching capabilities:

- File-based routing: Routes are defined in the `src/routes` directory
- Dynamic routes: Parameters in file names (e.g., `posts.$postId.tsx`)
- Automatic route tree generation

Data prefetching is implemented via loader functions in route files:

```tsx
export const Route = createFileRoute('/posts/')({
	loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(postsQueryOptions),
	component: PostsRoute,
})
```

The router is configured to prefetch data on "intent" (hovering over links) with zero stale time to ensure fresh data:

```tsx
const router = createRouter({
	routeTree,
	context: {
		queryClient,
		nostr: nostrService,
	},
	defaultPreload: 'intent',
	defaultPreloadStaleTime: 0,
})
```

## Development Workflow

### .env variables

Set the .env variables by copying and renaming the `.env.example` file, then set your own values for the variables.

### Development relay

During development, you should spin up a relay to seed data and use it during the development cycle, you can use `nak serve` as a quick solution, or run another relay locally, then set it in your `.env` variables, and run `bun seed` to seed it.

### watch-routes Command

During development, you should run the `watch-routes` command in a separate terminal:

```bash
bun run watch-routes
```

This command uses the TanStack Router CLI (`tsr watch`) to monitor your route files and automatically generate the route tree file (`src/routeTree.gen.ts`). This file connects all your route components into a coherent navigation structure.

Without running this command, changes to route files or creating new routes won't be detected until you manually generate the route tree or restart the server.
