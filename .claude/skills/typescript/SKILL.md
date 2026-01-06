---
name: typescript
description: This skill should be used when working with TypeScript code, including type definitions, type inference, generics, utility types, and TypeScript configuration. Provides comprehensive knowledge of TypeScript patterns, best practices, and advanced type system features.
---

# TypeScript Skill

This skill provides comprehensive knowledge and patterns for working with TypeScript effectively in modern applications.

## When to Use This Skill

Use this skill when:

- Writing or refactoring TypeScript code
- Designing type-safe APIs and interfaces
- Working with advanced type system features (generics, conditional types, mapped types)
- Configuring TypeScript projects (tsconfig.json)
- Troubleshooting type errors
- Implementing type-safe patterns with libraries (React, TanStack, etc.)
- Converting JavaScript code to TypeScript

## Core Concepts

### Type System Fundamentals

TypeScript provides static typing for JavaScript with a powerful type system that includes:

- Primitive types (string, number, boolean, null, undefined, symbol, bigint)
- Object types (interfaces, type aliases, classes)
- Array and tuple types
- Union and intersection types
- Literal types and template literal types
- Type inference and type narrowing
- Generic types with constraints
- Conditional types and mapped types

### Type Inference

Leverage TypeScript's type inference to write less verbose code:

- Let TypeScript infer return types when obvious
- Use type inference for variable declarations
- Rely on generic type inference in function calls
- Use `as const` for immutable literal types

### Type Safety Patterns

Implement type-safe patterns:

- Use discriminated unions for state management
- Implement type guards for runtime type checking
- Use branded types for nominal typing
- Leverage conditional types for API design
- Use template literal types for string manipulation

## Key Workflows

### 1. Designing Type-Safe APIs

When designing APIs, follow these patterns:

**Interface vs Type Alias:**

- Use `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and complex type operations
- Use `type` with mapped types and conditional types

**Generic Constraints:**

```typescript
// Use extends for generic constraints
function getValue<T extends { id: string }>(item: T): string {
	return item.id
}
```

**Discriminated Unions:**

```typescript
// Use for type-safe state machines
type State = { status: 'idle' } | { status: 'loading' } | { status: 'success'; data: Data } | { status: 'error'; error: Error }
```

### 2. Working with Utility Types

Use built-in utility types for common transformations:

- `Partial<T>` - Make all properties optional
- `Required<T>` - Make all properties required
- `Readonly<T>` - Make all properties readonly
- `Pick<T, K>` - Select specific properties
- `Omit<T, K>` - Exclude specific properties
- `Record<K, T>` - Create object type with specific keys
- `Exclude<T, U>` - Exclude types from union
- `Extract<T, U>` - Extract types from union
- `NonNullable<T>` - Remove null/undefined
- `ReturnType<T>` - Get function return type
- `Parameters<T>` - Get function parameter types
- `Awaited<T>` - Unwrap Promise type

### 3. Advanced Type Patterns

**Mapped Types:**

```typescript
// Transform object types
type Nullable<T> = {
	[K in keyof T]: T[K] | null
}

type ReadonlyDeep<T> = {
	readonly [K in keyof T]: T[K] extends object ? ReadonlyDeep<T[K]> : T[K]
}
```

**Conditional Types:**

```typescript
// Type-level logic
type IsArray<T> = T extends Array<any> ? true : false

type Flatten<T> = T extends Array<infer U> ? U : T
```

**Template Literal Types:**

```typescript
// String manipulation at type level
type EventName<T extends string> = `on${Capitalize<T>}`
type Route = `/api/${'users' | 'posts'}/${string}`
```

### 4. Type Narrowing

Use type guards and narrowing techniques:

**typeof guards:**

```typescript
if (typeof value === 'string') {
	// value is string here
}
```

**instanceof guards:**

```typescript
if (error instanceof Error) {
	// error is Error here
}
```

**Custom type guards:**

```typescript
function isUser(value: unknown): value is User {
	return typeof value === 'object' && value !== null && 'id' in value
}
```

**Discriminated unions:**

```typescript
function handle(state: State) {
	switch (state.status) {
		case 'idle':
			// state is { status: 'idle' }
			break
		case 'success':
			// state is { status: 'success'; data: Data }
			console.log(state.data)
			break
	}
}
```

### 5. Working with External Libraries

**Typing Third-Party Libraries:**

- Install type definitions: `npm install --save-dev @types/package-name`
- Create custom declarations in `.d.ts` files when types unavailable
- Use module augmentation to extend existing type definitions

**Declaration Files:**

```typescript
// globals.d.ts
declare global {
	interface Window {
		myCustomProperty: string
	}
}

export {}
```

### 6. TypeScript Configuration

Configure `tsconfig.json` for strict type checking:

**Essential Strict Options:**

```json
{
	"compilerOptions": {
		"strict": true,
		"noImplicitAny": true,
		"strictNullChecks": true,
		"strictFunctionTypes": true,
		"strictBindCallApply": true,
		"strictPropertyInitialization": true,
		"noImplicitThis": true,
		"alwaysStrict": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noImplicitReturns": true,
		"noFallthroughCasesInSwitch": true,
		"skipLibCheck": true
	}
}
```

## Best Practices

### 1. Prefer Type Inference Over Explicit Types

Let TypeScript infer types when they're obvious from context.

### 2. Use Strict Mode

Enable strict type checking to catch more errors at compile time.

### 3. Avoid `any` Type

Use `unknown` for truly unknown types, then narrow with type guards.

### 4. Use Const Assertions

Use `as const` for immutable values and narrow literal types.

### 5. Leverage Discriminated Unions

Use for state machines and variant types for better type safety.

### 6. Create Reusable Generic Types

Extract common type patterns into reusable generics.

### 7. Use Branded Types for Nominal Typing

Create distinct types for values with same structure but different meaning.

### 8. Document Complex Types

Add JSDoc comments to explain non-obvious type decisions.

### 9. Use Type-Only Imports

Use `import type` for type-only imports to aid tree-shaking.

### 10. Handle Errors with Type Guards

Use type guards to safely work with error objects.

## Common Patterns

### React Component Props

```typescript
// Use interface for component props
interface ButtonProps {
	variant?: 'primary' | 'secondary'
	size?: 'sm' | 'md' | 'lg'
	onClick?: () => void
	children: React.ReactNode
}

export function Button({ variant = 'primary', size = 'md', onClick, children }: ButtonProps) {
	// implementation
}
```

### API Response Types

```typescript
// Use discriminated unions for API responses
type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }

// Helper for safe API calls
async function fetchData<T>(url: string): Promise<ApiResponse<T>> {
	try {
		const response = await fetch(url)
		const data = await response.json()
		return { success: true, data }
	} catch (error) {
		return { success: false, error: String(error) }
	}
}
```

### Store/State Types

```typescript
// Use interfaces for state objects
interface AppState {
	user: User | null
	isAuthenticated: boolean
	theme: 'light' | 'dark'
}

// Use type for actions (discriminated union)
type AppAction = { type: 'LOGIN'; payload: User } | { type: 'LOGOUT' } | { type: 'SET_THEME'; payload: 'light' | 'dark' }
```

## References

For detailed information on specific topics, refer to:

- `references/type-system.md` - Deep dive into TypeScript's type system
- `references/utility-types.md` - Complete guide to built-in utility types
- `references/advanced-types.md` - Advanced type patterns and techniques
- `references/tsconfig-reference.md` - Comprehensive tsconfig.json reference
- `references/common-patterns.md` - Common TypeScript patterns and idioms
- `examples/` - Practical code examples

## Troubleshooting

### Common Type Errors

**Type 'X' is not assignable to type 'Y':**

- Check if types are compatible
- Use type assertions when you know better than the compiler
- Consider using union types or widening the target type

**Object is possibly 'null' or 'undefined':**

- Use optional chaining: `object?.property`
- Use nullish coalescing: `value ?? defaultValue`
- Add type guards or null checks

**Type 'any' implicitly has...**

- Enable strict mode and fix type definitions
- Add explicit type annotations
- Use `unknown` instead of `any` when appropriate

**Cannot find module or its type declarations:**

- Install type definitions: `@types/package-name`
- Create custom `.d.ts` declaration file
- Add to `types` array in tsconfig.json

## Integration with Project Stack

### React 19

Use TypeScript with React 19 features:

- Type component props with interfaces
- Use generic types for hooks
- Type context providers properly
- Use `React.FC` sparingly (prefer explicit typing)

### TanStack Ecosystem

Type TanStack libraries properly:

- TanStack Query: Type query keys and data
- TanStack Router: Use typed route definitions
- TanStack Form: Type form values and validation
- TanStack Store: Type state and actions

### Zod Integration

Combine Zod with TypeScript:

- Use `z.infer<typeof schema>` to extract types from schemas
- Let Zod handle runtime validation
- Use TypeScript for compile-time type checking

## Resources

The TypeScript documentation provides comprehensive information:

- Handbook: https://www.typescriptlang.org/docs/handbook/
- Type manipulation: https://www.typescriptlang.org/docs/handbook/2/types-from-types.html
- Utility types: https://www.typescriptlang.org/docs/handbook/utility-types.html
- TSConfig reference: https://www.typescriptlang.org/tsconfig
