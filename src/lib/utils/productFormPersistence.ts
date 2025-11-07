import type { ProductFormState } from '@/lib/stores/product'

const DB_NAME = 'plebeian-market-product-form'
const STORE_NAME = 'productFormState'
const VERSION = 1
const KEY = 'new-product-draft'

/**
 * IndexedDB utility for persisting product form state
 */
class ProductFormIndexedDB {
	private db: IDBDatabase | null = null

	async init(): Promise<void> {
		if (this.db) return

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, VERSION)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => {
				this.db = request.result
				resolve()
			}

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME)
				}
			}
		})
	}

	async saveFormState(state: ProductFormState): Promise<void> {
		if (typeof window === 'undefined' || !('indexedDB' in window)) {
			return
		}

		try {
			await this.init()

			const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.put(JSON.stringify(state), KEY)

			await new Promise<void>((resolve, reject) => {
				request.onerror = () => reject(request.error)
				request.onsuccess = () => resolve()
				transaction.onerror = () => reject(transaction.error)
			})
		} catch (error) {
			// Silently fail - persistence is best effort
			console.warn('Failed to save product form state:', error)
		}
	}

	async loadFormState(): Promise<ProductFormState | null> {
		if (typeof window === 'undefined' || !('indexedDB' in window)) {
			return null
		}

		try {
			await this.init()

			const transaction = this.db!.transaction([STORE_NAME], 'readonly')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.get(KEY)

			return new Promise((resolve, reject) => {
				request.onerror = () => reject(request.error)
				request.onsuccess = () => {
					const result = request.result
					if (result) {
						try {
							resolve(JSON.parse(result) as ProductFormState)
						} catch (error) {
							resolve(null)
						}
					} else {
						resolve(null)
					}
				}
			})
		} catch (error) {
			console.warn('Failed to load product form state:', error)
			return null
		}
	}

	async clearFormState(): Promise<void> {
		if (typeof window === 'undefined' || !('indexedDB' in window)) {
			return
		}

		try {
			await this.init()

			const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.delete(KEY)

			await new Promise<void>((resolve, reject) => {
				request.onerror = () => reject(request.error)
				request.onsuccess = () => resolve()
				transaction.onerror = () => reject(transaction.error)
			})
		} catch (error) {
			// Silently fail - cleanup is best effort
			console.warn('Failed to clear product form state:', error)
		}
	}
}

const persistence = new ProductFormIndexedDB()

/**
 * Save product form state to IndexedDB
 * Only saves if editingProductId is null (new product)
 */
export const saveProductFormState = async (state: ProductFormState): Promise<void> => {
	// Only persist draft state for new products, not when editing
	if (state.editingProductId) {
		return
	}

	await persistence.saveFormState(state)
}

/**
 * Load product form state from IndexedDB
 */
export const loadProductFormState = async (): Promise<ProductFormState | null> => {
	return await persistence.loadFormState()
}

/**
 * Clear product form state from IndexedDB
 */
export const clearProductFormState = async (): Promise<void> => {
	await persistence.clearFormState()
}
