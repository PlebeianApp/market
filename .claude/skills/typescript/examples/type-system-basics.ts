/**
 * TypeScript Type System Basics
 *
 * This file demonstrates fundamental TypeScript concepts including:
 * - Primitive types
 * - Object types (interfaces, type aliases)
 * - Union and intersection types
 * - Type inference and narrowing
 * - Function types
 */

// ============================================================================
// Primitive Types
// ============================================================================

const message: string = 'Hello, TypeScript!'
const count: number = 42
const isActive: boolean = true
const nothing: null = null
const notDefined: undefined = undefined

// ============================================================================
// Object Types
// ============================================================================

// Interface definition
interface User {
	id: string
	name: string
	email: string
	age?: number // Optional property
	readonly createdAt: Date // Readonly property
}

// Type alias definition
type Product = {
	id: string
	name: string
	price: number
	category: string
}

// Creating objects
const user: User = {
	id: '1',
	name: 'Alice',
	email: 'alice@example.com',
	createdAt: new Date(),
}

const product: Product = {
	id: 'p1',
	name: 'Laptop',
	price: 999,
	category: 'electronics',
}

// ============================================================================
// Union Types
// ============================================================================

type Status = 'idle' | 'loading' | 'success' | 'error'
type ID = string | number

function formatId(id: ID): string {
	if (typeof id === 'string') {
		return id.toUpperCase()
	}
	return id.toString()
}

// Discriminated unions
type ApiResponse = { success: true; data: User } | { success: false; error: string }

function handleResponse(response: ApiResponse) {
	if (response.success) {
		// TypeScript knows response.data exists here
		console.log(response.data.name)
	} else {
		// TypeScript knows response.error exists here
		console.error(response.error)
	}
}

// ============================================================================
// Intersection Types
// ============================================================================

type Timestamped = {
	createdAt: Date
	updatedAt: Date
}

type TimestampedUser = User & Timestamped

const timestampedUser: TimestampedUser = {
	id: '1',
	name: 'Bob',
	email: 'bob@example.com',
	createdAt: new Date(),
	updatedAt: new Date(),
}

// ============================================================================
// Array Types
// ============================================================================

const numbers: number[] = [1, 2, 3, 4, 5]
const strings: Array<string> = ['a', 'b', 'c']
const users: User[] = [user, timestampedUser]

// Readonly arrays
const immutableNumbers: readonly number[] = [1, 2, 3]
// immutableNumbers.push(4) // Error: push does not exist on readonly array

// ============================================================================
// Tuple Types
// ============================================================================

type Point = [number, number]
type NamedPoint = [x: number, y: number, z?: number]

const point: Point = [10, 20]
const namedPoint: NamedPoint = [10, 20, 30]

// ============================================================================
// Function Types
// ============================================================================

// Function declaration
function add(a: number, b: number): number {
	return a + b
}

// Arrow function
const subtract = (a: number, b: number): number => a - b

// Function type alias
type MathOperation = (a: number, b: number) => number

const multiply: MathOperation = (a, b) => a * b

// Optional parameters
function greet(name: string, greeting?: string): string {
	return `${greeting ?? 'Hello'}, ${name}!`
}

// Default parameters
function createUser(name: string, role: string = 'user'): User {
	return {
		id: Math.random().toString(),
		name,
		email: `${name.toLowerCase()}@example.com`,
		createdAt: new Date(),
	}
}

// Rest parameters
function sum(...numbers: number[]): number {
	return numbers.reduce((acc, n) => acc + n, 0)
}

// ============================================================================
// Type Inference
// ============================================================================

// Type is inferred as string
let inferredString = 'hello'

// Type is inferred as number
let inferredNumber = 42

// Type is inferred as { name: string; age: number }
let inferredObject = {
	name: 'Alice',
	age: 30,
}

// Return type is inferred as number
function inferredReturn(a: number, b: number) {
	return a + b
}

// ============================================================================
// Type Narrowing
// ============================================================================

// typeof guard
function processValue(value: string | number) {
	if (typeof value === 'string') {
		// value is string here
		return value.toUpperCase()
	}
	// value is number here
	return value.toFixed(2)
}

// Truthiness narrowing
function printName(name: string | null | undefined) {
	if (name) {
		// name is string here
		console.log(name.toUpperCase())
	}
}

// Equality narrowing
function example(x: string | number, y: string | boolean) {
	if (x === y) {
		// x and y are both string here
		console.log(x.toUpperCase(), y.toLowerCase())
	}
}

// in operator narrowing
type Fish = { swim: () => void }
type Bird = { fly: () => void }

function move(animal: Fish | Bird) {
	if ('swim' in animal) {
		// animal is Fish here
		animal.swim()
	} else {
		// animal is Bird here
		animal.fly()
	}
}

// instanceof narrowing
function processError(error: Error | string) {
	if (error instanceof Error) {
		// error is Error here
		console.error(error.message)
	} else {
		// error is string here
		console.error(error)
	}
}

// ============================================================================
// Type Predicates (Custom Type Guards)
// ============================================================================

function isUser(value: unknown): value is User {
	return typeof value === 'object' && value !== null && 'id' in value && 'name' in value && 'email' in value
}

function processData(data: unknown) {
	if (isUser(data)) {
		// data is User here
		console.log(data.name)
	}
}

// ============================================================================
// Const Assertions
// ============================================================================

// Without const assertion
const mutableConfig = {
	host: 'localhost',
	port: 8080,
}
// mutableConfig.host = 'example.com' // OK

// With const assertion
const immutableConfig = {
	host: 'localhost',
	port: 8080,
} as const
// immutableConfig.host = 'example.com' // Error: cannot assign to readonly property

// Array with const assertion
const directions = ['north', 'south', 'east', 'west'] as const
// Type: readonly ["north", "south", "east", "west"]

// ============================================================================
// Literal Types
// ============================================================================

type Direction = 'north' | 'south' | 'east' | 'west'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
type DiceValue = 1 | 2 | 3 | 4 | 5 | 6

function move(direction: Direction, steps: number) {
	console.log(`Moving ${direction} by ${steps} steps`)
}

move('north', 10) // OK
// move('up', 10) // Error: "up" is not assignable to Direction

// ============================================================================
// Index Signatures
// ============================================================================

interface StringMap {
	[key: string]: string
}

const translations: StringMap = {
	hello: 'Hola',
	goodbye: 'Adiós',
	thanks: 'Gracias',
}

// ============================================================================
// Utility Functions
// ============================================================================

// Type-safe object keys
function getObjectKeys<T extends object>(obj: T): Array<keyof T> {
	return Object.keys(obj) as Array<keyof T>
}

// Type-safe property access
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
	return obj[key]
}

const userName = getProperty(user, 'name') // Type: string
const userAge = getProperty(user, 'age') // Type: number | undefined

// ============================================================================
// Named Return Values (Go-style)
// ============================================================================

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

// Usage
const { data, err } = parseJSON('{"name": "Alice"}')
if (err) {
	console.error('Failed to parse JSON:', err.message)
} else {
	console.log('Parsed data:', data)
}

// ============================================================================
// Exports
// ============================================================================

export type { User, Product, Status, ID, ApiResponse, TimestampedUser }
export { formatId, handleResponse, processValue, isUser, getProperty, parseJSON }
