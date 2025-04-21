import { Store } from '@tanstack/store'
import { debounce } from '../utils'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getProductImages, getProductPrice, getProductStock, getProductTitle } from '@/queries/products'

// Mock types that would be imported from @plebeian/database
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

// Mock types from v4v.queries
export interface V4VDTO {
	id: string
	name: string
	pubkey: string
	percentage: number
}

// Mock RichShippingInfo from shipping.service
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
	id: string
	name: string
	amount: number
	price: number
	currency: string
	stockQuantity: number
	images?: ProductImage[]
	shipping: ProductShipping[]
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	originalEventId?: string // Store only the ID instead of the full event
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
		const title = getProductTitle(event)
		const priceTag = getProductPrice(event)
		const stockTag = getProductStock(event)
		const images = getProductImages(event)

		// Format price to number and get currency
		const price = priceTag ? parseFloat(priceTag[1]) : 0
		const currency = priceTag ? priceTag[2] : 'USD'

		// Get stock quantity
		const stockQuantity = stockTag ? parseInt(stockTag[1]) : 0

		// Format images
		const formattedImages: ProductImage[] = images.map((img) => ({
			url: img[1],
			alt: title,
		}))

		return {
			id: event.id,
			name: title,
			amount: amount,
			price: price,
			currency: currency,
			stockQuantity: stockQuantity,
			images: formattedImages,
			shipping: [],
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			originalEventId: event.id, // Store only the ID
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

	addProduct: async (userPubkey: string, productData: CartProduct | NDKEvent) => {
		// Convert NDKEvent to CartProduct if needed
		const product = productData instanceof NDKEvent ? cartActions.convertNDKEventToCartProduct(productData) : productData

		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const { user } = cartActions.findOrCreateUserProduct(cart, userPubkey)

			if (cart.products[product.id]) {
				cart.products[product.id].amount = Math.min(cart.products[product.id].amount + product.amount, product.stockQuantity)
			} else {
				cart.products[product.id] = { ...product }
				user.productIds.push(product.id)
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
				product.amount = Math.min(amount, product.stockQuantity)
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
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const user = cart.users[userPubkey]

			switch (action) {
				case 'increment':
					if (cart.products[productId]) {
						cart.products[productId].amount = Math.min(cart.products[productId].amount + 1, cart.products[productId].stockQuantity)
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
							cart.products[productId].amount = Math.min(amount, cart.products[productId].stockQuantity)
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

		await cartActions.updateCartTotals()
	},

	// Convert currency to sats using a simple conversion rate
	convertToSats: (currency: string, amount: number): number => {
		const rate = CONVERSION_RATES[currency] || CONVERSION_RATES.USD // Default to USD if currency not found
		return Math.round(amount * rate)
	},

	calculateProductTotal: (
		productId: string,
	): {
		subtotalInSats: number
		shippingInSats: number
		totalInSats: number
		subtotalInCurrency: number
		shippingInCurrency: number
		totalInCurrency: number
		currency: string
	} => {
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

		const productTotalInCurrency = product.price * product.amount
		const shippingCost = product.shippingCost || 0

		// Use our simple conversion function
		const productTotalInSats = cartActions.convertToSats(product.currency, productTotalInCurrency)
		const shippingInSats = cartActions.convertToSats(product.currency, shippingCost)

		return {
			subtotalInSats: productTotalInSats,
			shippingInSats: shippingInSats,
			totalInSats: productTotalInSats + shippingInSats,
			subtotalInCurrency: productTotalInCurrency,
			shippingInCurrency: shippingCost,
			totalInCurrency: productTotalInCurrency + shippingCost,
			currency: product.currency,
		}
	},

	calculateUserTotal: (userPubkey: string): CartTotals | null => {
		const state = cartStore.state
		const user = state.cart.users[userPubkey]
		if (!user) return null

		let subtotalInSats = 0
		let shippingInSats = 0
		let totalInSats = 0
		const currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }> = {}

		const productTotals = user.productIds.map((productId) => {
			return cartActions.calculateProductTotal(productId)
		})

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

	calculateGrandTotal: () => {
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

		const userTotals = Object.keys(state.cart.users).map((userPubkey) => {
			return cartActions.calculateUserTotal(userPubkey)
		})

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
		const updateTotals = () => {
			// Calculate cart total in sats
			const state = cartStore.state
			const userTotals: Record<string, number> = {}

			try {
				for (const user of Object.values(state.cart.users)) {
					let userTotalSats = 0

					for (const productId of user.productIds) {
						const product = state.cart.products[productId]
						const productTotal = cartActions.calculateProductTotal(productId)
						userTotalSats += productTotal.totalInSats
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
		const debouncedUpdate = debounce(updateTotals, 250)
		debouncedUpdate()
	},

	calculateTotalItems: () => {
		const state = cartStore.state
		return Object.values(state.cart.products).reduce((total, product) => {
			return total + product.amount
		}, 0)
	},

	calculateAmountsByCurrency: () => {
		const state = cartStore.state
		return Object.values(state.cart.products).reduce(
			(acc, product) => {
				const currency = product.currency
				if (!acc[currency]) {
					acc[currency] = 0
				}
				acc[currency] += product.price * product.amount
				return acc
			},
			{} as Record<string, number>,
		)
	},

	getUserPubkey: () => {
		const state = cartStore.state
		// Get the first user pubkey (assuming there's only one user for now)
		return Object.keys(state.cart.users)[0] || null
	},

	calculateProductSubtotal: (productId: string): { value: number; currency: string } => {
		const state = cartStore.state
		const product = state.cart.products[productId]
		if (!product) {
			return { value: 0, currency: 'USD' }
		}
		return {
			value: product.price * product.amount,
			currency: product.currency,
		}
	},
}

export const useCart = () => {
	return {
		...cartStore.state,
		...cartActions,
	}
}

export async function handleAddToCart(userId: string, product: Partial<CartProduct> | NDKEvent | null) {
	if (!product) return false

	// Handle NDKEvent case
	if (product instanceof NDKEvent) {
		await cartActions.addProduct(userId, product)
		return true
	}

	// Handle CartProduct case
	if ('id' in product && product.id) {
		const currentState = cartStore.state
		const currentAmount = currentState.cart.products[product.id]?.amount || 0

		const availableStock = product.stockQuantity ?? 0
		const amountToAdd = Math.min(1, availableStock - currentAmount)

		if (amountToAdd > 0 && product.price !== undefined && product.name !== undefined) {
			await cartActions.addProduct(userId, {
				id: product.id,
				name: product.name,
				amount: amountToAdd,
				price: Number(product.price) || 0,
				stockQuantity: availableStock,
				images: product.images,
				currency: product.currency as string,
				shipping: product.shipping || [],
				shippingMethodId: null,
				shippingMethodName: null,
				shippingCost: 0,
			})
			return true
		}
	}

	return false
}
