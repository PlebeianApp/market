# TypeScript Quick Reference

Quick lookup guide for common TypeScript patterns and syntax.

## Basic Types

```typescript
// Primitives
string, number, boolean, null, undefined, symbol, bigint

// Special types
any         // Avoid - disables type checking
unknown     // Type-safe alternative to any
void        // No return value
never       // Never returns

// Arrays
number[]
Array<string>
readonly number[]

// Tuples
[string, number]
[x: number, y: number]

// Objects
{ name: string; age: number }
Record<string, number>
```

## Type Declarations

```typescript
// Interface
interface User {
	id: string
	name: string
	age?: number // Optional
	readonly createdAt: Date // Readonly
}

// Type alias
type Status = 'idle' | 'loading' | 'success' | 'error'
type ID = string | number
type Point = { x: number; y: number }

// Function type
type Callback = (data: string) => void
type MathOp = (a: number, b: number) => number
```

## Union & Intersection

```typescript
// Union (OR)
string | number
type Result = Success | Error

// Intersection (AND)
A & B
type Combined = User & Timestamped

// Discriminated union
type State = { status: 'idle' } | { status: 'loading' } | { status: 'success'; data: Data } | { status: 'error'; error: Error }
```

## Generics

```typescript
// Generic function
function identity<T>(value: T): T

// Generic interface
interface Box<T> {
	value: T
}

// Generic with constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K]

// Multiple type parameters
function merge<T, U>(a: T, b: U): T & U

// Default type parameter
interface Response<T = unknown> {
	data: T
}
```

## Utility Types

```typescript
Partial<T> // Make all optional
Required<T> // Make all required
Readonly<T> // Make all readonly
Pick<T, K> // Select properties
Omit<T, K> // Exclude properties
Record<K, T> // Object with specific keys
Exclude<T, U> // Remove from union
Extract<T, U> // Extract from union
NonNullable<T> // Remove null/undefined
ReturnType<T> // Get function return type
Parameters<T> // Get function parameters
Awaited<T> // Unwrap Promise
```

## Type Guards

```typescript
// typeof
if (typeof value === 'string') {
}

// instanceof
if (error instanceof Error) {
}

// in operator
if ('property' in object) {
}

// Custom type guard
function isUser(value: unknown): value is User {
	return typeof value === 'object' && value !== null && 'id' in value
}

// Assertion function
function assertIsString(value: unknown): asserts value is string {
	if (typeof value !== 'string') throw new Error()
}
```

## Advanced Types

```typescript
// Conditional types
type IsString<T> = T extends string ? true : false

// Mapped types
type Nullable<T> = { [K in keyof T]: T[K] | null }

// Template literal types
type EventName<T extends string> = `on${Capitalize<T>}`

// Key remapping
type Getters<T> = {
	[K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

// infer keyword
type Flatten<T> = T extends Array<infer U> ? U : T
```

## Functions

```typescript
// Function declaration
function add(a: number, b: number): number {
	return a + b
}

// Arrow function
const subtract = (a: number, b: number): number => a - b

// Optional parameters
function greet(name: string, greeting?: string): string {}

// Default parameters
function create(name: string, role = 'user'): User {}

// Rest parameters
function sum(...numbers: number[]): number {}

// Overloads
function format(value: string): string
function format(value: number): string
function format(value: string | number): string {}
```

## Classes

```typescript
class User {
	// Properties
	private id: string
	public name: string
	protected age: number
	readonly createdAt: Date

	// Constructor
	constructor(name: string) {
		this.name = name
		this.createdAt = new Date()
	}

	// Methods
	greet(): string {
		return `Hello, ${this.name}`
	}

	// Static
	static create(name: string): User {
		return new User(name)
	}

	// Getters/Setters
	get displayName(): string {
		return this.name.toUpperCase()
	}
}

// Inheritance
class Admin extends User {
	constructor(
		name: string,
		public permissions: string[],
	) {
		super(name)
	}
}

// Abstract class
abstract class Animal {
	abstract makeSound(): void
}
```

## React Patterns

```typescript
// Component props
interface ButtonProps {
	variant?: 'primary' | 'secondary'
	onClick?: () => void
	children: React.ReactNode
}

export function Button({ variant = 'primary', onClick, children }: ButtonProps) {}

// Generic component
interface ListProps<T> {
	items: T[]
	renderItem: (item: T) => React.ReactNode
}

export function List<T>({ items, renderItem }: ListProps<T>) {}

// Hooks
const [state, setState] = useState<string>('')
const [data, setData] = useState<User | null>(null)

// Context
interface AuthContextType {
	user: User | null
	login: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth(): AuthContextType {
	const context = useContext(AuthContext)
	if (!context) throw new Error('useAuth must be used within AuthProvider')
	return context
}
```

## Common Patterns

### Result Type

```typescript
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }
```

### Option Type

```typescript
type Option<T> = Some<T> | None
interface Some<T> {
	_tag: 'Some'
	value: T
}
interface None {
	_tag: 'None'
}
```

### Branded Types

```typescript
type Brand<K, T> = K & { __brand: T }
type UserId = Brand<string, 'UserId'>
```

### Named Returns (Go-style)

```typescript
function parseJSON(json: string): { data: unknown | null; err: Error | null } {
	let data: unknown | null = null
	let err: Error | null = null

	try {
		data = JSON.parse(json)
	} catch (error) {
		err = error instanceof Error ? error : new Error(String(error))
	}

	return { data, err }
}
```

## Type Assertions

```typescript
// as syntax (preferred)
const value = input as string

// Angle bracket syntax (not in JSX)
const value = <string>input

// as const
const config = { host: 'localhost' } as const

// Non-null assertion (use sparingly)
const element = document.getElementById('app')!
```

## Type Narrowing

```typescript
// Control flow
if (value !== null) {
	// value is non-null here
}

// Switch with discriminated unions
switch (state.status) {
	case 'success':
		console.log(state.data) // TypeScript knows data exists
		break
	case 'error':
		console.log(state.error) // TypeScript knows error exists
		break
}

// Optional chaining
user?.profile?.name

// Nullish coalescing
const name = user?.name ?? 'Anonymous'
```

## Module Syntax

```typescript
// Named exports
export function helper() {}
export const CONFIG = {}

// Default export
export default class App {}

// Type-only imports/exports
import type { User } from './types'
export type { User }

// Namespace imports
import * as utils from './utils'
```

## TSConfig Essentials

```json
{
	"compilerOptions": {
		"strict": true,
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"jsx": "react-jsx",
		"esModuleInterop": true,
		"skipLibCheck": true,
		"resolveJsonModule": true
	}
}
```

## Common Errors & Fixes

| Error                                  | Fix                                                    |
| -------------------------------------- | ------------------------------------------------------ |
| Type 'X' is not assignable to type 'Y' | Check type compatibility, use type assertion if needed |
| Object is possibly 'null'              | Use optional chaining `?.` or null check               |
| Cannot find module                     | Install `@types/package-name`                          |
| Implicit any                           | Add type annotation or enable strict mode              |
| Property does not exist                | Check object shape, use type guard                     |

## Best Practices

1. Enable `strict` mode in tsconfig.json
2. Avoid `any`, use `unknown` instead
3. Use discriminated unions for state
4. Leverage type inference
5. Use `const` assertions for immutable data
6. Create custom type guards for runtime safety
7. Use utility types instead of recreating
8. Document complex types with JSDoc
9. Prefer interfaces for objects, types for unions
10. Use branded types for domain-specific primitives
