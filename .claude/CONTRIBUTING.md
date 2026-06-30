# Contributing to Plebeian Market

Thank you for your interest in contributing to Plebeian Market! This guide will help you get started with development and understand our contribution workflow.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Code Standards](#code-standards)
5. [Testing](#testing)
6. [Commit Guidelines](#commit-guidelines)
7. [Pull Request Process](#pull-request-process)
8. [Issue Guidelines](#issue-guidelines)
9. [Community](#community)

---

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on what is best for the community
- Show empathy towards other community members
- Accept constructive criticism gracefully

### Unacceptable Behavior

- Harassment, trolling, or derogatory comments
- Publishing others' private information
- Spam or excessive self-promotion
- Any conduct which could reasonably be considered inappropriate

---

## Getting Started

### Prerequisites

Before you begin, ensure you have installed:

- **Bun** v1.2.4 or higher ([installation guide](https://bun.sh/docs/installation))
- **Git** for version control
- **Node.js** v18+ (for some tooling compatibility)
- A **Nostr client** or browser extension (for testing)

### Initial Setup

1. **Fork the repository**

   Click the "Fork" button on [GitHub](https://github.com/PlebianApp/market)

2. **Clone your fork**

   ```bash
   git clone https://github.com/YOUR_USERNAME/market.git
   cd market
   ```

3. **Add upstream remote**

   ```bash
   git remote add upstream https://github.com/PlebianApp/market.git
   ```

4. **Install dependencies**

   ```bash
   bun install
   ```

5. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:

   ```env
   APP_RELAY_URL=ws://localhost:10547
   APP_PRIVATE_KEY=your_test_hex_key
   NIP46_RELAY_URL=wss://relay.nsec.app
   ```

6. **Start a local relay**

   We recommend using [nak](https://github.com/fiatjaf/nak):

   ```bash
   # Install nak (requires Go)
   go install github.com/fiatjaf/nak@latest

   # Start local relay
   nak serve
   ```

7. **Initialize app settings**

   ```bash
   bun run startup
   ```

8. **Seed test data (optional)**

   ```bash
   bun run seed
   ```

9. **Start development servers**

   Terminal 1:

   ```bash
   bun run watch-routes
   ```

   Terminal 2:

   ```bash
   bun dev
   ```

10. **Open the app**

    Navigate to `http://localhost:3000`

---

## Development Workflow

### Branching Strategy

We use a simplified Git Flow:

- `master`: Production-ready code
- `develop`: Integration branch (if used)
- `feature/xyz`: New features
- `fix/xyz`: Bug fixes
- `refactor/xyz`: Code refactoring
- `docs/xyz`: Documentation updates

### Creating a Branch

```bash
# Update your local master
git checkout master
git pull upstream master

# Create a feature branch
git checkout -b feature/your-feature-name
```

### Making Changes

1. **Make small, focused commits**

   Each commit should represent a single logical change.

2. **Test your changes**

   ```bash
   # Run type checking
   bun run build

   # Run E2E tests
   bun run test:e2e

   # Manual testing
   bun dev
   ```

3. **Keep your branch updated**

   ```bash
   git fetch upstream
   git rebase upstream/master
   ```

### Submitting Changes

1. **Push your branch**

   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request**
   - Go to your fork on GitHub
   - Click "Compare & pull request"
   - Fill out the PR template
   - Link related issues

---

## Code Standards

### TypeScript

- **Strict mode enabled**: All code must pass TypeScript strict checks
- **Explicit types**: Avoid `any`, use proper typing
- **Type imports**: Use `import type` for type-only imports

```typescript
// Good
import type { Product } from '@/lib/schemas/product'
import { fetchProducts } from '@/queries/products'

// Bad
import { Product } from '@/lib/schemas/product' // Runtime import for type
```

### Formatting

We use **Prettier** with the following configuration:

```json
{
	"semi": false,
	"useTabs": true,
	"singleQuote": true,
	"tabWidth": 2,
	"printWidth": 140
}
```

**Format before committing:**

```bash
bun run format
```

**Check formatting:**

```bash
bun run format:check
```

### Naming Conventions

| Type             | Convention                  | Example                                 |
| ---------------- | --------------------------- | --------------------------------------- |
| Components       | PascalCase                  | `ProductCard.tsx`                       |
| Hooks            | camelCase with `use` prefix | `useProductQuery.ts`                    |
| Utilities        | camelCase                   | `formatPrice.ts`                        |
| Constants        | UPPER_SNAKE_CASE            | `DEFAULT_CURRENCY`                      |
| Types/Interfaces | PascalCase                  | `type ProductData = ...`                |
| Files            | kebab-case or PascalCase    | `product-list.tsx` or `ProductList.tsx` |

### Component Structure

```typescript
// 1. Imports (external, then internal)
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { Product } from '@/lib/schemas/product'
import { ProductCard } from '@/components/ProductCard'
import { cn } from '@/lib/utils'

// 2. Types
type ProductListProps = {
	products: Product[]
	variant?: 'grid' | 'list'
	onProductClick?: (product: Product) => void
}

// 3. Component
export function ProductList({
	products,
	variant = 'grid',
	onProductClick,
}: ProductListProps) {
	// Hooks at the top
	const [selectedId, setSelectedId] = useState<string | null>(null)

	// Derived state
	const selectedProduct = products.find(p => p.id === selectedId)

	// Event handlers
	const handleProductClick = (product: Product) => {
		setSelectedId(product.id)
		onProductClick?.(product)
	}

	// Early returns
	if (!products.length) {
		return <EmptyState />
	}

	// Main render
	return (
		<div className={cn('product-list', `product-list--${variant}`)}>
			{products.map(product => (
				<ProductCard
					key={product.id}
					product={product}
					isSelected={product.id === selectedId}
					onClick={() => handleProductClick(product)}
				/>
			))}
		</div>
	)
}
```

### React Patterns

**Use functional components:**

```typescript
// Good
export function MyComponent() {
	return <div>Hello</div>
}

// Avoid
export class MyComponent extends React.Component {
	render() {
		return <div>Hello</div>
	}
}
```

### TanStack Query Patterns

**Query key factories:**

```typescript
// src/queries/products.tsx
export const productKeys = {
	all: ['products'] as const,
	lists: () => [...productKeys.all, 'list'] as const,
	list: (filters: ProductFilters) => [...productKeys.lists(), filters] as const,
	details: (id: string) => [...productKeys.all, id] as const,
}
```

---

## Testing

### E2E Testing (Playwright)

We use Playwright for end-to-end testing.

**Running tests:**

```bash
# Headless mode
bun run test:e2e

# Headed mode (see browser)
bun run test:e2e:headed

# UI mode (interactive)
bun run test:e2e:ui
```

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (deps, config, etc.)

### Examples

```bash
# Feature
feat(products): add product image carousel

# Bug fix
fix(checkout): resolve payment amount calculation error

# Documentation
docs(readme): update installation instructions
```

---

## Pull Request Process

### Before Submitting

1. ✅ Code follows style guidelines
2. ✅ Code is properly formatted (`bun run format`)
3. ✅ No TypeScript errors (`bun run build`)
4. ✅ Tests pass (`bun run test:e2e`)
5. ✅ Branch is up to date with `master`
6. ✅ Commits follow commit guidelines

---

## Issue Guidelines

### Bug Reports

Include:

- Clear description of the bug
- Steps to reproduce
- Expected behavior
- Screenshots (if applicable)
- Environment details (OS, browser, version)

### Feature Requests

Include:

- Feature description
- Use case and problem it solves
- Proposed solution
- Alternatives considered

---

## Community

### Communication Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: General questions, ideas

### Getting Help

- Check [README.md](../README.md)
- Read [ARCHITECTURE.md](ARCHITECTURE.md)
- Ask in GitHub Discussions

---

**Thank you for contributing to Plebeian Market!**

---

**Last Updated**: 2025-11-20
**Maintained By**: Plebeian Market Team
