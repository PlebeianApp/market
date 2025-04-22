import { fetchProduct, getProductPrice, getProductSellerPubkey } from '@/queries/products'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { debounce } from '../utils'
import { useEffect, useState } from 'react'

export interface ProductImage {
	url: string
	alt?: string
}

export interface ProductShipping {
	shippingId: string
	cost: number
}

export interface InvoiceMessage {
	id: string
	amount: number
	status?: string
	[key: string]: any
}

export interface OrderMessage {
	id: string
	status: OrderStatus
	[key: string]: any
}

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export interface V4VDTO {
	id: string
	name: string
	pubkey: string
	percentage: number
}

export interface RichShippingInfo {
	id: string
	name?: string
	cost?: number
	[key: string]: any
}

export const v4VForUserQuery = async (userPubkey: string): Promise<V4VDTO[]> => {
	// Mock implementation
	return []
}

export interface CartProduct {
	id: string // Product ID (the only required field)
	amount: number
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	sellerPubkey?: string // Keep seller's pubkey for grouping
}

export interface CartUser {
	pubkey: string
	productIds: string[]
	v4vShares: V4VDTO[]
}

export interface NormalizedCart {
	users: Record<string, CartUser>
	products: Record<string, CartProduct>
	orders: Record<string, OrderMessage>
	invoices: Record<string, InvoiceMessage>
}

export interface CartTotals {
	subtotalInSats: number
	shippingInSats: number
	totalInSats: number
	currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }>
}

interface CartState {
	cart: NormalizedCart
	v4vShares: Record<string, V4VDTO[]>
	userCartTotalInSats: Record<string, number>
}

const initialState: CartState = {
	cart: { users: {}, products: {}, orders: {}, invoices: {} },
	v4vShares: {},
	userCartTotalInSats: {},
}

function loadInitialCart(): NormalizedCart {
	if (typeof sessionStorage !== 'undefined') {
		const storedCart = sessionStorage.getItem('cart')
		if (storedCart) {
			return JSON.parse(storedCart)
		}
	}
	return { users: {}, products: {}, orders: {}, invoices: {} }
}

// Initialize state with saved cart
const initialCartState: CartState = {
	...initialState,
	cart: loadInitialCart(),
}

// Simple conversion rate for calculation without hooks
// In a real app, you would use a more sophisticated approach
const CONVERSION_RATES: Record<string, number> = {
	USD: 40000, // 1 USD = 40,000 sats (for example)
	EUR: 43000,
	GBP: 50000,
	// Add more currencies as needed
}

export const cartStore = new Store<CartState>(initialCartState)

// Cache for product events to reduce API calls
const productEventCache: Record<string, NDKEvent | null> = {}

// Helper function to get product event, with caching
const getProductEvent = async (id: string): Promise<NDKEvent | null> => {
	if (productEventCache[id] !== undefined) {
		return productEventCache[id]
	}

	try {
		const event = await fetchProduct(id)
		productEventCache[id] = event
		return event
	} catch (error) {
		console.error(`Failed to fetch product event: ${id}`, error)
		productEventCache[id] = null
		return null
	}
}

export const cartActions = {
	saveToStorage: async (cart: NormalizedCart) => {
		if (typeof sessionStorage !== 'undefined') {
			// Create a serializable copy without circular references
			const serializableCart = JSON.parse(
				JSON.stringify({
					users: cart.users,
					products: cart.products,
					orders: cart.orders,
					invoices: cart.invoices,
				}),
			)

			sessionStorage.setItem('cart', JSON.stringify(serializableCart))
		}
	},

	convertNDKEventToCartProduct: (event: NDKEvent, amount: number = 1): CartProduct => {
		return {
			id: event.id,
			amount: amount,
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			sellerPubkey: event.pubkey,
		}
	},

	findOrCreateUserProduct: (cart: NormalizedCart, userPubkey: string, productId?: string) => {
		const user = cart.users[userPubkey] || { pubkey: userPubkey, productIds: [], v4vShares: [] }
		if (!cart.users[userPubkey]) {
			cart.users[userPubkey] = user
		}

		const product = productId ? cart.products[productId] : undefined

		return { user, product }
	},

	addProduct: async (userPubkey: string, productData: CartProduct | NDKEvent | string) => {
		let productId: string
		let sellerPubkey: string | undefined
		let amount = 1

		// Handle different input types
		if (typeof productData === 'string') {
			// If just an ID is provided
			productId = productData
			// We'll fetch the seller pubkey
			try {
				const pubkey = await getProductSellerPubkey(productId)
				sellerPubkey = pubkey || undefined
			} catch (error) {
				console.error('Failed to fetch seller pubkey:', error)
			}
		} else if (productData instanceof NDKEvent) {
			// If an NDK event is provided
			productId = productData.id
			sellerPubkey = productData.pubkey
		} else {
			// If a CartProduct object is provided
			productId = productData.id
			sellerPubkey = productData.sellerPubkey
			amount = productData.amount
		}

		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const { user } = cartActions.findOrCreateUserProduct(cart, userPubkey)

			if (cart.products[productId]) {
				// Simply update the amount
				cart.products[productId].amount += amount
			} else {
				// Add minimal product info
				cart.products[productId] = {
					id: productId,
					amount: amount,
					shippingMethodId: null,
					shippingMethodName: null,
					shippingCost: 0,
					sellerPubkey,
				}
				user.productIds.push(productId)
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		// Update v4v shares and cart totals
		await cartActions.updateV4VShares()
		await cartActions.updateCartTotals()
	},

	updateProductAmount: async (userPubkey: string, productId: string, amount: number) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const product = cart.products[productId]
			if (product) {
				product.amount = amount
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateCartTotals()
	},

	removeProduct: async (userPubkey: string, productId: string) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const user = cart.users[userPubkey]

			if (user) {
				user.productIds = user.productIds.filter((id) => id !== productId)
				delete cart.products[productId]

				// Clean up empty users
				if (user.productIds.length === 0) {
					delete cart.users[userPubkey]
				}
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateV4VShares()
		await cartActions.updateCartTotals()
	},

	setShippingMethod: async (productId: string, shipping: Partial<RichShippingInfo>) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const product = cart.products[productId]

			if (product && shipping.id) {
				product.shippingMethodId = shipping.id
				product.shippingCost = Number(shipping.cost)
				product.shippingMethodName = shipping.name ?? null
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateCartTotals()
	},

	getShippingMethod: (productId: string): string | null => {
		const state = cartStore.state
		return state.cart.products[productId]?.shippingMethodId || null
	},

	clear: () => {
		cartStore.setState((state) => ({
			...state,
			cart: { users: {}, products: {}, orders: {}, invoices: {} },
		}))

		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem('cart')
		}
	},

	clearKeys: (keys: (keyof NormalizedCart)[]) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			keys.forEach((key) => {
				cart[key] = {}
			})
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})
	},

	handleProductUpdate: async (action: string, userPubkey: string, productId: string, amount?: number) => {
		// First update the state synchronously
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const user = cart.users[userPubkey]

			switch (action) {
				case 'increment':
					if (cart.products[productId]) {
						cart.products[productId].amount += 1
					}
					break
				case 'decrement':
					if (cart.products[productId]) {
						const newAmount = Math.max(cart.products[productId].amount - 1, 0)

						// If the amount would be zero, remove the product instead
						if (newAmount === 0) {
							// Handle removal (same logic as 'remove' case)
							if (user) {
								user.productIds = user.productIds.filter((id) => id !== productId)
								delete cart.products[productId]

								if (user.productIds.length === 0) {
									delete cart.users[userPubkey]
								}
							}
						} else {
							cart.products[productId].amount = newAmount
						}
					}
					break
				case 'setAmount':
					if (amount !== undefined && cart.products[productId]) {
						// If setting to zero or less, remove the product
						if (amount <= 0) {
							// Handle removal (same logic as 'remove' case)
							if (user) {
								user.productIds = user.productIds.filter((id) => id !== productId)
								delete cart.products[productId]

								if (user.productIds.length === 0) {
									delete cart.users[userPubkey]
								}
							}
						} else {
							cart.products[productId].amount = amount
						}
					}
					break
				case 'remove': {
					if (user) {
						user.productIds = user.productIds.filter((id) => id !== productId)
						delete cart.products[productId]

						if (user.productIds.length === 0) {
							delete cart.users[userPubkey]
						}
					}
					break
				}
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		// Then update the cart totals asynchronously
		await cartActions.updateCartTotals()
	},

	// Convert currency to sats using a simple conversion rate
	convertToSats: (currency: string, amount: number): number => {
		const rate = CONVERSION_RATES[currency] || CONVERSION_RATES.USD // Default to USD if currency not found
		return Math.round(amount * rate)
	},

	calculateProductTotal: async (
		productId: string,
	): Promise<{
		subtotalInSats: number
		shippingInSats: number
		totalInSats: number
		subtotalInCurrency: number
		shippingInCurrency: number
		totalInCurrency: number
		currency: string
	}> => {
		const state = cartStore.state
		const product = state.cart.products[productId]

		if (!product) {
			return {
				subtotalInSats: 0,
				shippingInSats: 0,
				totalInSats: 0,
				subtotalInCurrency: 0,
				shippingInCurrency: 0,
				totalInCurrency: 0,
				currency: '',
			}
		}

		try {
			// Get product price information from the product query functions
			const event = await getProductEvent(productId)
			if (!event) {
				throw new Error(`Product not found: ${productId}`)
			}

			const priceTag = getProductPrice(event)
			const price = priceTag ? parseFloat(priceTag[1]) : 0
			const currency = priceTag ? priceTag[2] : 'USD'

			const productTotalInCurrency = price * product.amount
			const shippingCost = product.shippingCost || 0

			// Use our simple conversion function
			const productTotalInSats = cartActions.convertToSats(currency, productTotalInCurrency)
			const shippingInSats = cartActions.convertToSats(currency, shippingCost)

			return {
				subtotalInSats: productTotalInSats,
				shippingInSats: shippingInSats,
				totalInSats: productTotalInSats + shippingInSats,
				subtotalInCurrency: productTotalInCurrency,
				shippingInCurrency: shippingCost,
				totalInCurrency: productTotalInCurrency + shippingCost,
				currency: currency,
			}
		} catch (error) {
			console.error(`Error calculating product total for ${productId}:`, error)
			return {
				subtotalInSats: 0,
				shippingInSats: 0,
				totalInSats: 0,
				subtotalInCurrency: 0,
				shippingInCurrency: 0,
				totalInCurrency: 0,
				currency: 'USD',
			}
		}
	},

	calculateUserTotal: async (userPubkey: string): Promise<CartTotals | null> => {
		const state = cartStore.state
		const user = state.cart.users[userPubkey]
		if (!user) return null

		let subtotalInSats = 0
		let shippingInSats = 0
		let totalInSats = 0
		const currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }> = {}

		// Use Promise.all to wait for all product totals
		const productTotals = await Promise.all(user.productIds.map((productId) => cartActions.calculateProductTotal(productId)))

		for (const productTotal of productTotals) {
			subtotalInSats += productTotal.subtotalInSats
			shippingInSats += productTotal.shippingInSats
			totalInSats += productTotal.totalInSats

			if (!currencyTotals[productTotal.currency]) {
				currencyTotals[productTotal.currency] = { subtotal: 0, shipping: 0, total: 0 }
			}
			currencyTotals[productTotal.currency].subtotal += productTotal.subtotalInCurrency
			currencyTotals[productTotal.currency].shipping += productTotal.shippingInCurrency
			currencyTotals[productTotal.currency].total += productTotal.totalInCurrency
		}

		return { subtotalInSats, shippingInSats, totalInSats, currencyTotals }
	},

	calculateGrandTotal: async () => {
		const state = cartStore.state
		if (Object.keys(state.cart.users).length === 0) {
			return {
				grandSubtotalInSats: 0,
				grandShippingInSats: 0,
				grandTotalInSats: 0,
				currencyTotals: {},
			}
		}

		let grandSubtotalInSats = 0
		let grandShippingInSats = 0
		let grandTotalInSats = 0
		const currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }> = {}

		// Wait for all user totals
		const userTotalsPromises = Object.keys(state.cart.users).map((userPubkey) => {
			return cartActions.calculateUserTotal(userPubkey)
		})

		const userTotals = await Promise.all(userTotalsPromises)

		for (const userTotal of userTotals) {
			if (userTotal) {
				grandSubtotalInSats += userTotal.subtotalInSats
				grandShippingInSats += userTotal.shippingInSats
				grandTotalInSats += userTotal.totalInSats

				for (const [currency, amounts] of Object.entries(userTotal.currencyTotals)) {
					if (!currencyTotals[currency]) {
						currencyTotals[currency] = { subtotal: 0, shipping: 0, total: 0 }
					}
					currencyTotals[currency].subtotal += amounts.subtotal
					currencyTotals[currency].shipping += amounts.shipping
					currencyTotals[currency].total += amounts.total
				}
			}
		}

		return {
			grandSubtotalInSats,
			grandShippingInSats,
			grandTotalInSats,
			currencyTotals,
		}
	},

	addOrder: (order: OrderMessage) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			cart.orders = {
				...cart.orders,
				[order.id as string]: order,
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})
	},

	updateInvoice: (invoice: InvoiceMessage) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			cart.invoices = {
				...cart.invoices,
				[invoice.id]: invoice,
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})
	},

	addInvoice: (invoice: InvoiceMessage) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			cart.invoices = {
				...cart.invoices,
				[invoice.id]: invoice,
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})
	},

	updateOrderStatus: (orderId: string, status: OrderStatus) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			if (cart.orders[orderId]) {
				cart.orders[orderId] = {
					...cart.orders[orderId],
					status: status,
				}
			} else {
				console.warn(`Attempted to update non-existent order: ${orderId}`)
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})
	},

	updateV4VShares: async () => {
		const state = cartStore.state
		const shares: Record<string, V4VDTO[]> = {}

		for (const userPubkey of Object.keys(state.cart.users)) {
			try {
				const userShares = await v4VForUserQuery(userPubkey)
				shares[userPubkey] = userShares || []
			} catch (error) {
				console.error(`Failed to fetch v4v shares for user ${userPubkey}:`, error)
				shares[userPubkey] = []
			}
		}

		cartStore.setState((state) => ({
			...state,
			v4vShares: shares,
		}))
	},

	updateCartTotals: async () => {
		const updateTotals = async () => {
			// Calculate cart total in sats
			const state = cartStore.state
			const userTotals: Record<string, number> = {}

			try {
				for (const user of Object.values(state.cart.users)) {
					let userTotalSats = 0

					for (const productId of user.productIds) {
						try {
							const productTotal = await cartActions.calculateProductTotal(productId)
							userTotalSats += productTotal.totalInSats
						} catch (error) {
							console.error(`Error calculating total for product ${productId}:`, error)
						}
					}

					userTotals[user.pubkey] = userTotalSats
				}

				cartStore.setState((state) => ({
					...state,
					userCartTotalInSats: userTotals,
				}))
			} catch (error) {
				console.error('Error updating cart totals:', error)
			}
		}

		// Create a debounced version of updateTotals
		const debouncedUpdate = debounce(() => {
			updateTotals().catch((err) => console.error('Error in updateCartTotals:', err))
		}, 250)

		debouncedUpdate()
	},

	calculateTotalItems: () => {
		const state = cartStore.state
		return Object.values(state.cart.products).reduce((total, product) => {
			return total + product.amount
		}, 0)
	},

	calculateAmountsByCurrency: async () => {
		const state = cartStore.state
		const result: Record<string, number> = {}

		for (const product of Object.values(state.cart.products)) {
			try {
				const event = await getProductEvent(product.id)
				if (!event) continue

				const priceTag = getProductPrice(event)
				if (!priceTag) continue

				const currency = priceTag[2]
				const price = parseFloat(priceTag[1])

				if (!result[currency]) {
					result[currency] = 0
				}
				result[currency] += price * product.amount
			} catch (error) {
				console.error(`Error getting product details for ${product.id}:`, error)
			}
		}

		return result
	},

	getUserPubkey: () => {
		const state = cartStore.state
		// Get the first user pubkey (assuming there's only one user for now)
		return Object.keys(state.cart.users)[0] || null
	},

	calculateProductSubtotal: async (productId: string): Promise<{ value: number; currency: string }> => {
		const state = cartStore.state
		const product = state.cart.products[productId]
		if (!product) {
			return { value: 0, currency: 'USD' }
		}

		try {
			const event = await getProductEvent(productId)
			if (!event) {
				return { value: 0, currency: 'USD' }
			}

			const priceTag = getProductPrice(event)
			const price = priceTag ? parseFloat(priceTag[1]) : 0
			const currency = priceTag ? priceTag[2] : 'USD'

			return {
				value: price * product.amount,
				currency: currency,
			}
		} catch (error) {
			console.error(`Error calculating product subtotal for ${productId}:`, error)
			return { value: 0, currency: 'USD' }
		}
	},

	// Group products by seller
	groupProductsBySeller: () => {
		const state = cartStore.state
		const grouped: Record<string, CartProduct[]> = {}

		// Default group for products without seller info
		const unknownSeller = 'unknown'
		grouped[unknownSeller] = []

		// Group products by seller pubkey
		Object.values(state.cart.products).forEach((product) => {
			// Use the sellerPubkey property if available
			if (product.sellerPubkey) {
				const sellerPubkey = product.sellerPubkey
				if (!grouped[sellerPubkey]) {
					grouped[sellerPubkey] = []
				}
				grouped[sellerPubkey].push(product)
			}
			// Otherwise add to unknown group
			else {
				grouped[unknownSeller].push(product)
			}
		})

		// Remove empty groups
		Object.keys(grouped).forEach((key) => {
			if (grouped[key].length === 0) {
				delete grouped[key]
			}
		})

		return grouped
	},
}

export const useCart = () => {
	return {
		...cartStore.state,
		...cartActions,
	}
}

export async function handleAddToCart(userId: string, product: Partial<CartProduct> | NDKEvent | string | null) {
	if (!product) return false

	// Handle string case (just ID)
	if (typeof product === 'string') {
		await cartActions.addProduct(userId, product)
		return true
	}

	// Handle NDKEvent case
	if (product instanceof NDKEvent) {
		await cartActions.addProduct(userId, product)
		return true
	}

	// Handle CartProduct case
	if ('id' in product && product.id) {
		// Create a complete CartProduct from the partial one
		const cartProduct: CartProduct = {
			id: product.id,
			amount: product.amount || 1,
			shippingMethodId: product.shippingMethodId || null,
			shippingMethodName: product.shippingMethodName || null,
			shippingCost: product.shippingCost || 0,
			sellerPubkey: product.sellerPubkey,
		}

		await cartActions.addProduct(userId, cartProduct)
		return true
	}

	return false
}

// New hook to access real-time cart totals
export function useCartTotals() {
	const { cart } = useCart()
	const [totals, setTotals] = useState({
		totalItems: 0,
		subtotalByCurrency: {} as Record<string, number>,
	})

	// Create a signature to detect changes to cart amounts
	const cartSignature = Object.values(cart.products)
		.map((p) => `${p.id}:${p.amount}`)
		.join(',')

	useEffect(() => {
		const calculateTotals = async () => {
			// Get total item count
			const itemCount = cartActions.calculateTotalItems()

			// Get subtotals by currency
			const subtotals = await cartActions.calculateAmountsByCurrency()

			setTotals({
				totalItems: itemCount,
				subtotalByCurrency: subtotals,
			})
		}

		calculateTotals()
	}, [cartSignature, cart.products])

	return totals
}
