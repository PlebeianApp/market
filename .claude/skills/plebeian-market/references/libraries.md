# Libraries and Versions

## Core Dependencies

### Runtime & Framework

- **Runtime:** Bun (latest)
- **React:** 19.1.0
- **React DOM:** 19.1.0
- **TypeScript:** Via @types/bun ^1.2.17

### Routing

- **@tanstack/react-router:** ^1.124.0
- **@tanstack/router-cli:** ^1.124.0 (for route generation)
- **@tanstack/router-plugin:** ^1.124.0
- **@tanstack/react-router-devtools:** ^1.124.0 (dev only)

### State Management

- **@tanstack/react-store:** ^0.7.1
- **@tanstack/react-query:** ^5.81.5

### Form Management

- **@tanstack/react-form:** ^1.12.4
- **@hookform/resolvers:** ^5.1.1
- **zod:** ^3.25.67 (validation)

### UI Components (shadcn/ui stack)

- **@radix-ui/react-accordion:** ^1.2.11
- **@radix-ui/react-avatar:** ^1.1.10
- **@radix-ui/react-checkbox:** ^1.3.2
- **@radix-ui/react-dialog:** ^1.1.14
- **@radix-ui/react-dropdown-menu:** ^2.1.15
- **@radix-ui/react-label:** ^2.1.7
- **@radix-ui/react-select:** ^2.2.5
- **@radix-ui/react-tabs:** ^1.1.12
- **@radix-ui/react-tooltip:** ^1.2.7
- **@radix-ui/react-slot:** ^1.2.3
- ...and other Radix UI primitives

### Styling

- **tailwindcss:** ^4.1.11
- **tailwindcss-animate:** ^1.0.7
- **bun-plugin-tailwind:** ^0.0.15
- **class-variance-authority:** ^0.7.1 (CVA for variants)
- **clsx:** ^2.1.1
- **tailwind-merge:** ^3.3.1

### Nostr Protocol

- **@nostr-dev-kit/ndk:** 2.15.2 (core NDK)
- **@nostr-dev-kit/ndk-cache-dexie:** 2.6.33 (IndexedDB cache)
- **@nostr-dev-kit/ndk-wallet:** ^0.6.2
- **@nostr-dev-kit/sessions:** ^0.3.1
- **@nostr-dev-kit/blossom:** ^7.0.0
- **nostr-tools:** ^2.15.0

### Lightning/Bitcoin

- **@getalby/lightning-tools:** ^6.0.0
- **alby-tools:** ^3.2.1
- **bitcoinjs-lib:** ^6.1.7
- **bs58check:** ^4.0.0

### Icons & Media

- **lucide-react:** ^0.525.0 (icon library)
- **qrcode.react:** ^4.2.0
- **@yudiel/react-qr-scanner:** ^2.3.1
- **html-to-image:** ^1.11.13

### Utilities

- **date-fns:** ^4.1.0 (date manipulation)
- **react-use:** ^17.6.0 (hook utilities)
- **use-debounce:** ^10.0.5
- **uuid:** ^11.1.0
- **sonner:** ^2.0.5 (toast notifications)
- **next-themes:** ^0.4.6 (theme management)
- **@formkit/auto-animate:** ^0.8.2 (animations)
- **embla-carousel-react:** ^8.6.0 (carousels)
- **vaul:** ^1.1.2 (drawer component)

### Testing

- **playwright:** ^1.53.2
- **@playwright/test:** ^1.53.2

### Development

- **prettier:** ^3.6.2
- **@types/react:** ^19.1.8
- **@types/react-dom:** ^19.1.6

## Version Policy

- Use exact versions (not semver ranges) where stability is critical
- NDK packages use specific versions to avoid breaking changes
- UI libraries use caret ranges for minor updates
- React 19 with concurrent features enabled

## Package Manager

Use **Bun** for all package management:

```bash
bun install <package>
bun add <package>
bun remove <package>
```

## Important Notes

1. **React 19:** Uses new concurrent features and hooks
2. **TanStack Router v1:** File-based routing requires CLI for route generation
3. **NDK:** Core library for Nostr protocol interactions
4. **Radix UI:** Accessible component primitives, styled with Tailwind
5. **Tailwind v4:** Uses new @theme directive instead of tailwind.config.js
