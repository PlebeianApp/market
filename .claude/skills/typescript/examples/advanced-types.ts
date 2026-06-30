/**
 * Advanced TypeScript Types
 *
 * This file demonstrates advanced TypeScript features including:
 * - Generics with constraints
 * - Conditional types
 * - Mapped types
 * - Template literal types
 * - Recursive types
 * - Utility type implementations
 */

// ============================================================================
// Generics Basics
// ============================================================================

// Generic function
function identity<T>(value: T): T {
	return value
}

const stringValue = identity('hello') // Type: string
const numberValue = identity(42) // Type: number

// Generic interface
interface Box<T> {
	value: T
}

const stringBox: Box<string> = { value: 'hello' }
const numberBox: Box<number> = { value: 42 }

// Generic class
class Stack<T> {
	private items: T[] = []

	push(item: T): void {
		this.items.push(item)
	}

	pop(): T | undefined {
		return this.items.pop()
	}

	peek(): T | undefined {
		return this.items[this.items.length - 1]
	}

	isEmpty(): boolean {
		return this.items.length === 0
	}
}

const numberStack = new Stack<number>()
numberStack.push(1)
numberStack.push(2)
numberStack.pop() // Type: number | undefined

// ============================================================================
// Generic Constraints
// ============================================================================

// Constrain to specific type
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

// Constrain to object keys
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
	return obj[key]
}

interface User {
	id: string
	name: string
	age: number
}

const user: User = { id: '1', name: 'Alice', age: 30 }
const userName = getProperty(user, 'name') // Type: string
// const invalid = getProperty(user, 'invalid') // Error

// Multiple type parameters with constraints
function merge<T extends object, U extends object>(obj1: T, obj2: U): T & U {
	return { ...obj1, ...obj2 }
}

const merged = merge({ a: 1 }, { b: 2 }) // Type: { a: number } & { b: number }

// ============================================================================
// Conditional Types
// ============================================================================

// Basic conditional type
type IsString<T> = T extends string ? true : false

type A = IsString<string> // true
type B = IsString<number> // false

// Nested conditional types
type TypeName<T> = T extends string
	? 'string'
	: T extends number
		? 'number'
		: T extends boolean
			? 'boolean'
			: T extends undefined
				? 'undefined'
				: T extends Function
					? 'function'
					: 'object'

type T1 = TypeName<string> // "string"
type T2 = TypeName<number> // "number"
type T3 = TypeName<() => void> // "function"

// Distributive conditional types
type ToArray<T> = T extends any ? T[] : never

type StrArrOrNumArr = ToArray<string | number> // string[] | number[]

// infer keyword
type Flatten<T> = T extends Array<infer U> ? U : T

type Str = Flatten<string[]> // string
type Num = Flatten<number> // number

// Return type extraction
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never

function exampleFn(): string {
	return 'hello'
}

type ExampleReturn = MyReturnType<typeof exampleFn> // string

// Parameters extraction
type MyParameters<T> = T extends (...args: infer P) => any ? P : never

function createUser(name: string, age: number): User {
	return { id: '1', name, age }
}

type CreateUserParams = MyParameters<typeof createUser> // [string, number]

// ============================================================================
// Mapped Types
// ============================================================================

// Make all properties optional
type MyPartial<T> = {
	[K in keyof T]?: T[K]
}

interface Person {
	name: string
	age: number
	email: string
}

type PartialPerson = MyPartial<Person>
// {
//   name?: string
//   age?: number
//   email?: string
// }

// Make all properties required
type MyRequired<T> = {
	[K in keyof T]-?: T[K]
}

// Make all properties readonly
type MyReadonly<T> = {
	readonly [K in keyof T]: T[K]
}

// Pick specific properties
type MyPick<T, K extends keyof T> = {
	[P in K]: T[P]
}

type UserProfile = MyPick<User, 'id' | 'name'>
// { id: string; name: string }

// Omit specific properties
type MyOmit<T, K extends keyof T> = {
	[P in keyof T as P extends K ? never : P]: T[P]
}

type UserWithoutAge = MyOmit<User, 'age'>
// { id: string; name: string }

// Transform property types
type Nullable<T> = {
	[K in keyof T]: T[K] | null
}

type NullablePerson = Nullable<Person>
// {
//   name: string | null
//   age: number | null
//   email: string | null
// }

// ============================================================================
// Key Remapping
// ============================================================================

// Add prefix to keys
type Getters<T> = {
	[K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

type PersonGetters = Getters<Person>
// {
//   getName: () => string
//   getAge: () => number
//   getEmail: () => string
// }

// Filter keys by type
type PickByType<T, U> = {
	[K in keyof T as T[K] extends U ? K : never]: T[K]
}

interface Model {
	id: number
	name: string
	description: string
	price: number
}

type StringFields = PickByType<Model, string>
// { name: string; description: string }

// Remove specific key
type RemoveKindField<T> = {
	[K in keyof T as Exclude<K, 'kind'>]: T[K]
}

// ============================================================================
// Template Literal Types
// ============================================================================

// Event name generation
type EventName<T extends string> = `on${Capitalize<T>}`

type ClickEvent = EventName<'click'> // "onClick"
type SubmitEvent = EventName<'submit'> // "onSubmit"

// Combining literals
type Color = 'red' | 'green' | 'blue'
type Shade = 'light' | 'dark'
type ColorShade = `${Shade}-${Color}`
// "light-red" | "light-green" | "light-blue" | "dark-red" | "dark-green" | "dark-blue"

// CSS properties
type CSSProperty = 'margin' | 'padding'
type Side = 'top' | 'right' | 'bottom' | 'left'
type CSSPropertyWithSide = `${CSSProperty}-${Side}`
// "margin-top" | "margin-right" | ... | "padding-left"

// Route generation
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
type Endpoint = '/users' | '/products' | '/orders'
type ApiRoute = `${HttpMethod} ${Endpoint}`
// "GET /users" | "POST /users" | ... | "DELETE /orders"

// ============================================================================
// Recursive Types
// ============================================================================

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

const tree: TreeNode<number> = {
	value: 1,
	children: [
		{ value: 2, children: [{ value: 4 }, { value: 5 }] },
		{ value: 3, children: [{ value: 6 }] },
	],
}

// Deep readonly
type DeepReadonly<T> = {
	readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K]
}

interface NestedConfig {
	api: {
		url: string
		timeout: number
	}
	features: {
		darkMode: boolean
	}
}

type ImmutableConfig = DeepReadonly<NestedConfig>
// All properties at all levels are readonly

// Deep partial
type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ============================================================================
// Advanced Utility Types
// ============================================================================

// Exclude types from union
type MyExclude<T, U> = T extends U ? never : T

type T4 = MyExclude<'a' | 'b' | 'c', 'a'> // "b" | "c"

// Extract types from union
type MyExtract<T, U> = T extends U ? T : never

type T5 = MyExtract<'a' | 'b' | 'c', 'a' | 'f'> // "a"

// NonNullable
type MyNonNullable<T> = T extends null | undefined ? never : T

type T6 = MyNonNullable<string | null | undefined> // string

// Record
type MyRecord<K extends keyof any, T> = {
	[P in K]: T
}

type PageInfo = MyRecord<string, number>

// Awaited
type MyAwaited<T> = T extends Promise<infer U> ? MyAwaited<U> : T

type T7 = MyAwaited<Promise<string>> // string
type T8 = MyAwaited<Promise<Promise<number>>> // number

// ============================================================================
// Branded Types
// ============================================================================

type Brand<K, T> = K & { __brand: T }

type USD = Brand<number, 'USD'>
type EUR = Brand<number, 'EUR'>
type UserId = Brand<string, 'UserId'>
type ProductId = Brand<string, 'ProductId'>

function makeUSD(amount: number): USD {
	return amount as USD
}

function makeUserId(id: string): UserId {
	return id as UserId
}

const usd = makeUSD(100)
const userId = makeUserId('user-123')

// Type-safe operations
function addMoney(a: USD, b: USD): USD {
	return (a + b) as USD
}

// Prevents mixing different branded types
// const total = addMoney(usd, eur) // Error

// ============================================================================
// Union to Intersection
// ============================================================================

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

type Union = { a: string } | { b: number }
type Intersection = UnionToIntersection<Union>
// { a: string } & { b: number }

// ============================================================================
// Advanced Generic Patterns
// ============================================================================

// Constraining multiple related types
function merge<T extends Record<string, any>, U extends Record<string, any>, K extends keyof T & keyof U>(
	obj1: T,
	obj2: U,
	conflictKeys: K[],
): T & U {
	const result = { ...obj1, ...obj2 }
	conflictKeys.forEach((key) => {
		// Handle conflicts
	})
	return result as T & U
}

// Builder pattern with fluent API
class QueryBuilder<T, Selected extends keyof T = never> {
	private selectFields: Set<keyof T> = new Set()

	select<K extends keyof T>(...fields: K[]): QueryBuilder<T, Selected | K> {
		fields.forEach((field) => this.selectFields.add(field))
		return this as any
	}

	execute(): Pick<T, Selected> {
		// Execute query
		return {} as Pick<T, Selected>
	}
}

// Usage
interface Product {
	id: string
	name: string
	price: number
	description: string
}

const result = new QueryBuilder<Product>().select('id', 'name').select('price').execute()
// Type: { id: string; name: string; price: number }

// ============================================================================
// Exports
// ============================================================================

export type {
	Box,
	HasLength,
	IsString,
	Flatten,
	MyPartial,
	MyRequired,
	MyReadonly,
	Nullable,
	DeepReadonly,
	DeepPartial,
	Brand,
	USD,
	EUR,
	UserId,
	ProductId,
	JSONValue,
	TreeNode,
}

export { Stack, identity, getProperty, merge, makeUSD, makeUserId }
