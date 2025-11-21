import type { PaymentInvoiceData } from '@/lib/types/invoice'

const STORAGE_KEY = 'market_invoice_history_v1'

type InvoiceStorageMap = Record<string, PaymentInvoiceData[]>

const isBrowserEnvironment = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

const readStorage = (): InvoiceStorageMap => {
	if (!isBrowserEnvironment()) {
		return {}
	}

	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as InvoiceStorageMap
		return parsed ?? {}
	} catch (error) {
		console.error('Failed to read invoice storage:', error)
		return {}
	}
}

const writeStorage = (data: InvoiceStorageMap) => {
	if (!isBrowserEnvironment()) return

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
	} catch (error) {
		console.error('Failed to persist invoices:', error)
	}
}

const upsertInvoice = (store: InvoiceStorageMap, invoice: PaymentInvoiceData) => {
	const orderKey = invoice.orderId || 'unknown-order'
	const bucket = store[orderKey] ? [...store[orderKey]] : []
	const now = Date.now()

	const nextInvoice: PaymentInvoiceData = {
		...invoice,
		persistedAt: invoice.persistedAt ?? now,
		updatedAt: now,
	}

	const idx = bucket.findIndex((entry) => entry.id === invoice.id)
	if (idx >= 0) {
		bucket[idx] = { ...bucket[idx], ...nextInvoice }
	} else {
		bucket.push(nextInvoice)
	}

	store[orderKey] = bucket
}

export const persistInvoicesLocally = (invoices: PaymentInvoiceData[]) => {
	if (!invoices.length) return
	const store = readStorage()
	invoices.forEach((invoice) => upsertInvoice(store, invoice))
	writeStorage(store)
}

export const updatePersistedInvoiceLocally = (orderId: string, invoiceId: string, updates: Partial<PaymentInvoiceData>) => {
	if (!orderId || !invoiceId) return
	const store = readStorage()
	const bucket = store[orderId]
	if (!bucket) return

	const idx = bucket.findIndex((invoice) => invoice.id === invoiceId)
	if (idx === -1) return

	bucket[idx] = {
		...bucket[idx],
		...updates,
		updatedAt: Date.now(),
	}

	store[orderId] = bucket
	writeStorage(store)
}

export const getPersistedInvoicesForOrder = (orderId: string): PaymentInvoiceData[] => {
	if (!orderId) return []
	const store = readStorage()
	return store[orderId]?.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) ?? []
}

export const clearPersistedInvoicesForOrder = (orderId: string) => {
	if (!orderId) return
	const store = readStorage()
	if (!store[orderId]) return
	delete store[orderId]
	writeStorage(store)
}
