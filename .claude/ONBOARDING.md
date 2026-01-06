# Plebeian Market - Developer Onboarding Checklist

Welcome to Plebeian Market! This checklist will guide you through getting set up and familiar with the codebase.

## Pre-requisites

Before you begin, make sure you have:

- [ ] **Bun installed** (v1.2.4+) - [Installation Guide](https://bun.sh/docs/installation)
- [ ] **Git installed** and configured
- [ ] **Node.js v18+** (for compatibility with some tools)
- [ ] **A code editor** (VS Code recommended)
- [ ] **Basic understanding of**:
  - [ ] React and React Hooks
  - [ ] TypeScript
  - [ ] Nostr protocol basics
  - [ ] Bitcoin/Lightning fundamentals

---

## Day 1: Environment Setup

### 1. Repository Setup

- [ ] Fork the [PlebianApp/market](https://github.com/PlebianApp/market) repository
- [ ] Clone your fork locally:
  ```bash
  git clone https://github.com/YOUR_USERNAME/market.git
  cd market
  ```
- [ ] Add upstream remote:
  ```bash
  git remote add upstream https://github.com/PlebianApp/market.git
  ```

### 2. Install Dependencies

- [ ] Run `bun install`
- [ ] Verify installation: `bun --version`

### 3. Environment Configuration

- [ ] Copy `.env.example` to `.env`:
  ```bash
  cp .env.example .env
  ```
- [ ] Generate a test private key (hex format):

  ```bash
  # Using nak (if installed)
  nak key generate

  # Or use any Nostr key generator
  ```

- [ ] Update `.env` with your configuration:
  ```env
  APP_RELAY_URL=ws://localhost:10547
  APP_PRIVATE_KEY=<your-test-hex-key>
  NIP46_RELAY_URL=wss://relay.nsec.app
  ```

### 4. Local Relay Setup

- [ ] Install `nak` (Nostr Army Knife):
  ```bash
  go install github.com/fiatjaf/nak@latest
  ```
- [ ] Start local relay:
  ```bash
  nak serve
  ```
  This should run on `ws://localhost:10547`

### 5. Initialize Application

- [ ] Run startup script:

  ```bash
  bun run startup
  ```

  This creates default app settings, user roles, and relay configuration.

- [ ] (Optional) Seed test data:
  ```bash
  bun run seed
  ```
  This creates test users, products, collections, and orders.

### 6. Start Development Servers

- [ ] Open **Terminal 1** and run:

  ```bash
  bun run watch-routes
  ```

  This watches route files and regenerates the route tree.

- [ ] Open **Terminal 2** and run:

  ```bash
  bun dev
  ```

  This starts the development server with hot reload.

- [ ] Open browser and navigate to `http://localhost:3000`

### 7. Verify Setup

- [ ] App loads without errors
- [ ] No console errors in browser DevTools
- [ ] Can navigate to different pages
- [ ] Can open login dialog

---

## Day 2: Code Exploration

### 1. Read Documentation

- [ ] Read [README.md](../README.md) - Project overview and quick start
- [ ] Read [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture and patterns
- [ ] Read [API_EVENTS.md](API_EVENTS.md) - Nostr event structures
- [ ] Skim [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines

### 2. Understand Project Structure

- [ ] Explore `src/` directory structure
- [ ] Identify key directories:
  - [ ] `src/components/` - React components
  - [ ] `src/routes/` - TanStack Router routes
  - [ ] `src/queries/` - TanStack Query definitions
  - [ ] `src/lib/` - Utilities and helpers
  - [ ] `src/publish/` - Nostr event publishing logic
  - [ ] `src/hooks/` - Custom React hooks

### 3. Review Core Files

- [ ] `src/index.tsx` - Server entry point (Bun server)
- [ ] `src/frontend.tsx` - Client entry point (React app)
- [ ] `src/lib/queryClient.ts` - React Query and NDK setup
- [ ] `src/lib/constants.ts` - App constants and configurations
- [ ] `src/lib/stores/` - TanStack Store state management

### 4. Understand Key Patterns

- [ ] **Query Pattern**: Review `src/queries/products.tsx`
  - Query key factories
  - Query options
  - Usage in components

- [ ] **Route Pattern**: Review `src/routes/dashboard/products/`
  - Route loaders
  - Type-safe params
  - Data prefetching

- [ ] **Component Pattern**: Review `src/components/ProductCard.tsx`
  - TypeScript types
  - Props interface
  - Component structure

- [ ] **Store Pattern**: Review `src/lib/stores/cart.ts`
  - Store definition
  - Actions
  - Usage in components

### 5. Explore Nostr Integration

- [ ] Review NDK initialization in `src/lib/queryClient.ts`
- [ ] Check event publishing in `src/publish/products.tsx`
- [ ] Understand encryption in payment details (`src/publish/payment.tsx`)

---

## Day 3: Make Your First Change

### 1. Find a Good First Issue

- [ ] Check [GitHub Issues](https://github.com/PlebianApp/market/issues)
- [ ] Look for issues labeled `good first issue`
- [ ] Read [issues.md](../issues.md) for issue analysis

**Recommended starter issues:**

- **#238**: Button styling bug (2-4 hours, low complexity)
- **#246**: Carousel display bug (1-2 days, medium complexity)

### 2. Create a Feature Branch

- [ ] Update your local master:
  ```bash
  git checkout master
  git pull upstream master
  ```
- [ ] Create a branch:
  ```bash
  git checkout -b fix/issue-number-description
  ```

### 3. Make Your Changes

- [ ] Locate the relevant files
- [ ] Make focused, incremental changes
- [ ] Test your changes:
  ```bash
  bun dev
  ```
- [ ] Check for TypeScript errors:
  ```bash
  bun run build
  ```

### 4. Format and Commit

- [ ] Format code:
  ```bash
  bun run format
  ```
- [ ] Commit with conventional commit message:
  ```bash
  git add .
  git commit -m "fix(component): resolve issue description"
  ```

### 5. Push and Create PR

- [ ] Push to your fork:
  ```bash
  git push origin fix/issue-number-description
  ```
- [ ] Create Pull Request on GitHub
- [ ] Fill out PR template
- [ ] Link related issue

---

## Week 1: Deep Dive

### TanStack Router

- [ ] Read [TanStack Router docs](https://tanstack.com/router)
- [ ] Create a new route
- [ ] Add a route loader
- [ ] Implement route-level data prefetching

### TanStack Query

- [ ] Read [TanStack Query docs](https://tanstack.com/query)
- [ ] Create a new query
- [ ] Implement optimistic updates
- [ ] Use mutations with error handling

### Nostr & NDK

- [ ] Read [NDK documentation](https://github.com/nostr-dev-kit/ndk)
- [ ] Review [Nostr NIPs](https://github.com/nostr-protocol/nips)
- [ ] Create and publish a test event
- [ ] Subscribe to events and handle updates

### Testing

- [ ] Run E2E tests:
  ```bash
  bun run test:e2e
  ```
- [ ] Read existing tests in `e2e/`
- [ ] Write a simple E2E test
- [ ] Learn Playwright basics

---

## Ongoing Learning

### Stay Updated

- [ ] Star the repository on GitHub
- [ ] Watch for new issues and PRs
- [ ] Join community discussions (if available)
- [ ] Follow Nostr development updates

### Contribute Regularly

- [ ] Pick up issues labeled `good first issue` or `help wanted`
- [ ] Review others' PRs
- [ ] Improve documentation
- [ ] Report bugs you find

### Understand the Domain

- [ ] Learn about decentralized marketplaces
- [ ] Understand Bitcoin/Lightning payments
- [ ] Study Nostr protocol and NIPs
- [ ] Explore other Nostr apps

---

## Resources

### Official Documentation

- [Plebeian Market README](../README.md)
- [Architecture Documentation](ARCHITECTURE.md)
- [API/Events Documentation](API_EVENTS.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Deployment Guide](DEPLOYMENT.md)

### External Resources

**React & TypeScript:**

- [React 19 Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

**TanStack:**

- [TanStack Router](https://tanstack.com/router)
- [TanStack Query](https://tanstack.com/query)
- [TanStack Form](https://tanstack.com/form)
- [TanStack Store](https://tanstack.com/store)

**Nostr:**

- [Nostr Protocol](https://github.com/nostr-protocol/nostr)
- [Nostr NIPs](https://github.com/nostr-protocol/nips)
- [NDK Documentation](https://github.com/nostr-dev-kit/ndk)
- [Nostr Tools](https://github.com/nbd-wtf/nostr-tools)

**Bitcoin/Lightning:**

- [Lightning Network](https://lightning.network)
- [Bitcoin.js Library](https://github.com/bitcoinjs/bitcoinjs-lib)
- [Alby Lightning Tools](https://github.com/getAlby/lightning-tools)

**Tooling:**

- [Bun Documentation](https://bun.sh/docs)
- [Playwright Documentation](https://playwright.dev)
- [Tailwind CSS v4](https://tailwindcss.com)

---

## Troubleshooting

### Common Issues

#### App won't start

**Error**: `Failed to fetch config`

**Solution**:

1. Ensure local relay is running: `nak serve`
2. Check `.env` has correct `APP_RELAY_URL`
3. Run `bun run startup` to initialize app settings

#### Type errors

**Error**: TypeScript compilation errors

**Solution**:

1. Run `bun install` to ensure dependencies are installed
2. Check `tsconfig.json` is correct
3. Restart TypeScript server in your editor

#### Route not found

**Error**: 404 on route navigation

**Solution**:

1. Ensure `bun run watch-routes` is running
2. Check route file naming follows conventions
3. Verify `src/routeTree.gen.ts` was regenerated

#### NDK connection issues

**Error**: `Failed to connect to relay`

**Solution**:

1. Check relay URL is correct in `.env`
2. Verify relay is running and accessible
3. Check browser console for WebSocket errors
4. Try alternative relays from `src/lib/constants.ts`

### Getting Help

If you're stuck:

1. **Check documentation** in `.claude/` directory
2. **Search existing issues** on GitHub
3. **Ask in GitHub Discussions** (if available)
4. **Tag maintainers** in your PR/issue with specific questions
5. **Join community chat** (Telegram/Discord if available)

---

## Checklist Summary

By the end of your first week, you should have:

- [ ] Successfully set up development environment
- [ ] Run the app locally with test data
- [ ] Read core documentation
- [ ] Understood project structure and patterns
- [ ] Made your first code contribution (even if small)
- [ ] Created at least one pull request
- [ ] Learned basics of TanStack Router and Query
- [ ] Published a test Nostr event

**Congratulations! You're now ready to contribute to Plebeian Market! 🎉**

---

## Next Steps

Once you're comfortable with the basics:

1. **Pick up a medium-complexity issue** from the roadmap
2. **Implement a new feature** (with guidance)
3. **Improve test coverage** by writing E2E tests
4. **Enhance documentation** where you found gaps
5. **Help onboard other new contributors**

---

**Welcome to the team! We're excited to have you contribute to building a decentralized, censorship-resistant marketplace.**

---

**Last Updated**: 2025-11-20
**Maintained By**: Plebeian Market Team
