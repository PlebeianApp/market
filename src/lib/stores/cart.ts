import { CURRENCIES, HEX_KEYS_REGEX } from '@/lib/constants'
import type { SupportedCurrency } from '@/queries/external'
import { btcExchangeRatesQueryOptions, currencyConversionQueryOptions } from '@/queries/external'
import { getProductId, getProductPrice, getProductSellerPubkey, productQueryOptions, productByATagQueryOptions } from '@/queries/products'
import {
	getShippingInfo,
	getShippingPrice,
	shippingOptionQueryOptions,
	shippingOptionsByPubkeyQueryOptions,
	shippingOptionByCoordinatesQueryOptions,
} from '@/queries/shipping'
import { v4VForUserQuery } from '@/queries/v4v'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { QueryClient } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { Store } from '@tanstack/store'
import { useEffect } from 'react'
import { SHIPPING_KIND } from '../schemas/shippingOption'

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
	currency?: string
	countries?: string[]
	service?: string
	carrier?: string
	[key: string]: any
}

export interface CartProduct {
	id: string
	amount: number
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string | null
	sellerPubkey: string
}

export interface CartSeller {
	pubkey: string
	productIds: string[]
	currency: string
	shippingMethodId: string | null
	shippingMethodName: string | null
	shippingCost: number
	shippingCostCurrency: string | null
	v4vShares: V4VDTO[]
}

export interface NormalizedCart {
	sellers: Record<string, CartSeller>
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
	sellerData: Record<
		string,
		{
			satsTotal: number
			currencyTotals: Record<string, number>
			shares: { sellerAmount: number; communityAmount: number; sellerPercentage: number }
			shippingSats: number
		}
	>
	productsBySeller: Record<string, CartProduct[]>
	totalInSats: number
	totalShippingInSats: number
	subtotalByCurrency: Record<string, number>
	shippingByCurrency: Record<string, number>
	totalByCurrency: Record<string, number>
	sellerShippingOptions: Record<string, RichShippingInfo[]>
}

function loadInitialV4VShares(): Record<string, V4VDTO[]> {
	if (typeof sessionStorage !== 'undefined') {
		const storedShares = sessionStorage.getItem('v4vShares')
		if (storedShares) {
			try {
				return JSON.parse(storedShares)
			} catch (error) {
				console.error('Failed to parse stored V4V shares:', error)
			}
		}
	}
	return {}
}

const initialState: CartState = {
	cart: { sellers: {}, products: {}, orders: {}, invoices: {} },
	v4vShares: {},
	sellerData: {},
	productsBySeller: {},
	totalInSats: 0,
	totalShippingInSats: 0,
	subtotalByCurrency: {},
	shippingByCurrency: {},
	totalByCurrency: {},
	sellerShippingOptions: {},
}

// Helper function to compute productsBySeller from products (used during init and updates)
function computeProductsBySeller(products: Record<string, CartProduct>): Record<string, CartProduct[]> {
	const grouped: Record<string, CartProduct[]> = {}

	Object.values(products).forEach((product) => {
		if (HEX_KEYS_REGEX.test(product.sellerPubkey ?? '')) {
			if (!grouped[product.sellerPubkey]) {
				grouped[product.sellerPubkey] = []
			}
			grouped[product.sellerPubkey].push(product)
		}
	})

	return grouped
}

function loadInitialCart(): NormalizedCart {
	if (typeof sessionStorage !== 'undefined') {
		const storedCart = sessionStorage.getItem('cart')
		if (storedCart) {
			const cart: NormalizedCart = JSON.parse(storedCart)

			// Validate products - filter out any with invalid/missing sellerPubkey
			// This prevents count mismatch between badge and cart display
			const validProducts: Record<string, CartProduct> = {}
			const invalidProductIds: string[] = []

			for (const [productId, product] of Object.entries(cart.products)) {
				if (product.sellerPubkey && product.sellerPubkey.length > 0) {
					validProducts[productId] = product
				} else {
					invalidProductIds.push(productId)
				}
			}

			if (invalidProductIds.length > 0) {
				console.warn('Removed invalid cart products without sellerPubkey:', invalidProductIds)
			}

			cart.products = validProducts

			// Clean up sellers that reference removed products
			for (const [sellerPubkey, seller] of Object.entries(cart.sellers)) {
				seller.productIds = seller.productIds.filter((id) => validProducts[id])
				if (seller.productIds.length === 0) {
					delete cart.sellers[sellerPubkey]
				}
			}

			return cart
		}
	}
	return { sellers: {}, products: {}, orders: {}, invoices: {} }
}

// Load cart and compute initial productsBySeller synchronously
const loadedCart = loadInitialCart()
const initialProductsBySeller = computeProductsBySeller(loadedCart.products)

const initialCartState: CartState = {
	...initialState,
	cart: loadedCart,
	v4vShares: loadInitialV4VShares(),
	productsBySeller: initialProductsBySeller,
}

const numSatsInBtc = 100000000 // 100 million sats in 1 BTC

export const cartStore = new Store<CartState>(initialCartState)

const cartQueryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 1000 * 60 * 5, // 5 minutes
			retry: 2,
			retryDelay: 1000,
		},
	},
})

// Helper to check if an ID looks like a Nostr event ID (64-hex characters)
const isEventId = (id: string): boolean => /^[a-f0-9]{64}$/i.test(id)

/**
 * Fetches a product event by ID.
 * Supports both event IDs (64-hex characters) and d-tags.
 * For d-tags, the sellerPubkey is required.
 */
const getProductEvent = async (id: string, sellerPubkey?: string): Promise<NDKEvent | null> => {
	try {
		// If it looks like an event ID (64 hex chars), query by event ID
		if (isEventId(id)) {
			const event = (await cartQueryClient.fetchQuery(productQueryOptions(id))) as NDKEvent | null
			return event
		}

		// Otherwise, it's likely a d-tag - we need the seller pubkey to query by a-tag
		if (sellerPubkey) {
			const event = (await cartQueryClient.fetchQuery(productByATagQueryOptions(sellerPubkey, id))) as NDKEvent | null
			return event
		}

		// No seller pubkey provided for a d-tag - can't fetch
		console.warn(`Cannot fetch product by d-tag "${id}" without seller pubkey`)
		return null
	} catch (error) {
		console.error(`Failed to fetch product event ${id} via queryClient:`, error)
		return null
	}
}

const getShippingEvent = async (shippingReferenceId: string): Promise<NDKEvent | null> => {
	try {
		if (shippingReferenceId.startsWith(`${SHIPPING_KIND}:`)) {
			const parts = shippingReferenceId.split(':')
			if (parts.length === 3) {
				const pubkey = parts[1]
				const dTag = parts[2]

				const event = (await cartQueryClient.fetchQuery(shippingOptionByCoordinatesQueryOptions(pubkey, dTag))) as NDKEvent | null
				return event
			} else {
				console.warn(`Invalid shipping reference format: ${shippingReferenceId}`)
				return null
			}
		}
		return null
	} catch (error) {
		console.error(`Failed to fetch shipping event ${shippingReferenceId} via queryClient:`, error)
		return null
	}
}

export const cartActions = {
	saveToStorage: async (cart: NormalizedCart) => {
		if (typeof sessionStorage !== 'undefined') {
			const serializableCart = JSON.parse(
				JSON.stringify({
					sellers: cart.sellers,
					products: cart.products,
					orders: cart.orders,
					invoices: cart.invoices,
				}),
			)

			sessionStorage.setItem('cart', JSON.stringify(serializableCart))
		}
	},

	saveV4VSharesToStorage: (shares: Record<string, V4VDTO[]>) => {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem('v4vShares', JSON.stringify(shares))
		}
	},

	convertNDKEventToCartProduct: (event: NDKEvent, amount: number = 1): CartProduct => {
		// Use the product's d-tag as the ID, not the event.id
		// This ensures correct product references in orders (30402:pubkey:dTag format)
		const productDTag = getProductId(event)
		if (!productDTag) {
			console.warn('Product event has no d-tag, falling back to event.id:', event.id)
		}
		return {
			id: productDTag || event.id, // Prefer d-tag, fallback to event.id for compatibility
			amount: amount,
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: null,
			sellerPubkey: event.pubkey,
		}
	},

	findOrCreateSeller: (cart: NormalizedCart, sellerPubkey: string) => {
		// Ensure seller exists
		const seller = cart.sellers[sellerPubkey] || {
			pubkey: sellerPubkey,
			productIds: [],
			currency: '',
			shippingMethodId: null,
			shippingMethodName: null,
			shippingCost: 0,
			shippingCostCurrency: null,
			v4vShares: [],
		}
		if (!cart.sellers[sellerPubkey]) {
			cart.sellers[sellerPubkey] = seller
		}

		return seller
	},

	addProduct: async (buyerPubkey: string, productData: CartProduct | NDKEvent | string) => {
		let productId: string
		let sellerPubkey: string
		let amount = 1

		if (typeof productData === 'string') {
			productId = productData
			try {
				const pubkey = await getProductSellerPubkey(productId)
				sellerPubkey = pubkey || ''
			} catch (error) {
				console.error('Failed to fetch seller pubkey:', error)
				return
			}
		} else if (productData instanceof NDKEvent) {
			// Use the product's d-tag as the ID, not the event.id
			// This ensures correct product references in orders (30402:pubkey:dTag format)
			const productDTag = getProductId(productData)
			if (!productDTag) {
				console.warn('Product event has no d-tag, falling back to event.id:', productData.id)
			}
			productId = productDTag || productData.id // Prefer d-tag, fallback to event.id
			sellerPubkey = productData.pubkey
		} else {
			productId = productData.id
			sellerPubkey = productData.sellerPubkey
			amount = productData.amount
		}

		if (!sellerPubkey || !HEX_KEYS_REGEX.test(sellerPubkey)) {
			console.error('Cannot add product without valid seller pubkey:', sellerPubkey)
			return
		}

		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const seller = cartActions.findOrCreateSeller(cart, sellerPubkey)

			if (cart.products[productId]) {
				cart.products[productId].amount += amount
			} else {
				cart.products[productId] = {
					id: productId,
					amount: amount,
					shippingMethodId: null,
					shippingMethodName: null,
					shippingCost: 0,
					shippingCostCurrency: null,
					sellerPubkey,
				}
				seller.productIds.push(productId)
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateV4VShares()
		await cartActions.groupProductsBySeller()
		await cartActions.updateSellerData()
	},

	updateProductAmount: async (buyerPubkey: string, productId: string, amount: number) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const product = cart.products[productId]
			if (product) {
				product.amount = amount
			}
			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateSellerData()
	},

	removeProduct: async (buyerPubkey: string, productId: string) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const product = cart.products[productId]

			if (product && product.sellerPubkey) {
				const seller = cart.sellers[product.sellerPubkey]
				if (seller) {
					seller.productIds = seller.productIds.filter((id) => id !== productId)

					// Clean up empty seller
					if (seller.productIds.length === 0) {
						delete cart.sellers[product.sellerPubkey]
					}
				}
			}

			delete cart.products[productId]

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateV4VShares()
		await cartActions.groupProductsBySeller()
		await cartActions.updateSellerData()
	},

	setShippingMethod: async (productId: string, shipping: Partial<RichShippingInfo>) => {
		const prevState = cartStore.state
		const prevProduct = prevState.cart.products[productId]

		// Only update shipping for products that are already in the cart
		// This prevents creating corrupted entries when ShippingSelector is used on product detail page
		if (!prevProduct) {
			return
		}

		// Validate shipping ID
		let validatedShippingId = shipping.id || null
		if (shipping.id && typeof shipping.id === 'string' && shipping.id.trim().length > 0) {
			const trimmedId = shipping.id.trim()
			if (!trimmedId.endsWith(':') && trimmedId.split(':').length === 3) {
				validatedShippingId = trimmedId
			} else {
				console.warn('Invalid shipping ID format:', shipping.id)
				validatedShippingId = null
			}
		} else {
			validatedShippingId = null
		}

		cartStore.setState((state) => {
			const newCart = {
				...state.cart,
				products: {
					...state.cart.products,
					[productId]: {
						...state.cart.products[productId],
						shippingMethodId: validatedShippingId,
						shippingCost: Number(shipping.cost || 0),
						shippingMethodName: shipping.name ?? null,
						shippingCostCurrency: shipping.currency || null,
					},
				},
			}
			cartActions.saveToStorage(newCart)
			return {
				...state,
				cart: newCart,
			}
		})

		// Immediately update seller data to recalculate shipping costs
		await cartActions.updateSellerData()
	},

	getShippingMethod: (productId: string): string | null => {
		const state = cartStore.state
		return state.cart.products[productId]?.shippingMethodId || null
	},

	clear: () => {
		// Clear sessionStorage first to prevent reloading
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem('cart')
			sessionStorage.removeItem('v4vShares')
		}

		// Reset cart store to initial state
		cartStore.setState(() => ({
			...initialState,
			cart: { sellers: {}, products: {}, orders: {}, invoices: {} },
			v4vShares: {},
		}))
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

	handleProductUpdate: async (action: string, productId: string, amount?: number) => {
		cartStore.setState((state) => {
			const cart = { ...state.cart }
			const product = cart.products[productId]

			switch (action) {
				case 'increment':
					if (product) {
						product.amount += 1
					}
					break
				case 'decrement':
					if (product) {
						const newAmount = Math.max(product.amount - 1, 0)

						if (newAmount === 0) {
							// Remove product from seller's product list
							const seller = cart.sellers[product.sellerPubkey]
							if (seller) {
								seller.productIds = seller.productIds.filter((id: string) => id !== productId)
								if (seller.productIds.length === 0) {
									delete cart.sellers[product.sellerPubkey]
								}
							}
							delete cart.products[productId]
						} else {
							product.amount = newAmount
						}
					}
					break
				case 'setAmount':
					if (amount !== undefined && product) {
						if (amount <= 0) {
							// Remove product from seller's product list
							const seller = cart.sellers[product.sellerPubkey]
							if (seller) {
								seller.productIds = seller.productIds.filter((id: string) => id !== productId)
								if (seller.productIds.length === 0) {
									delete cart.sellers[product.sellerPubkey]
								}
							}
							delete cart.products[productId]
						} else {
							product.amount = amount
						}
					}
					break
				case 'remove': {
					if (product) {
						// Remove product from seller's product list
						const seller = cart.sellers[product.sellerPubkey]
						if (seller) {
							seller.productIds = seller.productIds.filter((id: string) => id !== productId)
							if (seller.productIds.length === 0) {
								delete cart.sellers[product.sellerPubkey]
							}
						}
						delete cart.products[productId]
					}
					break
				}
			}

			cartActions.saveToStorage(cart)
			return { ...state, cart }
		})

		await cartActions.updateV4VShares()
		await cartActions.groupProductsBySeller()
		await cartActions.updateSellerData()
	},

	convertToSats: async (currency: string, amount: number): Promise<number> => {
		if (!currency || !amount || amount <= 0.0001) return 0

		if (['sats', 'sat'].includes(currency.toLowerCase())) {
			return Math.round(amount)
		}

		if (currency.toUpperCase() === 'BTC') {
			return Math.round(amount * numSatsInBtc)
		}

		try {
			if (CURRENCIES.includes(currency as any)) {
				const queryOptions = currencyConversionQueryOptions(currency, amount)
				const result = await cartQueryClient.fetchQuery(queryOptions)

				return Math.round(result || 0)
			} else {
				console.warn(`Unsupported currency: ${currency}`)
				return 0
			}
		} catch (error) {
			console.error(`Currency conversion failed for ${currency}:`, error)
			return 0
		}
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
			const event = await getProductEvent(productId, product.sellerPubkey)
			if (!event) {
				throw new Error(`Product not found: ${productId}`)
			}

			const priceTag = getProductPrice(event)
			const price = priceTag ? parseFloat(priceTag[1]) : 0
			const productCurrency = priceTag ? priceTag[2] : 'USD'

			const productTotalInCurrency = price * product.amount

			let shippingCostInFiat = product.shippingCost || 0
			const actualShippingCostCurrency = product.shippingCostCurrency || productCurrency

			if (product.shippingMethodId && product.shippingCost <= 0) {
				const shippingEvent = await getShippingEvent(product.shippingMethodId)
				if (shippingEvent) {
					const shippingPriceTag = getShippingPrice(shippingEvent)
					if (shippingPriceTag) {
						shippingCostInFiat = parseFloat(shippingPriceTag[1])
						const shippingCurrency = shippingPriceTag[2]
						cartStore.setState((state) => {
							const cart = { ...state.cart }
							if (cart.products[productId]) {
								cart.products[productId].shippingCost = shippingCostInFiat
								cart.products[productId].shippingCostCurrency = shippingCurrency
							}
							cartActions.saveToStorage(cart)
							return { ...state, cart }
						})
					}
				}
			}

			const subtotalInSats = await cartActions.convertToSats(productCurrency, productTotalInCurrency)
			const shippingInSats = await cartActions.convertToSats(actualShippingCostCurrency, shippingCostInFiat)

			return {
				subtotalInSats: Math.round(subtotalInSats),
				shippingInSats: Math.round(shippingInSats),
				totalInSats: Math.round(subtotalInSats + shippingInSats),
				subtotalInCurrency: productTotalInCurrency,
				shippingInCurrency: shippingCostInFiat,
				totalInCurrency: productTotalInCurrency + shippingCostInFiat,
				currency: productCurrency,
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

	calculateBuyerTotal: async (): Promise<CartTotals | null> => {
		const state = cartStore.state
		const products = Object.values(state.cart.products)
		if (products.length === 0) return null

		let subtotalInSats = 0
		let shippingInSats = 0
		let totalInSats = 0
		const currencyTotals: Record<string, { subtotal: number; shipping: number; total: number }> = {}

		const productTotals = await Promise.all(products.map((product) => cartActions.calculateProductTotal(product.id)))

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
		if (Object.keys(state.cart.products).length === 0) {
			return {
				grandSubtotalInSats: 0,
				grandShippingInSats: 0,
				grandTotalInSats: 0,
				currencyTotals: {},
			}
		}

		// Just use the buyer total since there's only one buyer (the logged-in user)
		const buyerTotal = await cartActions.calculateBuyerTotal()

		if (!buyerTotal) {
			return {
				grandSubtotalInSats: 0,
				grandShippingInSats: 0,
				grandTotalInSats: 0,
				currencyTotals: {},
			}
		}

		return {
			grandSubtotalInSats: buyerTotal.subtotalInSats,
			grandShippingInSats: buyerTotal.shippingInSats,
			grandTotalInSats: buyerTotal.totalInSats,
			currencyTotals: buyerTotal.currencyTotals,
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
		// Start with existing shares to avoid losing data
		const shares: Record<string, V4VDTO[]> = { ...state.v4vShares }

		try {
			const uniqueSellerPubkeys = new Set<string>()

			Object.values(state.cart.products).forEach((product) => {
				if (product.sellerPubkey) {
					uniqueSellerPubkeys.add(product.sellerPubkey)
				}
			})

			// Only fetch seller shares if we don't already have them
			// NOTE: We check if the key exists, NOT if it's empty
			// An empty array means "we fetched and found nothing" - that's valid cached data!
			for (const sellerPubkey of Array.from(uniqueSellerPubkeys)) {
				if (!shares[sellerPubkey]) {
					try {
						const sellerShares = await v4VForUserQuery(sellerPubkey)
						shares[sellerPubkey] = (sellerShares || []).map((share) => ({
							...share,
							percentage: isNaN(share.percentage) ? 5 : share.percentage,
						}))
					} catch (error) {
						console.error(`Failed to fetch v4v shares for seller ${sellerPubkey}:`, error)
						// Store empty array to prevent re-fetching
						shares[sellerPubkey] = []
					}
				}
			}

			// Fetch buyer shares from auth system (buyer is the logged-in user)
			const buyerPubkey = cartActions.getBuyerPubkey()
			if (buyerPubkey) {
				const buyerPubkeyStr: string = buyerPubkey
				if (!shares[buyerPubkeyStr]) {
					try {
						const buyerShares = await v4VForUserQuery(buyerPubkeyStr)
						shares[buyerPubkeyStr] = (buyerShares || []).map((share) => ({
							...share,
							percentage: isNaN(share.percentage) ? 5 : share.percentage,
						}))
					} catch (error) {
						console.error(`Failed to fetch v4v shares for buyer ${buyerPubkeyStr}:`, error)
						// Store empty array to prevent re-fetching
						shares[buyerPubkeyStr] = []
					}
				}
			}

			// Don't delete empty arrays - they represent "we checked and found nothing"
			// which is different from "we haven't checked yet" (key doesn't exist)

			// Save to both state and persistent storage
			cartStore.setState((state) => ({
				...state,
				v4vShares: shares,
			}))

			cartActions.saveV4VSharesToStorage(shares)

			// Don't call updateSellerData from here to avoid race conditions
			// Let the caller handle it explicitly
		} catch (error) {
			console.error('Error updating V4V shares:', error)
		}
	},

	updateCartTotals: async () => {
		const state = cartStore.state
		const sellerData = state.sellerData

		let subtotalInSats = 0
		let totalShippingInSats = 0
		const subtotalByCurrency: Record<string, number> = {}
		const shippingByCurrency: Record<string, number> = {}
		const totalByCurrency: Record<string, number> = {}

		try {
			for (const [sellerPubkey, data] of Object.entries(sellerData)) {
				if (data.shippingSats > 0) {
					totalShippingInSats += Math.round(data.shippingSats)
				}
			}

			for (const productId of Object.values(state.cart.products).map((p) => p.id)) {
				try {
					const productTotal = await cartActions.calculateProductTotal(productId)

					subtotalInSats += productTotal.subtotalInSats

					const currency = productTotal.currency
					if (currency) {
						subtotalByCurrency[currency] = (subtotalByCurrency[currency] || 0) + productTotal.subtotalInCurrency
						if (productTotal.shippingInCurrency > 0) {
							shippingByCurrency[currency] = (shippingByCurrency[currency] || 0) + productTotal.shippingInCurrency
						}
					}
				} catch (error) {
					console.error(`Error calculating totals for product ${productId}:`, error)
				}
			}

			const totalInSats = subtotalInSats + totalShippingInSats

			for (const currency of Object.keys(subtotalByCurrency)) {
				const subtotal = subtotalByCurrency[currency] || 0
				const shipping = shippingByCurrency[currency] || 0
				totalByCurrency[currency] = subtotal + shipping
			}

			cartStore.setState((state) => ({
				...state,
				totalInSats,
				totalShippingInSats,
				subtotalByCurrency,
				shippingByCurrency,
				totalByCurrency,
			}))
		} catch (error) {
			console.error('Error updating cart totals:', error)
		}
	},

	calculateTotalItems: () => {
		const state = cartStore.state
		return Object.values(state.cart.products).reduce((total, product) => {
			// Only count products with valid pubkeys
			if (!HEX_KEYS_REGEX.test(product.sellerPubkey ?? '')) return total
			return total + product.amount
		}, 0)
	},

	calculateAmountsByCurrency: async () => {
		const state = cartStore.state
		const result: Record<string, number> = {}

		for (const product of Object.values(state.cart.products)) {
			try {
				const event = await getProductEvent(product.id, product.sellerPubkey)
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

	getBuyerPubkey: () => {
		// TODO: This should get the pubkey from the auth system
		// For now, return null as a placeholder
		return null
	},

	calculateProductSubtotal: async (productId: string): Promise<{ value: number; currency: string }> => {
		const state = cartStore.state
		const product = state.cart.products[productId]
		if (!product) {
			return { value: 0, currency: 'USD' }
		}

		try {
			const event = await getProductEvent(productId, product.sellerPubkey)
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

	groupProductsBySeller: () => {
		const state = cartStore.state
		// Use the helper function that filters out products without valid sellerPubkey
		const grouped = computeProductsBySeller(state.cart.products)

		cartStore.setState((state) => ({
			...state,
			productsBySeller: grouped,
		}))

		return grouped
	},

	calculateShares: (
		sellerPubkey: string,
		totalSats: number,
	): { sellerAmount: number; communityAmount: number; sellerPercentage: number } => {
		const state = cartStore.state
		const shares = state.v4vShares[sellerPubkey] || []

		if (!shares || shares.length === 0) {
			return { sellerAmount: Math.round(totalSats), communityAmount: 0, sellerPercentage: 100 }
		}

		const communitySharePercentage = shares.reduce((total, share) => {
			let percentage = Number(share.percentage)

			// Handle case where percentage might be stored as decimal (0.18) instead of whole number (18)
			// If percentage is less than 1, assume it's in decimal format and convert to percentage
			if (percentage > 0 && percentage < 1) {
				percentage = percentage * 100
			}

			if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
				console.warn(`Invalid share percentage for ${share.name}: ${share.percentage}`)
				return total
			}
			return total + percentage
		}, 0)

		const normalizedCommunityPercentage = Math.min(communitySharePercentage, 100)
		const sellerPercentage = Math.max(0, 100 - normalizedCommunityPercentage)

		const sellerAmount = Math.floor((totalSats * sellerPercentage) / 100)
		const communityAmount = totalSats - sellerAmount

		return { sellerAmount, communityAmount, sellerPercentage }
	},

	convertWithExchangeRate: (amount: number, currency: string, exchangeRates: any): number => {
		if (!exchangeRates || !amount) return 0

		const upperCurrency = currency.toUpperCase()

		if (upperCurrency === 'SATS') return Math.round(amount)
		if (upperCurrency === 'BTC') return Math.round(amount * numSatsInBtc)

		const rate = exchangeRates[upperCurrency]
		if (!rate) {
			console.warn(`Exchange rate not found for ${upperCurrency}`)
			return 0
		}

		const sats = (amount / rate) * numSatsInBtc
		return Math.round(sats)
	},

	updateSellerData: async () => {
		const state = cartStore.state
		const { productsBySeller } = state
		const newSellerData: Record<string, any> = {}

		if (Object.keys(productsBySeller).length === 0) {
			cartActions.groupProductsBySeller()
		}

		let exchangeRates: Record<SupportedCurrency, number> | undefined
		try {
			exchangeRates = await cartQueryClient.fetchQuery(btcExchangeRatesQueryOptions)
		} catch (error) {
			console.warn('Failed to get exchange rates for seller data calculations:', error)
		}

		for (const [sellerPubkey, products] of Object.entries(state.productsBySeller)) {
			if (products.length > 0) {
				let sellerTotal = 0
				const currencyTotals: Record<string, number> = {}
				let shippingSats = 0

				for (const product of products) {
					try {
						const productTotal = await cartActions.calculateProductTotal(product.id)
						sellerTotal += productTotal.subtotalInSats

						if (productTotal.currency) {
							const currency = productTotal.currency
							currencyTotals[currency] = (currencyTotals[currency] || 0) + productTotal.subtotalInCurrency
						}

						if (product.shippingMethodId) {
							let fiatShippingCost = product.shippingCost
							let actualShippingCostCurrency = product.shippingCostCurrency

							// If shipping cost is 0 or missing, try to fetch it from the shipping event
							if (fiatShippingCost <= 0 && product.shippingMethodId) {
								try {
									const shippingEvent = await getShippingEvent(product.shippingMethodId)
									if (shippingEvent) {
										const shippingPriceTag = getShippingPrice(shippingEvent)
										if (shippingPriceTag) {
											fiatShippingCost = parseFloat(shippingPriceTag[1])
											actualShippingCostCurrency = shippingPriceTag[2]
										}
									}
								} catch (error) {
									console.error(`Failed to fetch shipping event for ${product.shippingMethodId}:`, error)
								}
							}

							// Only proceed if we have a valid shipping cost and currency
							if (fiatShippingCost > 0 && actualShippingCostCurrency) {
								try {
									let convertedShippingSats = 0
									const upperShippingCurrency = actualShippingCostCurrency.toUpperCase()

									// Handle sats currency directly
									if (['SATS', 'SAT'].includes(upperShippingCurrency)) {
										convertedShippingSats = Math.round(fiatShippingCost)
									} else if (CURRENCIES.includes(upperShippingCurrency as SupportedCurrency)) {
										if (exchangeRates) {
											if (exchangeRates[upperShippingCurrency as SupportedCurrency] !== undefined) {
												convertedShippingSats = cartActions.convertWithExchangeRate(
													fiatShippingCost,
													actualShippingCostCurrency,
													exchangeRates,
												)
											} else {
												convertedShippingSats = await cartActions.convertToSats(actualShippingCostCurrency, fiatShippingCost)
											}
										} else {
											convertedShippingSats = await cartActions.convertToSats(actualShippingCostCurrency, fiatShippingCost)
										}
									} else {
										console.warn(`Unsupported shipping currency: ${actualShippingCostCurrency}`)
									}

									shippingSats += convertedShippingSats
								} catch (error) {
									console.error(`Failed to convert shipping cost in updateSellerData for product ${product.id}: ${error}`)
								}
							}
						}
					} catch (error) {
						console.error(`Error processing product ${product.id} in updateSellerData:`, error)
					}
				}

				// V4V shares are calculated ONLY from product price, not including shipping
				const shares = cartActions.calculateShares(sellerPubkey, sellerTotal)

				// Add shipping cost entirely to seller's amount (shipping is not shared with V4V)
				const adjustedShares = {
					sellerAmount: shares.sellerAmount + shippingSats,
					communityAmount: shares.communityAmount, // V4V shares stay the same
					sellerPercentage: shares.sellerPercentage, // Keep original percentage for display
				}

				const totalWithShipping = sellerTotal + shippingSats

				newSellerData[sellerPubkey] = {
					satsTotal: totalWithShipping,
					currencyTotals,
					shares: adjustedShares,
					shippingSats,
				}
			}
		}

		cartStore.setState((state) => ({
			...state,
			sellerData: newSellerData,
		}))

		await cartActions.updateCartTotals()
	},

	fetchAvailableShippingOptions: async (productId: string): Promise<RichShippingInfo[]> => {
		try {
			// Get seller pubkey from cart product if available
			const state = cartStore.state
			const cartProduct = state.cart.products[productId]
			const productEvent = await getProductEvent(productId, cartProduct?.sellerPubkey)
			if (!productEvent) return []

			// Get shipping options attached to this specific product
			const shippingTags = productEvent.tags.filter((t) => t[0] === 'shipping_option')

			if (shippingTags.length === 0) {
				return []
			}

			const shippingOptions: RichShippingInfo[] = []

			for (const tag of shippingTags) {
				const shippingRef = tag[1] // Format: "30406:pubkey:d-tag"
				const extraCost = tag[2] ? parseFloat(tag[2]) : 0

				try {
					const shippingEvent = await getShippingEvent(shippingRef)
					if (!shippingEvent) continue

					const info = getShippingInfo(shippingEvent)
					if (!info || !info.id || info.id.trim().length === 0) continue

					const baseCost = parseFloat(info.price.amount)
					const totalCost = baseCost + extraCost

					shippingOptions.push({
						id: shippingRef,
						name: info.title,
						cost: totalCost,
						currency: info.price.currency,
						countries: info.countries,
						service: info.service,
						carrier: info.carrier,
					})
				} catch (error) {
					console.error(`Failed to fetch shipping option ${shippingRef}:`, error)
				}
			}

			const sortedOptions = shippingOptions.sort((a, b) => {
				const aIsStandard = a.name?.toLowerCase().includes('standard') || false
				const bIsStandard = b.name?.toLowerCase().includes('standard') || false
				if (aIsStandard && !bIsStandard) return -1
				if (!aIsStandard && bIsStandard) return 1
				return (a.cost || 0) - (b.cost || 0)
			})

			return sortedOptions
		} catch (error) {
			console.error(`Failed to fetch shipping options for product ${productId}:`, error)
			return []
		}
	},

	fetchAndSetSellerShippingOptions: async () => {
		const state = cartStore.state
		const { productsBySeller, cart } = state
		const newSellerShippingOptions: Record<string, RichShippingInfo[]> = {}

		if (Object.keys(productsBySeller).length === 0) {
			return
		}

		for (const [sellerPubkey, products] of Object.entries(productsBySeller)) {
			if (products.length > 0) {
				try {
					// Collect all shipping option references from products in cart
					const productShippingRefs = new Set<string>()
					const extraCosts: Record<string, number> = {}

					for (const product of products) {
						const productEvent = await getProductEvent(product.id, product.sellerPubkey)
						if (!productEvent) continue

						const shippingTags = productEvent.tags.filter((t) => t[0] === 'shipping_option')
						for (const tag of shippingTags) {
							const shippingRef = tag[1] // Format: "30406:pubkey:d-tag"
							const extraCost = tag[2] ? parseFloat(tag[2]) : 0

							productShippingRefs.add(shippingRef)

							// Store extra cost if specified (use the highest if multiple products have different extra costs)
							if (extraCost > 0) {
								extraCosts[shippingRef] = Math.max(extraCosts[shippingRef] || 0, extraCost)
							}
						}
					}

					// If no shipping options are attached to any products, show empty
					if (productShippingRefs.size === 0) {
						newSellerShippingOptions[sellerPubkey] = []
						continue
					}

					// Fetch only the shipping options that are referenced by the products
					const shippingOptions: RichShippingInfo[] = []

					for (const shippingRef of Array.from(productShippingRefs)) {
						try {
							// Parse the shipping reference
							const parts = shippingRef.split(':')
							if (parts.length !== 3) continue

							const [kind, pubkey, dTag] = parts

							// Fetch the shipping event
							const shippingEvent = await getShippingEvent(shippingRef)
							if (!shippingEvent) continue

							const info = getShippingInfo(shippingEvent)
							if (!info || !info.id || typeof info.id !== 'string' || info.id.trim().length === 0) continue

							const baseCost = parseFloat(info.price.amount)
							const extraCost = extraCosts[shippingRef] || 0
							const totalCost = baseCost + extraCost

							shippingOptions.push({
								id: shippingRef,
								name: info.title,
								cost: totalCost,
								currency: info.price.currency,
								countries: info.countries,
								service: info.service,
								carrier: info.carrier,
							})
						} catch (error) {
							console.error(`Failed to fetch shipping option ${shippingRef}:`, error)
						}
					}

					// Remove duplicates and sort
					const uniqueOptions: RichShippingInfo[] = []
					const addedKeys = new Set<string>()
					for (const option of shippingOptions) {
						const uniqueKey = `${option.id}`
						if (!addedKeys.has(uniqueKey)) {
							addedKeys.add(uniqueKey)
							uniqueOptions.push(option)
						}
					}

					const sortedOptions = uniqueOptions.sort((a, b) => {
						const aIsStandard = a.name?.toLowerCase().includes('standard') || false
						const bIsStandard = b.name?.toLowerCase().includes('standard') || false
						if (aIsStandard && !bIsStandard) return -1
						if (!aIsStandard && bIsStandard) return 1
						return (a.cost || 0) - (b.cost || 0)
					})

					newSellerShippingOptions[sellerPubkey] = sortedOptions
				} catch (error) {
					console.error(`Failed to fetch/process shipping options for seller ${sellerPubkey}:`, error)
					newSellerShippingOptions[sellerPubkey] = []
				}
			}
		}

		cartStore.setState((state) => ({
			...state,
			sellerShippingOptions: newSellerShippingOptions,
		}))
	},
}

export function useCart() {
	const storeState = useStore(cartStore)

	useEffect(() => {
		if (Object.keys(storeState.productsBySeller).length === 0 && Object.keys(storeState.cart.products).length > 0) {
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
		}
	}, [storeState.cart.products])

	// Ensure V4V shares are loaded when cart has products but shares are missing
	useEffect(() => {
		if (Object.keys(storeState.cart.products).length > 0) {
			const sellersInCart = new Set(Object.values(storeState.cart.products).map((p) => p.sellerPubkey))
			const sellersWithShares = new Set(Object.keys(storeState.v4vShares))

			// Check if any sellers are missing shares (not yet fetched)
			// NOTE: We only check if the seller is NOT in the shares object, not if they have an empty array
			// An empty array means we already fetched and the seller has no V4V shares configured
			const missingSellers = Array.from(sellersInCart).filter((seller) => seller && !sellersWithShares.has(seller))

			if (missingSellers.length > 0) {
				cartActions.updateV4VShares().then(() => {
					cartActions.updateSellerData()
				})
			}
		}
	}, [storeState.cart.products, storeState.v4vShares])

	return {
		...storeState,
		...cartActions,
	}
}

export function useCartTotals() {
	const state = useStore(cartStore)

	useEffect(() => {
		if (Object.keys(state.cart.products).length > 0 && (state.totalInSats === 0 || Object.keys(state.sellerData).length === 0)) {
			cartActions.groupProductsBySeller()
			cartActions.updateSellerData()
		}
	}, [state.cart.products])

	return {
		totalItems: Object.values(state.cart.products).reduce((sum, product) => sum + product.amount, 0),
		subtotalByCurrency: state.subtotalByCurrency,
		shippingByCurrency: state.shippingByCurrency,
		totalByCurrency: state.totalByCurrency,
		totalInSats: state.totalInSats,
	}
}

export async function handleAddToCart(userId: string, product: Partial<CartProduct> | NDKEvent | string | null) {
	if (!product) return false

	if (typeof product === 'string') {
		await cartActions.addProduct(userId, product)
		return true
	}

	if (product instanceof NDKEvent) {
		await cartActions.addProduct(userId, product)
		return true
	}

	if ('id' in product && product.id) {
		const cartProduct: CartProduct = {
			id: product.id,
			amount: product.amount || 1,
			shippingMethodId: product.shippingMethodId || null,
			shippingMethodName: product.shippingMethodName || null,
			shippingCost: product.shippingCost || 0,
			shippingCostCurrency: product.shippingCostCurrency || null,
			sellerPubkey: product.sellerPubkey || '',
		}

		await cartActions.addProduct(userId, cartProduct)
		return true
	}

	return false
}
