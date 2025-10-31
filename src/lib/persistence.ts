import { QueryClient } from '@tanstack/react-query'

/**
 * IndexedDB adapter for TanStack Query persistence
 */
class IndexedDBPersister {
	private dbName = 'plebeian-market-query-cache'
	private storeName = 'queryCache'
	private version = 1
	private db: IDBDatabase | null = null

	async init(): Promise<void> {
		if (this.db) return

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, this.version)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				this.db = request.result
				resolve()
			}

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName)
				}
			}
		})
	}

	async getItem(key: string): Promise<string | null> {
		if (!this.db) await this.init()
		
		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], 'readonly')
			const store = transaction.objectStore(this.storeName)
			const request = store.get(key)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				resolve(request.result || null)
			}
		})
	}

	async setItem(key: string, value: string): Promise<void> {
		if (!this.db) await this.init()

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], 'readwrite')
			const store = transaction.objectStore(this.storeName)
			const request = store.put(value, key)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	}

	async removeItem(key: string): Promise<void> {
		if (!this.db) await this.init()

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([this.storeName], 'readwrite')
			const store = transaction.objectStore(this.storeName)
			const request = store.delete(key)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	}
}

/**
 * Create an IndexedDB persister for TanStack Query
 * Persists order queries (purchases and sales) to IndexedDB
 */
export async function persistOrdersToIndexedDB(queryClient: QueryClient): Promise<void> {
	const persister = new IndexedDBPersister()
	await persister.init()

	// Create a simple persister adapter
	const indexedDBPersister = {
		persistClient: async (persistedClient: any) => {
			try {
				await persister.setItem('react-query-orders-cache', JSON.stringify(persistedClient))
			} catch (error) {
				// Silently fail - persistence is best effort
			}
		},
		restoreClient: async () => {
			try {
				const persisted = await persister.getItem('react-query-orders-cache')
				return persisted ? JSON.parse(persisted) : undefined
			} catch (error) {
				return undefined
			}
		},
		removeClient: async () => {
			try {
				await persister.removeItem('react-query-orders-cache')
			} catch (error) {
				// Silently fail - cleanup is best effort
			}
		},
	}

	// Manual persistence using queryClient cache
	// Set up periodic persistence
	let persistTimeout: NodeJS.Timeout | null = null
	
	const persistCache = async () => {
		try {
			const cache = queryClient.getQueryCache()
			const queries = cache.getAll()
			
			// Filter only order queries
			const orderQueries = queries.filter((query) => {
				const queryKey = query.queryKey
				return Array.isArray(queryKey) && queryKey[0] === 'orders'
			})

			if (orderQueries.length > 0) {
				const dehydratedState = {
					queries: orderQueries.map((query) => ({
						queryKey: query.queryKey,
						queryHash: query.queryHash,
						state: {
							data: query.state.data,
							dataUpdatedAt: query.state.dataUpdatedAt,
							error: null,
							errorUpdatedAt: 0,
							fetchFailureCount: 0,
							fetchFailureReason: null,
							fetchMeta: null,
							isInvalidated: false,
							status: query.state.status,
							fetchStatus: query.state.fetchStatus,
						},
					})),
					timestamp: Date.now(),
				}
				await indexedDBPersister.persistClient(dehydratedState)
			}
		} catch (error) {
			// Silently fail - persistence is best effort
		}
	}

	// Restore from IndexedDB on initialization
	const restored = await indexedDBPersister.restoreClient()
	if (restored && restored.queries) {
		restored.queries.forEach((query: any) => {
			queryClient.setQueryData(query.queryKey, query.state.data)
		})
	}

	// Persist on cache changes with debouncing
	queryClient.getQueryCache().subscribe((event) => {
		if (event?.type === 'updated' || event?.type === 'added') {
			const query = event.query
			const queryKey = query.queryKey
			if (Array.isArray(queryKey) && queryKey[0] === 'orders') {
				// Debounce persistence
				if (persistTimeout) {
					clearTimeout(persistTimeout)
				}
				persistTimeout = setTimeout(() => {
					persistCache()
					persistTimeout = null
				}, 500)
			}
		}
	})

	// Also persist periodically
	setInterval(() => persistCache(), 30000) // Every 30 seconds
}
