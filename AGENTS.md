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