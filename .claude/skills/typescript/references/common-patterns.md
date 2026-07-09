# TypeScript Common Patterns Reference

This document contains commonly used TypeScript patterns and idioms from real-world applications.

## React Patterns

### Component Props

```typescript
// Basic props with children
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'tertiary'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button className={`btn-${variant} btn-${size}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

// Props extending HTML attributes
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, ...inputProps }: InputProps) {
  return (
    <div>
      {label && <label>{label}</label>}
      <input {...inputProps} />
      {error && <span>{error}</span>}
    </div>
  )
}

// Generic component props
interface ListProps<T> {
  items: T[]
  renderItem: (item: T) => React.ReactNode
  keyExtractor: (item: T) => string
}

export function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  )
}
```

### Hooks

```typescript
// Custom hook with return type
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
	const [storedValue, setStoredValue] = useState<T>(() => {
		try {
			const item = window.localStorage.getItem(key)
			return item ? JSON.parse(item) : initialValue
		} catch (error) {
			return initialValue
		}
	})

	const setValue = (value: T) => {
		setStoredValue(value)
		window.localStorage.setItem(key, JSON.stringify(value))
	}

	return [storedValue, setValue]
}

// Hook with options object
interface UseFetchOptions<T> {
	initialData?: T
	onSuccess?: (data: T) => void
	onError?: (error: Error) => void
}

function useFetch<T>(url: string, options?: UseFetchOptions<T>) {
	const [data, setData] = useState<T | undefined>(options?.initialData)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	useEffect(() => {
		let isCancelled = false

		const fetchData = async () => {
			setLoading(true)
			try {
				const response = await fetch(url)
				const json = await response.json()
				if (!isCancelled) {
					setData(json)
					options?.onSuccess?.(json)
				}
			} catch (err) {
				if (!isCancelled) {
					const error = err instanceof Error ? err : new Error(String(err))
					setError(error)
					options?.onError?.(error)
				}
			} finally {
				if (!isCancelled) {
					setLoading(false)
				}
			}
		}

		fetchData()

		return () => {
			isCancelled = true
		}
	}, [url])

	return { data, loading, error }
}
```

### Context

```typescript
// Type-safe context
interface AuthContextType {
  user: User | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const login = async (email: string, password: string) => {
    // Login logic
    const user = await api.login(email, password)
    setUser(user)
  }

  const logout = () => {
    setUser(null)
  }

  const value: AuthContextType = {
    user,
    login,
    logout,
    isAuthenticated: user !== null,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Custom hook with proper error handling
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
```

## API Response Patterns

### Result Type Pattern

```typescript
// Discriminated union for API responses
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }

// Helper functions
function success<T>(data: T): Result<T> {
	return { success: true, data }
}

function failure<E = Error>(error: E): Result<never, E> {
	return { success: false, error }
}

// Usage
async function fetchUser(id: string): Promise<Result<User>> {
	try {
		const response = await fetch(`/api/users/${id}`)
		if (!response.ok) {
			return failure(new Error(`HTTP ${response.status}`))
		}
		const data = await response.json()
		return success(data)
	} catch (error) {
		return failure(error instanceof Error ? error : new Error(String(error)))
	}
}

// Consuming the result
const result = await fetchUser('123')
if (result.success) {
	console.log(result.data.name) // Type-safe access
} else {
	console.error(result.error.message) // Type-safe error handling
}
```

### Option Type Pattern

```typescript
// Option/Maybe type for nullable values
type Option<T> = Some<T> | None

interface Some<T> {
	readonly _tag: 'Some'
	readonly value: T
}

interface None {
	readonly _tag: 'None'
}

// Constructors
function some<T>(value: T): Option<T> {
	return { _tag: 'Some', value }
}

function none(): Option<never> {
	return { _tag: 'None' }
}

// Helper functions
function isSome<T>(option: Option<T>): option is Some<T> {
	return option._tag === 'Some'
}

function isNone<T>(option: Option<T>): option is None {
	return option._tag === 'None'
}

function map<T, U>(option: Option<T>, fn: (value: T) => U): Option<U> {
	return isSome(option) ? some(fn(option.value)) : none()
}

function getOrElse<T>(option: Option<T>, defaultValue: T): T {
	return isSome(option) ? option.value : defaultValue
}

// Usage
function findUser(id: string): Option<User> {
	const user = users.find((u) => u.id === id)
	return user ? some(user) : none()
}

const user = findUser('123')
const userName = getOrElse(
	map(user, (u) => u.name),
	'Unknown',
)
```

## State Management Patterns

### Discriminated Union for State

```typescript
// State machine using discriminated unions
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

// Reducer pattern
type FetchAction<T> =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: T }
  | { type: 'FETCH_ERROR'; error: Error }
  | { type: 'RESET' }

function fetchReducer<T>(state: FetchState<T>, action: FetchAction<T>): FetchState<T> {
  switch (action.type) {
    case 'FETCH_START':
      return { status: 'loading' }
    case 'FETCH_SUCCESS':
      return { status: 'success', data: action.payload }
    case 'FETCH_ERROR':
      return { status: 'error', error: action.error }
    case 'RESET':
      return { status: 'idle' }
  }
}

// Usage in component
function UserProfile({ userId }: { userId: string }) {
  const [state, dispatch] = useReducer(fetchReducer<User>, { status: 'idle' })

  useEffect(() => {
    dispatch({ type: 'FETCH_START' })
    fetchUser(userId)
      .then((user) => dispatch({ type: 'FETCH_SUCCESS', payload: user }))
      .catch((error) => dispatch({ type: 'FETCH_ERROR', error }))
  }, [userId])

  switch (state.status) {
    case 'idle':
      return <div>Ready to load</div>
    case 'loading':
      return <div>Loading...</div>
    case 'success':
      return <div>{state.data.name}</div>
    case 'error':
      return <div>Error: {state.error.message}</div>
  }
}
```

### Store Pattern

```typescript
// Type-safe store implementation
interface Store<T> {
  getState: () => T
  setState: (partial: Partial<T>) => void
  subscribe: (listener: (state: T) => void) => () => void
}

function createStore<T>(initialState: T): Store<T> {
  let state = initialState
  const listeners = new Set<(state: T) => void>()

  return {
    getState: () => state,
    setState: (partial) => {
      state = { ...state, ...partial }
      listeners.forEach((listener) => listener(state))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// Usage
interface AppState {
  user: User | null
  theme: 'light' | 'dark'
}

const store = createStore<AppState>({
  user: null,
  theme: 'light',
})

// React hook integration
function useStore<T, U>(store: Store<T>, selector: (state: T) => U): U {
  const [value, setValue] = useState(() => selector(store.getState()))

  useEffect(() => {
    const unsubscribe = store.subscribe((state) => {
      setValue(selector(state))
    })
    return unsubscribe
  }, [store, selector])

  return value
}

// Usage in component
function ThemeToggle() {
  const theme = useStore(store, (state) => state.theme)

  return (
    <button
      onClick={() => store.setState({ theme: theme === 'light' ? 'dark' : 'light' })}
    >
      Toggle Theme
    </button>
  )
}
```

## Form Patterns

### Form State Management

```typescript
// Generic form state
interface FormState<T> {
  values: T
  errors: Partial<Record<keyof T, string>>
  touched: Partial<Record<keyof T, boolean>>
  isSubmitting: boolean
}

// Form hook
function useForm<T extends Record<string, any>>(
  initialValues: T,
  validate: (values: T) => Partial<Record<keyof T, string>>,
) {
  const [state, setState] = useState<FormState<T>>({
    values: initialValues,
    errors: {},
    touched: {},
    isSubmitting: false,
  })

  const handleChange = <K extends keyof T>(field: K, value: T[K]) => {
    setState((prev) => ({
      ...prev,
      values: { ...prev.values, [field]: value },
      errors: { ...prev.errors, [field]: undefined },
    }))
  }

  const handleBlur = <K extends keyof T>(field: K) => {
    setState((prev) => ({
      ...prev,
      touched: { ...prev.touched, [field]: true },
    }))
  }

  const handleSubmit = async (onSubmit: (values: T) => Promise<void>) => {
    const errors = validate(state.values)

    if (Object.keys(errors).length > 0) {
      setState((prev) => ({
        ...prev,
        errors,
        touched: Object.keys(state.values).reduce(
          (acc, key) => ({ ...acc, [key]: true }),
          {},
        ),
      }))
      return
    }

    setState((prev) => ({ ...prev, isSubmitting: true }))
    try {
      await onSubmit(state.values)
    } finally {
      setState((prev) => ({ ...prev, isSubmitting: false }))
    }
  }

  return {
    values: state.values,
    errors: state.errors,
    touched: state.touched,
    isSubmitting: state.isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
  }
}

// Usage
interface LoginFormValues {
  email: string
  password: string
}

function LoginForm() {
  const form = useForm<LoginFormValues>(
    { email: '', password: '' },
    (values) => {
      const errors: Partial<Record<keyof LoginFormValues, string>> = {}
      if (!values.email) {
        errors.email = 'Email is required'
      }
      if (!values.password) {
        errors.password = 'Password is required'
      }
      return errors
    },
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit(async (values) => {
          await login(values.email, values.password)
        })
      }}
    >
      <input
        value={form.values.email}
        onChange={(e) => form.handleChange('email', e.target.value)}
        onBlur={() => form.handleBlur('email')}
      />
      {form.touched.email && form.errors.email && <span>{form.errors.email}</span>}

      <input
        type="password"
        value={form.values.password}
        onChange={(e) => form.handleChange('password', e.target.value)}
        onBlur={() => form.handleBlur('password')}
      />
      {form.touched.password && form.errors.password && (
        <span>{form.errors.password}</span>
      )}

      <button type="submit" disabled={form.isSubmitting}>
        Login
      </button>
    </form>
  )
}
```

## Validation Patterns

### Zod Integration

```typescript
import { z } from 'zod'

// Schema definition
const userSchema = z.object({
	id: z.string().uuid(),
	name: z.string().min(1).max(100),
	email: z.string().email(),
	age: z.number().int().min(0).max(120),
	role: z.enum(['admin', 'user', 'guest']),
})

// Extract type from schema
type User = z.infer<typeof userSchema>

// Validation function
function validateUser(data: unknown): Result<User> {
	const result = userSchema.safeParse(data)
	if (result.success) {
		return { success: true, data: result.data }
	}
	return {
		success: false,
		error: new Error(result.error.errors.map((e) => e.message).join(', ')),
	}
}

// API integration
async function createUser(data: unknown): Promise<Result<User>> {
	const validation = validateUser(data)
	if (!validation.success) {
		return validation
	}

	try {
		const response = await fetch('/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(validation.data),
		})

		if (!response.ok) {
			return failure(new Error(`HTTP ${response.status}`))
		}

		const user = await response.json()
		return success(user)
	} catch (error) {
		return failure(error instanceof Error ? error : new Error(String(error)))
	}
}
```

## Builder Pattern

```typescript
// Fluent builder pattern
class QueryBuilder<T> {
	private filters: Array<(item: T) => boolean> = []
	private sortFn?: (a: T, b: T) => number
	private limitValue?: number

	where(predicate: (item: T) => boolean): this {
		this.filters.push(predicate)
		return this
	}

	sortBy(compareFn: (a: T, b: T) => number): this {
		this.sortFn = compareFn
		return this
	}

	limit(count: number): this {
		this.limitValue = count
		return this
	}

	execute(data: T[]): T[] {
		let result = data

		// Apply filters
		this.filters.forEach((filter) => {
			result = result.filter(filter)
		})

		// Apply sorting
		if (this.sortFn) {
			result = result.sort(this.sortFn)
		}

		// Apply limit
		if (this.limitValue !== undefined) {
			result = result.slice(0, this.limitValue)
		}

		return result
	}
}

// Usage
interface Product {
	id: string
	name: string
	price: number
	category: string
}

const products: Product[] = [
	/* ... */
]

const query = new QueryBuilder<Product>()
	.where((p) => p.category === 'electronics')
	.where((p) => p.price < 1000)
	.sortBy((a, b) => a.price - b.price)
	.limit(10)
	.execute(products)
```

## Factory Pattern

```typescript
// Abstract factory pattern with TypeScript
interface Button {
	render: () => string
	onClick: () => void
}

interface ButtonFactory {
	createButton: (label: string, onClick: () => void) => Button
}

class PrimaryButton implements Button {
	constructor(
		private label: string,
		private clickHandler: () => void,
	) {}

	render() {
		return `<button class="primary">${this.label}</button>`
	}

	onClick() {
		this.clickHandler()
	}
}

class SecondaryButton implements Button {
	constructor(
		private label: string,
		private clickHandler: () => void,
	) {}

	render() {
		return `<button class="secondary">${this.label}</button>`
	}

	onClick() {
		this.clickHandler()
	}
}

class PrimaryButtonFactory implements ButtonFactory {
	createButton(label: string, onClick: () => void): Button {
		return new PrimaryButton(label, onClick)
	}
}

class SecondaryButtonFactory implements ButtonFactory {
	createButton(label: string, onClick: () => void): Button {
		return new SecondaryButton(label, onClick)
	}
}

// Usage
function createUI(factory: ButtonFactory) {
	const button = factory.createButton('Click me', () => console.log('Clicked!'))
	return button.render()
}
```

## Named Return Variables Pattern

```typescript
// Following Go-style named returns
function parseUser(data: unknown): { user: User | null; err: Error | null } {
	let user: User | null = null
	let err: Error | null = null

	try {
		user = userSchema.parse(data)
	} catch (error) {
		err = error instanceof Error ? error : new Error(String(error))
	}

	return { user, err }
}

// With explicit naming
function fetchData(url: string): {
	data: unknown | null
	status: number
	err: Error | null
} {
	let data: unknown | null = null
	let status = 0
	let err: Error | null = null

	try {
		const response = fetch(url)
		// Process response
	} catch (error) {
		err = error instanceof Error ? error : new Error(String(error))
	}

	return { data, status, err }
}
```

## Best Practices

1. **Use discriminated unions** for type-safe state management
2. **Leverage generic types** for reusable components and hooks
3. **Extract types from Zod schemas** for runtime + compile-time safety
4. **Use Result/Option types** for explicit error handling
5. **Create builder patterns** for complex object construction
6. **Use factory patterns** for flexible object creation
7. **Type context properly** to catch usage errors at compile time
8. **Prefer const assertions** for immutable configurations
9. **Use branded types** for domain-specific primitives
10. **Document patterns** with JSDoc for team knowledge sharing
