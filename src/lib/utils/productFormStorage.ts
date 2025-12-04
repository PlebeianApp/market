import type { ProductFormState } from '@/lib/stores/product'

const DB_NAME = 'plebeian_market_db'
const DB_VERSION = 1
const STORE_NAME = 'product_form_drafts'

type ProductFormDraft = Omit<ProductFormState, 'mainTab' | 'productSubTab'> & {
	savedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

const isBrowserEnvironment = () => typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

const openDB = (): Promise<IDBDatabase> => {
	if (!isBrowserEnvironment()) {
		return Promise.reject(new Error('IndexedDB not available'))
	}

	if (dbPromise) return dbPromise

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)

		request.onerror = () => {
			dbPromise = null
			reject(request.error)
		}

		request.onsuccess = () => {
			resolve(request.result)
		}

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result

			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'editingProductId' })
			}
		}
	})

	return dbPromise
}

export const saveProductFormDraft = async (productId: string, formState: ProductFormState): Promise<void> => {
	if (!isBrowserEnvironment() || !productId) return

	try {
		const db = await openDB()

		// Exclude tab state from persistence - we only want to save actual form data
		const { mainTab: _mainTab, productSubTab: _productSubTab, ...dataToSave } = formState

		const draft: ProductFormDraft = {
			...dataToSave,
			editingProductId: productId,
			savedAt: Date.now(),
		}

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.put(draft)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to save product form draft:', error)
	}
}

export const getProductFormDraft = async (productId: string): Promise<ProductFormDraft | null> => {
	if (!isBrowserEnvironment() || !productId) return null

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readonly')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.get(productId)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve(request.result || null)
		})
	} catch (error) {
		console.error('Failed to get product form draft:', error)
		return null
	}
}

export const clearProductFormDraft = async (productId: string): Promise<void> => {
	if (!isBrowserEnvironment() || !productId) return

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.delete(productId)

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to clear product form draft:', error)
	}
}

export const hasProductFormDraft = async (productId: string): Promise<boolean> => {
	const draft = await getProductFormDraft(productId)
	return draft !== null
}

export const clearAllProductFormDrafts = async (): Promise<void> => {
	if (!isBrowserEnvironment()) return

	try {
		const db = await openDB()

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, 'readwrite')
			const store = transaction.objectStore(STORE_NAME)
			const request = store.clear()

			request.onerror = () => reject(request.error)
			request.onsuccess = () => resolve()
		})
	} catch (error) {
		console.error('Failed to clear all product form drafts:', error)
	}
}
