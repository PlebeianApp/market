# TypeScript Type System Reference

## Overview

TypeScript's type system is structural (duck-typed) rather than nominal. Two types are compatible if their structure matches, regardless of their names.

## Primitive Types

### Basic Primitives

```typescript
let str: string = 'hello'
let num: number = 42
let bool: boolean = true
let nul: null = null
let undef: undefined = undefined
let sym: symbol = Symbol('key')
let big: bigint = 100n
```

### Special Types

**any** - Disables type checking (avoid when possible):

```typescript
let anything: any = 'string'
anything = 42 // OK
anything.nonExistent() // OK at compile time, error at runtime
```

**unknown** - Type-safe alternative to any (requires type checking):

```typescript
let value: unknown = 'string'
// value.toUpperCase() // Error: must narrow type first

if (typeof value === 'string') {
	value.toUpperCase() // OK after narrowing
}
```

**void** - Absence of a value (function return type):

```typescript
function log(message: string): void {
	console.log(message)
}
```

**never** - Value that never occurs (exhaustive checks, infinite loops):

```typescript
function throwError(message: string): never {
	throw new Error(message)
}

function exhaustiveCheck(value: never): never {
	throw new Error(`Unhandled case: ${value}`)
}
```

## Object Types

### Interfaces

```typescript
// Basic interface
interface User {
	id: string
	name: string
	email: string
}

// Optional properties
interface Product {
	id: string
	name: string
	description?: string // Optional
}

// Readonly properties
interface Config {
	readonly apiUrl: string
	readonly timeout: number
}

// Index signatures
interface Dictionary {
	[key: string]: string
}

// Method signatures
interface Calculator {
	add(a: number, b: number): number
	subtract(a: number, b: number): number
}

// Extending interfaces
interface Employee extends User {
	role: string
	department: string
}

// Multiple inheritance
interface Admin extends User, Employee {
	permissions: string[]
}
```

### Type Aliases

```typescript
// Basic type alias
type ID = string | number

// Object type
type Point = {
	x: number
	y: number
}

// Union type
type Status = 'idle' | 'loading' | 'success' | 'error'

// Intersection type
type Timestamped = {
	createdAt: Date
	updatedAt: Date
}

type TimestampedUser = User & Timestamped

// Function type
type Callback = (data: string) => void

// Generic type alias
type Result<T> = { success: true; data: T } | { success: false; error: string }
```

### Interface vs Type Alias

**Use interface when:**

- Defining object shapes
- Need declaration merging
- Building public API types that others might extend

**Use type when:**

- Creating unions or intersections
- Working with mapped types
- Need conditional types
- Defining primitive aliases

## Array and Tuple Types

### Arrays

```typescript
// Array syntax
let numbers: number[] = [1, 2, 3]
let strings: Array<string> = ['a', 'b', 'c']

// Readonly arrays
let immutable: readonly number[] = [1, 2, 3]
let alsoImmutable: ReadonlyArray<string> = ['a', 'b']
```

### Tuples

```typescript
// Fixed-length, mixed-type arrays
type Point = [number, number]
type NamedPoint = [x: number, y: number]

// Optional elements
type OptionalTuple = [string, number?]

// Rest elements
type StringNumberBooleans = [string, number, ...boolean[]]

// Readonly tuples
type ReadonlyPair = readonly [string, number]
```

## Union and Intersection Types

### Union Types

```typescript
// Value can be one of several types
type StringOrNumber = string | number

function format(value: StringOrNumber): string {
	if (typeof value === 'string') {
		return value
	}
	return value.toString()
}

// Discriminated unions
type Shape = { kind: 'circle'; radius: number } | { kind: 'square'; size: number } | { kind: 'rectangle'; width: number; height: number }

function area(shape: Shape): number {
	switch (shape.kind) {
		case 'circle':
			return Math.PI * shape.radius ** 2
		case 'square':
			return shape.size ** 2
		case 'rectangle':
			return shape.width * shape.height
	}
}
```

### Intersection Types

```typescript
// Combine multiple types
type Draggable = {
	drag: () => void
}

type Resizable = {
	resize: () => void
}

type UIWidget = Draggable & Resizable

const widget: UIWidget = {
	drag: () => console.log('dragging'),
	resize: () => console.log('resizing'),
}
```

## Literal Types

### String Literal Types

```typescript
type Direction = 'north' | 'south' | 'east' | 'west'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

function move(direction: Direction) {
	// direction can only be one of the four values
}
```

### Number Literal Types

```typescript
type DiceValue = 1 | 2 | 3 | 4 | 5 | 6
type PowerOfTwo = 1 | 2 | 4 | 8 | 16 | 32
```

### Boolean Literal Types

```typescript
type Yes = true
type No = false
```

### Template Literal Types

```typescript
// String manipulation at type level
type EventName<T extends string> = `on${Capitalize<T>}`
type ClickEvent = EventName<'click'> // "onClick"

// Combining literals
type Color = 'red' | 'blue' | 'green'
type Shade = 'light' | 'dark'
type ColorShade = `${Shade}-${Color}` // "light-red" | "light-blue" | ...

// Extract patterns
type EmailLocaleIDs = 'welcome_email' | 'email_heading'
type FooterLocaleIDs = 'footer_title' | 'footer_sendoff'
type AllLocaleIDs = `${EmailLocaleIDs | FooterLocaleIDs}_id`
```

## Type Inference

### Automatic Inference

```typescript
// Type inferred as string
let message = 'hello'

// Type inferred as number[]
let numbers = [1, 2, 3]

// Type inferred as { name: string; age: number }
let person = {
	name: 'Alice',
	age: 30,
}

// Return type inferred
function add(a: number, b: number) {
	return a + b // Returns number
}
```

### Const Assertions

```typescript
// Without const assertion
let colors1 = ['red', 'green', 'blue'] // Type: string[]

// With const assertion
let colors2 = ['red', 'green', 'blue'] as const // Type: readonly ["red", "green", "blue"]

// Object with const assertion
const config = {
	host: 'localhost',
	port: 8080,
} as const // All properties become readonly with literal types
```

### Type Inference in Generics

```typescript
// Generic type inference from usage
function identity<T>(value: T): T {
	return value
}

let str = identity('hello') // T inferred as string
let num = identity(42) // T inferred as number

// Multiple type parameters
function pair<T, U>(first: T, second: U): [T, U] {
	return [first, second]
}

let p = pair('hello', 42) // [string, number]
```

## Type Narrowing

### typeof Guards

```typescript
function padLeft(value: string, padding: string | number) {
	if (typeof padding === 'number') {
		// padding is number here
		return ' '.repeat(padding) + value
	}
	// padding is string here
	return padding + value
}
```

### instanceof Guards

```typescript
class Dog {
	bark() {
		console.log('Woof!')
	}
}

class Cat {
	meow() {
		console.log('Meow!')
	}
}

function makeSound(animal: Dog | Cat) {
	if (animal instanceof Dog) {
		animal.bark()
	} else {
		animal.meow()
	}
}
```

### in Operator

```typescript
type Fish = { swim: () => void }
type Bird = { fly: () => void }

function move(animal: Fish | Bird) {
	if ('swim' in animal) {
		animal.swim()
	} else {
		animal.fly()
	}
}
```

### Equality Narrowing

```typescript
function example(x: string | number, y: string | boolean) {
	if (x === y) {
		// x and y are both string here
		x.toUpperCase()
		y.toLowerCase()
	}
}
```

### Control Flow Analysis

```typescript
function example(value: string | null) {
	if (value === null) {
		return
	}
	// value is string here (null eliminated)
	console.log(value.toUpperCase())
}
```

### Type Predicates (Custom Type Guards)

```typescript
function isString(value: unknown): value is string {
	return typeof value === 'string'
}

function example(value: unknown) {
	if (isString(value)) {
		// value is string here
		console.log(value.toUpperCase())
	}
}

// More complex example
interface User {
	id: string
	name: string
}

function isUser(value: unknown): value is User {
	return (
		typeof value === 'object' &&
		value !== null &&
		'id' in value &&
		'name' in value &&
		typeof (value as User).id === 'string' &&
		typeof (value as User).name === 'string'
	)
}
```

### Assertion Functions

```typescript
function assert(condition: unknown, message?: string): asserts condition {
	if (!condition) {
		throw new Error(message || 'Assertion failed')
	}
}

function assertIsString(value: unknown): asserts value is string {
	if (typeof value !== 'string') {
		throw new Error('Value must be a string')
	}
}

function example(value: unknown) {
	assertIsString(value)
	// value is string here
	console.log(value.toUpperCase())
}
```

## Generic Types

### Basic Generics

```typescript
// Generic function
function first<T>(items: T[]): T | undefined {
	return items[0]
}

// Generic interface
interface Box<T> {
	value: T
}

// Generic type alias
type Result<T> = { success: true; data: T } | { success: false; error: string }

// Generic class
class Stack<T> {
	private items: T[] = []

	push(item: T) {
		this.items.push(item)
	}

	pop(): T | undefined {
		return this.items.pop()
	}
}
```

### Generic Constraints

```typescript
// Constrain to specific type
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
	return obj[key]
}

// Constrain to interface
interface HasLength {
	length: number
}

function logLength<T extends HasLength>(item: T): void {
	console.log(item.length)
}

logLength('string') // OK
logLength([1, 2, 3]) // OK
logLength({ length: 10 }) // OK
// logLength(42) // Error: number doesn't have length
```

### Default Generic Parameters

```typescript
interface Response<T = unknown> {
	data: T
	status: number
}

// Uses default
let response1: Response = { data: 'anything', status: 200 }

// Explicitly typed
let response2: Response<User> = { data: user, status: 200 }
```

### Generic Utility Functions

```typescript
// Pick specific properties
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
	const result = {} as Pick<T, K>
	keys.forEach((key) => {
		result[key] = obj[key]
	})
	return result
}

// Map array
function map<T, U>(items: T[], fn: (item: T) => U): U[] {
	return items.map(fn)
}
```

## Advanced Type Features

### Conditional Types

```typescript
// Basic conditional type
type IsString<T> = T extends string ? true : false

type A = IsString<string> // true
type B = IsString<number> // false

// Distributive conditional types
type ToArray<T> = T extends any ? T[] : never

type StrArrOrNumArr = ToArray<string | number> // string[] | number[]

// Infer keyword
type Flatten<T> = T extends Array<infer U> ? U : T

type Str = Flatten<string[]> // string
type Num = Flatten<number> // number

// ReturnType implementation
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never
```

### Mapped Types

```typescript
// Make all properties optional
type Partial<T> = {
	[K in keyof T]?: T[K]
}

// Make all properties required
type Required<T> = {
	[K in keyof T]-?: T[K]
}

// Make all properties readonly
type Readonly<T> = {
	readonly [K in keyof T]: T[K]
}

// Transform keys
type Getters<T> = {
	[K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

interface Person {
	name: string
	age: number
}

type PersonGetters = Getters<Person>
// {
//   getName: () => string
//   getAge: () => number
// }
```

### Key Remapping

```typescript
// Filter keys
type RemoveKindField<T> = {
	[K in keyof T as Exclude<K, 'kind'>]: T[K]
}

// Conditional key inclusion
type PickByType<T, U> = {
	[K in keyof T as T[K] extends U ? K : never]: T[K]
}

interface Model {
	id: number
	name: string
	age: number
	email: string
}

type StringFields = PickByType<Model, string> // { name: string, email: string }
```

### Recursive Types

```typescript
// JSON value type
type JSONValue = string | number | boolean | null | JSONObject | JSONArray

interface JSONObject {
	[key: string]: JSONValue
}

interface JSONArray extends Array<JSONValue> {}

// Tree structure
interface TreeNode<T> {
	value: T
	children?: TreeNode<T>[]
}

// Deep readonly
type DeepReadonly<T> = {
	readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K]
}
```

## Type Compatibility

### Structural Typing

```typescript
interface Point {
	x: number
	y: number
}

interface Named {
	name: string
}

// Compatible if structure matches
let point: Point = { x: 0, y: 0 }
let namedPoint = { x: 0, y: 0, name: 'origin' }

point = namedPoint // OK: namedPoint has x and y
```

### Variance

**Covariance** (return types):

```typescript
interface Animal {
	name: string
}

interface Dog extends Animal {
	breed: string
}

let getDog: () => Dog
let getAnimal: () => Animal

getAnimal = getDog // OK: Dog is assignable to Animal
```

**Contravariance** (parameter types):

```typescript
let handleAnimal: (animal: Animal) => void
let handleDog: (dog: Dog) => void

handleDog = handleAnimal // OK: can pass Dog to function expecting Animal
```

## Index Types

### Index Signatures

```typescript
// String index
interface StringMap {
	[key: string]: string
}

// Number index
interface NumberArray {
	[index: number]: number
}

// Combine with named properties
interface MixedInterface {
	length: number
	[index: number]: string
}
```

### keyof Operator

```typescript
interface Person {
	name: string
	age: number
}

type PersonKeys = keyof Person // "name" | "age"

function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
	return obj[key]
}
```

### Indexed Access Types

```typescript
interface Person {
	name: string
	age: number
	address: {
		street: string
		city: string
	}
}

type Name = Person['name'] // string
type Age = Person['age'] // number
type Address = Person['address'] // { street: string; city: string }
type AddressCity = Person['address']['city'] // string

// Access multiple keys
type NameOrAge = Person['name' | 'age'] // string | number
```

## Branded Types

```typescript
// Create nominal types from structural types
type Brand<K, T> = K & { __brand: T }

type USD = Brand<number, 'USD'>
type EUR = Brand<number, 'EUR'>

function makeUSD(amount: number): USD {
	return amount as USD
}

function makeEUR(amount: number): EUR {
	return amount as EUR
}

let usd = makeUSD(100)
let eur = makeEUR(100)

// usd = eur // Error: different brands
```

## Best Practices

1. **Prefer type inference** - Let TypeScript infer types when obvious
2. **Use strict null checks** - Enable strictNullChecks for better safety
3. **Avoid `any`** - Use `unknown` and narrow with type guards
4. **Use discriminated unions** - Better than loose unions for state
5. **Leverage const assertions** - Get narrow literal types
6. **Use branded types** - When structural typing isn't enough
7. **Document complex types** - Add JSDoc comments
8. **Extract reusable types** - DRY principle applies to types too
9. **Use utility types** - Leverage built-in transformation types
10. **Test your types** - Use type assertions to verify type correctness
