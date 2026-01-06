/**
 * TypeScript React Patterns
 *
 * This file demonstrates type-safe React patterns including:
 * - Component props typing
 * - Hooks with TypeScript
 * - Context with type safety
 * - Generic components
 * - Event handlers
 * - Ref types
 */

import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode, InputHTMLAttributes, FormEvent, ChangeEvent } from 'react'

// ============================================================================
// Component Props Patterns
// ============================================================================

// Basic component with props
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'tertiary'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button
      className={`btn-${variant} btn-${size}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// Props extending HTML attributes
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export function Input({ label, error, helperText, ...inputProps }: InputProps) {
  return (
    <div className="input-wrapper">
      {label && <label>{label}</label>}
      <input className={error ? 'input-error' : ''} {...inputProps} />
      {error && <span className="error">{error}</span>}
      {helperText && <span className="helper">{helperText}</span>}
    </div>
  )
}

// Generic component
interface ListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => ReactNode
  keyExtractor: (item: T, index: number) => string
  emptyMessage?: string
}

export function List<T>({
  items,
  renderItem,
  keyExtractor,
  emptyMessage = 'No items',
}: ListProps<T>) {
  if (items.length === 0) {
    return <div>{emptyMessage}</div>
  }

  return (
    <ul>
      {items.map((item, index) => (
        <li key={keyExtractor(item, index)}>{renderItem(item, index)}</li>
      ))}
    </ul>
  )
}

// Component with children render prop
interface ContainerProps {
  isLoading: boolean
  error: Error | null
  children: (props: { retry: () => void }) => ReactNode
}

export function Container({ isLoading, error, children }: ContainerProps) {
  const retry = () => {
    // Retry logic
  }

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return <>{children({ retry })}</>
}

// ============================================================================
// Hooks Patterns
// ============================================================================

// useState with explicit type
function useCounter(initialValue: number = 0) {
  const [count, setCount] = useState<number>(initialValue)

  const increment = () => setCount((c) => c + 1)
  const decrement = () => setCount((c) => c - 1)
  const reset = () => setCount(initialValue)

  return { count, increment, decrement, reset }
}

// useState with union type
type LoadingState = 'idle' | 'loading' | 'success' | 'error'

function useLoadingState() {
  const [state, setState] = useState<LoadingState>('idle')

  const startLoading = () => setState('loading')
  const setSuccess = () => setState('success')
  const setError = () => setState('error')
  const reset = () => setState('idle')

  return { state, startLoading, setSuccess, setError, reset }
}

// Custom hook with options
interface UseFetchOptions<T> {
  initialData?: T
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
}

interface UseFetchReturn<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

function useFetch<T>(url: string, options?: UseFetchOptions<T>): UseFetchReturn<T> {
  const [data, setData] = useState<T | undefined>(options?.initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const json = await response.json()
      setData(json)
      options?.onSuccess?.(json)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      options?.onError?.(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [url])

  return { data, loading, error, refetch: fetchData }
}

// useReducer with discriminated unions
interface User {
  id: string
  name: string
  email: string
}

type FetchState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error }

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

function useFetchWithReducer<T>(url: string) {
  const [state, dispatch] = useReducer(fetchReducer<T>, { status: 'idle' })

  useEffect(() => {
    let isCancelled = false

    const fetchData = async () => {
      dispatch({ type: 'FETCH_START' })

      try {
        const response = await fetch(url)
        const data = await response.json()

        if (!isCancelled) {
          dispatch({ type: 'FETCH_SUCCESS', payload: data })
        }
      } catch (error) {
        if (!isCancelled) {
          dispatch({
            type: 'FETCH_ERROR',
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }
      }
    }

    fetchData()

    return () => {
      isCancelled = true
    }
  }, [url])

  return state
}

// ============================================================================
// Context Patterns
// ============================================================================

// Type-safe context
interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const login = async (email: string, password: string) => {
    // Login logic
    const userData = await fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json())

    setUser(userData)
  }

  const logout = () => {
    setUser(null)
  }

  const value: AuthContextType = {
    user,
    isAuthenticated: user !== null,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Custom hook with error handling
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}

// ============================================================================
// Event Handler Patterns
// ============================================================================

interface FormData {
  name: string
  email: string
  message: string
}

function ContactForm() {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    message: '',
  })

  // Type-safe change handler
  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
  }

  // Type-safe submit handler
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    console.log('Submitting:', formData)
  }

  // Specific field handler
  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, name: e.target.value }))
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        name="name"
        value={formData.name}
        onChange={handleChange}
        placeholder="Name"
      />
      <input
        name="email"
        value={formData.email}
        onChange={handleChange}
        placeholder="Email"
      />
      <textarea
        name="message"
        value={formData.message}
        onChange={handleChange}
        placeholder="Message"
      />
      <button type="submit">Submit</button>
    </form>
  )
}

// ============================================================================
// Ref Patterns
// ============================================================================

function FocusInput() {
  // useRef with DOM element
  const inputRef = useRef<HTMLInputElement>(null)

  const focusInput = () => {
    inputRef.current?.focus()
  }

  return (
    <div>
      <input ref={inputRef} />
      <button onClick={focusInput}>Focus Input</button>
    </div>
  )
}

function Timer() {
  // useRef for mutable value
  const countRef = useRef<number>(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const startTimer = () => {
    intervalRef.current = setInterval(() => {
      countRef.current += 1
      console.log(countRef.current)
    }, 1000)
  }

  const stopTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  return (
    <div>
      <button onClick={startTimer}>Start</button>
      <button onClick={stopTimer}>Stop</button>
    </div>
  )
}

// ============================================================================
// Generic Component Patterns
// ============================================================================

// Select component with generic options
interface SelectProps<T> {
  options: T[]
  value: T
  onChange: (value: T) => void
  getLabel: (option: T) => string
  getValue: (option: T) => string
}

export function Select<T>({
  options,
  value,
  onChange,
  getLabel,
  getValue,
}: SelectProps<T>) {
  return (
    <select
      value={getValue(value)}
      onChange={(e) => {
        const selectedValue = e.target.value
        const option = options.find((opt) => getValue(opt) === selectedValue)
        if (option) {
          onChange(option)
        }
      }}
    >
      {options.map((option) => (
        <option key={getValue(option)} value={getValue(option)}>
          {getLabel(option)}
        </option>
      ))}
    </select>
  )
}

// Data table component
interface Column<T> {
  key: keyof T
  header: string
  render?: (value: T[keyof T], row: T) => ReactNode
}

interface TableProps<T> {
  data: T[]
  columns: Column<T>[]
  keyExtractor: (row: T) => string
}

export function Table<T>({ data, columns, keyExtractor }: TableProps<T>) {
  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={String(col.key)}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={keyExtractor(row)}>
            {columns.map((col) => (
              <td key={String(col.key)}>
                {col.render ? col.render(row[col.key], row) : String(row[col.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ============================================================================
// Higher-Order Component Pattern
// ============================================================================

interface WithLoadingProps {
  isLoading: boolean
}

function withLoading<P extends object>(
  Component: React.ComponentType<P>,
): React.FC<P & WithLoadingProps> {
  return ({ isLoading, ...props }: WithLoadingProps & P) => {
    if (isLoading) {
      return <div>Loading...</div>
    }

    return <Component {...(props as P)} />
  }
}

// Usage
interface UserListProps {
  users: User[]
}

const UserList: React.FC<UserListProps> = ({ users }) => (
  <ul>
    {users.map((user) => (
      <li key={user.id}>{user.name}</li>
    ))}
  </ul>
)

const UserListWithLoading = withLoading(UserList)

// ============================================================================
// Exports
// ============================================================================

export {
  useCounter,
  useLoadingState,
  useFetch,
  useFetchWithReducer,
  ContactForm,
  FocusInput,
  Timer,
}

export type {
  ButtonProps,
  InputProps,
  ListProps,
  UseFetchOptions,
  UseFetchReturn,
  FetchState,
  FetchAction,
  AuthContextType,
  SelectProps,
  Column,
  TableProps,
}

