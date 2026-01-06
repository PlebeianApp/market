# TypeScript Utility Types Reference

TypeScript provides several built-in utility types that help transform and manipulate types. These are implemented using advanced type features like mapped types and conditional types.

## Property Modifiers

### Partial\<T\>

Makes all properties in `T` optional.

```typescript
interface User {
	id: string
	name: string
	email: string
	age: number
}

type PartialUser = Partial<User>
// {
//   id?: string
//   name?: string
//   email?: string
//   age?: number
// }

// Useful for update operations
function updateUser(id: string, updates: Partial<User>) {
	// Only update provided fields
}

updateUser('123', { name: 'Alice' }) // OK
updateUser('123', { name: 'Alice', age: 30 }) // OK
```

### Required\<T\>

Makes all properties in `T` required (removes optionality).

```typescript
interface Config {
	host?: string
	port?: number
	timeout?: number
}

type RequiredConfig = Required<Config>
// {
//   host: string
//   port: number
//   timeout: number
// }

function initServer(config: RequiredConfig) {
	// All properties are guaranteed to exist
	console.log(config.host, config.port, config.timeout)
}
```

### Readonly\<T\>

Makes all properties in `T` readonly.

```typescript
interface MutablePoint {
	x: number
	y: number
}

type ImmutablePoint = Readonly<MutablePoint>
// {
//   readonly x: number
//   readonly y: number
// }

const point: ImmutablePoint = { x: 0, y: 0 }
// point.x = 10 // Error: Cannot assign to 'x' because it is a read-only property
```

### Mutable\<T\> (Custom)

Removes readonly modifiers (not built-in, but useful pattern).

```typescript
type Mutable<T> = {
	-readonly [K in keyof T]: T[K]
}

interface ReadonlyPerson {
	readonly name: string
	readonly age: number
}

type MutablePerson = Mutable<ReadonlyPerson>
// {
//   name: string
//   age: number
// }
```

## Property Selection

### Pick\<T, K\>

Creates a type by picking specific properties from `T`.

```typescript
interface User {
	id: string
	name: string
	email: string
	password: string
	createdAt: Date
}

type UserProfile = Pick<User, 'id' | 'name' | 'email'>
// {
//   id: string
//   name: string
//   email: string
// }

// Useful for API responses
function getUserProfile(id: string): UserProfile {
	// Return only safe properties
}
```

### Omit\<T, K\>

Creates a type by omitting specific properties from `T`.

```typescript
interface User {
	id: string
	name: string
	email: string
	password: string
}

type UserWithoutPassword = Omit<User, 'password'>
// {
//   id: string
//   name: string
//   email: string
// }

// Useful for public user data
function publishUser(user: User): UserWithoutPassword {
	const { password, ...publicData } = user
	return publicData
}
```

## Union Type Utilities

### Exclude\<T, U\>

Excludes types from `T` that are assignable to `U`.

```typescript
type T1 = Exclude<'a' | 'b' | 'c', 'a'> // "b" | "c"
type T2 = Exclude<string | number | boolean, boolean> // string | number

type EventType = 'click' | 'scroll' | 'mousemove' | 'keypress'
type UIEvent = Exclude<EventType, 'scroll'> // "click" | "mousemove" | "keypress"
```

### Extract\<T, U\>

Extracts types from `T` that are assignable to `U`.

```typescript
type T1 = Extract<'a' | 'b' | 'c', 'a' | 'f'> // "a"
type T2 = Extract<string | number | boolean, boolean> // boolean

type Shape = 'circle' | 'square' | 'triangle' | 'rectangle'
type RoundedShape = Extract<Shape, 'circle'> // "circle"
```

### NonNullable\<T\>

Excludes `null` and `undefined` from `T`.

```typescript
type T1 = NonNullable<string | null | undefined> // string
type T2 = NonNullable<string | number | null> // string | number

function processValue(value: string | null | undefined) {
	if (value !== null && value !== undefined) {
		const nonNull: NonNullable<typeof value> = value
		// nonNull is guaranteed to be string
	}
}
```

## Object Construction

### Record\<K, T\>

Constructs an object type with keys of type `K` and values of type `T`.

```typescript
type PageInfo = Record<string, number>
// { [key: string]: number }

const pages: PageInfo = {
	home: 1,
	about: 2,
	contact: 3,
}

// Useful for mapped objects
type UserRole = 'admin' | 'user' | 'guest'
type RolePermissions = Record<UserRole, string[]>

const permissions: RolePermissions = {
	admin: ['read', 'write', 'delete'],
	user: ['read', 'write'],
	guest: ['read'],
}

// With specific keys
type ThemeColors = Record<'primary' | 'secondary' | 'accent', string>

const colors: ThemeColors = {
	primary: '#007bff',
	secondary: '#6c757d',
	accent: '#28a745',
}
```

## Function Utilities

### Parameters\<T\>

Extracts the parameter types of a function type as a tuple.

```typescript
function createUser(name: string, age: number, email: string) {
	// ...
}

type CreateUserParams = Parameters<typeof createUser>
// [name: string, age: number, email: string]

// Useful for higher-order functions
function withLogging<T extends (...args: any[]) => any>(fn: T, ...args: Parameters<T>): ReturnType<T> {
	console.log('Calling with:', args)
	return fn(...args)
}
```

### ConstructorParameters\<T\>

Extracts the parameter types of a constructor function type.

```typescript
class User {
	constructor(
		public name: string,
		public age: number,
	) {}
}

type UserConstructorParams = ConstructorParameters<typeof User>
// [name: string, age: number]

function createUser(...args: UserConstructorParams): User {
	return new User(...args)
}
```

### ReturnType\<T\>

Extracts the return type of a function type.

```typescript
function createUser() {
	return {
		id: '123',
		name: 'Alice',
		email: 'alice@example.com',
	}
}

type User = ReturnType<typeof createUser>
// {
//   id: string
//   name: string
//   email: string
// }

// Useful with async functions
async function fetchData() {
	return { success: true, data: [1, 2, 3] }
}

type FetchResult = ReturnType<typeof fetchData>
// Promise<{ success: boolean; data: number[] }>

type UnwrappedResult = Awaited<FetchResult>
// { success: boolean; data: number[] }
```

### InstanceType\<T\>

Extracts the instance type of a constructor function type.

```typescript
class User {
	name: string
	constructor(name: string) {
		this.name = name
	}
}

type UserInstance = InstanceType<typeof User>
// User

function processUser(user: UserInstance) {
	console.log(user.name)
}
```

### ThisParameterType\<T\>

Extracts the type of the `this` parameter for a function type.

```typescript
function toHex(this: Number) {
	return this.toString(16)
}

type ThisType = ThisParameterType<typeof toHex> // Number
```

### OmitThisParameter\<T\>

Removes the `this` parameter from a function type.

```typescript
function toHex(this: Number) {
	return this.toString(16)
}

type PlainFunction = OmitThisParameter<typeof toHex>
// () => string
```

## String Manipulation

### Uppercase\<S\>

Converts string literal type to uppercase.

```typescript
type Greeting = 'hello'
type LoudGreeting = Uppercase<Greeting> // "HELLO"

// Useful for constants
type HttpMethod = 'get' | 'post' | 'put' | 'delete'
type HttpMethodUppercase = Uppercase<HttpMethod>
// "GET" | "POST" | "PUT" | "DELETE"
```

### Lowercase\<S\>

Converts string literal type to lowercase.

```typescript
type Greeting = 'HELLO'
type QuietGreeting = Lowercase<Greeting> // "hello"
```

### Capitalize\<S\>

Capitalizes the first letter of a string literal type.

```typescript
type Event = 'click' | 'scroll' | 'mousemove'
type EventHandler = `on${Capitalize<Event>}`
// "onClick" | "onScroll" | "onMousemove"
```

### Uncapitalize\<S\>

Uncapitalizes the first letter of a string literal type.

```typescript
type Greeting = 'Hello'
type LowerGreeting = Uncapitalize<Greeting> // "hello"
```

## Async Utilities

### Awaited\<T\>

Unwraps the type of a Promise (recursively).

```typescript
type T1 = Awaited<Promise<string>> // string
type T2 = Awaited<Promise<Promise<number>>> // number
type T3 = Awaited<boolean | Promise<string>> // boolean | string

// Useful with async functions
async function fetchUser() {
	return { id: '123', name: 'Alice' }
}

type User = Awaited<ReturnType<typeof fetchUser>>
// { id: string; name: string }
```

## Custom Utility Types

### DeepPartial\<T\>

Makes all properties and nested properties optional.

```typescript
type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

interface User {
	id: string
	profile: {
		name: string
		address: {
			street: string
			city: string
		}
	}
}

type PartialUser = DeepPartial<User>
// All properties at all levels are optional
```

### DeepReadonly\<T\>

Makes all properties and nested properties readonly.

```typescript
type DeepReadonly<T> = {
	readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K]
}

interface User {
	id: string
	profile: {
		name: string
		address: {
			street: string
			city: string
		}
	}
}

type ImmutableUser = DeepReadonly<User>
// All properties at all levels are readonly
```

### PartialBy\<T, K\>

Makes specific properties optional.

```typescript
type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

interface User {
	id: string
	name: string
	email: string
	age: number
}

type UserWithOptionalEmail = PartialBy<User, 'email' | 'age'>
// {
//   id: string
//   name: string
//   email?: string
//   age?: number
// }
```

### RequiredBy\<T, K\>

Makes specific properties required.

```typescript
type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

interface User {
	id?: string
	name?: string
	email?: string
}

type UserWithRequiredId = RequiredBy<User, 'id'>
// {
//   id: string
//   name?: string
//   email?: string
// }
```

### PickByType\<T, U\>

Picks properties by their value type.

```typescript
type PickByType<T, U> = {
	[K in keyof T as T[K] extends U ? K : never]: T[K]
}

interface User {
	id: string
	name: string
	age: number
	active: boolean
}

type StringProperties = PickByType<User, string>
// { id: string; name: string }

type NumberProperties = PickByType<User, number>
// { age: number }
```

### OmitByType\<T, U\>

Omits properties by their value type.

```typescript
type OmitByType<T, U> = {
	[K in keyof T as T[K] extends U ? never : K]: T[K]
}

interface User {
	id: string
	name: string
	age: number
	active: boolean
}

type NonStringProperties = OmitByType<User, string>
// { age: number; active: boolean }
```

### Prettify\<T\>

Flattens intersections for better IDE tooltips.

```typescript
type Prettify<T> = {
	[K in keyof T]: T[K]
} & {}

type A = { a: string }
type B = { b: number }
type C = A & B

type PrettyC = Prettify<C>
// Displays as: { a: string; b: number }
// Instead of: A & B
```

### ValueOf\<T\>

Gets the union of all value types.

```typescript
type ValueOf<T> = T[keyof T]

interface Colors {
	red: '#ff0000'
	green: '#00ff00'
	blue: '#0000ff'
}

type ColorValue = ValueOf<Colors>
// "#ff0000" | "#00ff00" | "#0000ff"
```

### Nullable\<T\>

Makes type nullable.

```typescript
type Nullable<T> = T | null

type NullableString = Nullable<string> // string | null
```

### Maybe\<T\>

Makes type nullable or undefined.

```typescript
type Maybe<T> = T | null | undefined

type MaybeString = Maybe<string> // string | null | undefined
```

### UnionToIntersection\<U\>

Converts union to intersection (advanced).

```typescript
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

type Union = { a: string } | { b: number }
type Intersection = UnionToIntersection<Union>
// { a: string } & { b: number }
```

## Combining Utility Types

Utility types can be composed for powerful transformations:

```typescript
// Make specific properties optional and readonly
type PartialReadonly<T, K extends keyof T> = Readonly<Pick<T, K>> & Partial<Omit<T, K>>

interface User {
	id: string
	name: string
	email: string
	password: string
}

type SafeUser = PartialReadonly<User, 'id' | 'name'>
// {
//   readonly id: string
//   readonly name: string
//   email?: string
//   password?: string
// }

// Pick and make readonly
type ReadonlyPick<T, K extends keyof T> = Readonly<Pick<T, K>>

// Omit and make required
type RequiredOmit<T, K extends keyof T> = Required<Omit<T, K>>
```

## Best Practices

1. **Use built-in utilities first** - They're well-tested and optimized
2. **Compose utilities** - Combine utilities for complex transformations
3. **Create custom utilities** - For patterns you use frequently
4. **Name utilities clearly** - Make intent obvious from the name
5. **Document complex utilities** - Add JSDoc for non-obvious transformations
6. **Test utility types** - Use type assertions to verify behavior
7. **Avoid over-engineering** - Don't create utilities for one-off uses
8. **Consider readability** - Sometimes explicit types are clearer
9. **Use Prettify** - For better IDE tooltips with intersections
10. **Leverage keyof** - For type-safe property selection
