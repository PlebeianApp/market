import { Store } from '@tanstack/store'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { useEffect, useState } from 'react'
import NDK, { type NDKSigner } from '@nostr-dev-kit/ndk'
import { NDKNWCWallet } from '@nostr-dev-kit/wallet'

// Wallet interface
export interface Wallet {
	id: string
	name: string
	nwcUri: string
	pubkey: string
	relays: string[]
	storedOnNostr?: boolean
	createdAt: number
	updatedAt: number
}

// Wallet store state interface
export interface WalletState {
	wallets: Wallet[]
	isInitialized: boolean
	isLoading: boolean
	onWalletChange?: (wallets: Wallet[]) => void // Callback for when wallets change
}

// Initial state
const initialState: WalletState = {
	wallets: [],
	isInitialized: false,
	isLoading: false,
}

// Create the store
export const walletStore = new Store<WalletState>(initialState)

// Define a type for the NWC URI parser function
type NwcUriParser = (uri: string) => {
	pubkey: string
	relay: string
	secret: string
} | null

// Helper to parse an NWC URI
export const parseNwcUri: NwcUriParser = (uri: string) => {
	try {
		if (uri.startsWith('nostr+walletconnect://')) {
			// Split the URI to extract the pubkey and query parameters
			const [protocolPart, queryPart] = uri.split('?')
			// Extract pubkey - it's the part after nostr+walletconnect://
			const pubkey = protocolPart.replace('nostr+walletconnect://', '')

			// Parse query parameters
			const params = new URLSearchParams('?' + (queryPart || ''))
			const relay = params.get('relay') || ''
			const secret = params.get('secret') || ''
			// Ensure pubkey is not empty after parsing
			if (!pubkey) {
				console.warn('Parsed NWC URI resulted in empty pubkey')
				return null
			}
			return { pubkey, relay, secret }
		}
		return null
	} catch (e) {
		console.error('Failed to parse NWC URI:', e)
		return null
	}
}

export interface NwcClient {
	nwcUri: string
	relayUrl: string
	ndk: NDK
	wallet: NDKNWCWallet
}

const nwcClientCache = new Map<string, Promise<NwcClient>>()
let cachedSigner: NDKSigner | undefined

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
	const timeoutPromise = new Promise<never>((_, reject) => {
		setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
	})
	return Promise.race([promise, timeoutPromise])
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function extractPreimageCandidate(result: unknown): string | undefined {
	if (!isRecord(result)) return undefined

	const records = [result, result.result, result.response].filter(isRecord)
	for (const record of records) {
		for (const key of ['preimage', 'payment_preimage', 'paymentPreimage', 'preimage_hex', 'preimageHex']) {
			const value = record[key]
			if (typeof value === 'string' && value.length > 0) return value
		}
	}

	return undefined
}

const toFiniteNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value !== 'string' || value.trim() === '') return undefined

	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : undefined
}

function extractFeesPaidMsats(result: unknown): number | undefined {
	if (!isRecord(result)) return undefined

	const records = [result, result.result, result.response].filter(isRecord)
	for (const record of records) {
		for (const key of ['fees_paid', 'feesPaid', 'fees_paid_msat', 'feesPaidMsats']) {
			const value = toFiniteNumber(record[key])
			if (value !== undefined) return value
		}
	}

	return undefined
}

const collectErrorText = (error: unknown): string => {
	const parts: string[] = []
	const visit = (value: unknown) => {
		if (!value) return
		if (typeof value === 'string') {
			parts.push(value)
			return
		}
		if (value instanceof Error) {
			parts.push(value.name, value.message)
		}
		if (!isRecord(value)) return
		for (const key of ['code', 'message', 'name']) {
			const field = value[key]
			if (typeof field === 'string') parts.push(field)
		}
		visit(value.error)
		visit(value.result)
		visit(value.response)
	}

	visit(error)
	return parts.join(' ')
}

const sanitizeNwcPaymentErrorMessage = (error: unknown): string => {
	const message = collectErrorText(error)
	const lower = message.toLowerCase()
	const upper = message.toUpperCase()

	if (upper.includes('INSUFFICIENT_BALANCE') || lower.includes('insufficient balance')) {
		return 'Connected wallet has insufficient balance'
	}
	if (upper.includes('QUOTA_EXCEEDED') || lower.includes('quota exceeded') || lower.includes('spending limit')) {
		return 'Connected wallet spending limit was exceeded'
	}
	if (upper.includes('UNAUTHORIZED') || lower.includes('unauthorized')) {
		return 'Connected wallet is not authorized'
	}
	if (upper.includes('RESTRICTED') || lower.includes('restricted')) {
		return 'Connected wallet is not authorized to pay invoices'
	}
	if (lower.includes('timeout') || lower.includes('did not respond')) {
		return 'Connected wallet did not respond in time'
	}
	if (upper.includes('NOT_IMPLEMENTED') || lower.includes('unsupported') || lower.includes('not implemented')) {
		return 'Connected wallet does not support invoice payment'
	}
	if (upper.includes('PAYMENT_FAILED') || lower.includes('payment failed')) {
		return 'Connected wallet could not pay the invoice'
	}

	return 'Could not pay invoice with connected wallet'
}

const cleanupAllCachedNwcWalletListeners = async (): Promise<void> => {
	const entries = Array.from(nwcClientCache.values())
	nwcClientCache.clear()
	await Promise.allSettled(
		entries.map(async (clientPromise) => {
			try {
				const client = await clientPromise
				client.wallet.removeAllListeners?.()
			} catch {
				// ignore
			}
		}),
	)
}

// Actions for the wallet store
export const walletActions = {
	// Set callback for wallet changes
	setOnWalletChange: (callback: (wallets: Wallet[]) => void): void => {
		walletStore.setState((state) => ({ ...state, onWalletChange: callback }))
	},

	// Initialize the wallet store - only loads from local storage now
	initialize: async (): Promise<void> => {
		if (walletStore.state.isInitialized && walletStore.state.wallets.length > 0) return

		walletStore.setState((state) => ({ ...state, isLoading: true }))

		try {
			const localWallets = await walletActions.loadWalletsFromLocalStorage()
			walletStore.setState((state) => ({
				...state,
				wallets: localWallets,
				isInitialized: true,
				isLoading: false,
			}))
		} catch (error) {
			console.error('Error initializing wallet store from local storage:', error)
			toast.error('Failed to load wallets from local storage')
			walletStore.setState((state) => ({ ...state, isLoading: false, isInitialized: true })) // Still initialized, but empty/failed
		}
	},

	// New action to set/merge wallets, typically from a Nostr source
	setNostrWallets: (nostrWallets: Wallet[]): void => {
		walletStore.setState((state) => {
			const mergedWallets = [...state.wallets]

			nostrWallets.forEach((nostrWallet) => {
				// Ensure all Nostr wallets are marked as storedOnNostr: true
				const walletWithNostrFlag = { ...nostrWallet, storedOnNostr: true }
				const existingIndex = mergedWallets.findIndex((w) => w.id === walletWithNostrFlag.id)
				if (existingIndex >= 0) {
					if (walletWithNostrFlag.updatedAt >= mergedWallets[existingIndex].updatedAt || !mergedWallets[existingIndex].storedOnNostr) {
						mergedWallets[existingIndex] = walletWithNostrFlag
					}
				} else {
					mergedWallets.push(walletWithNostrFlag)
				}
			})
			const finalWallets = mergedWallets.map((mw) => {
				const presentInNostr = nostrWallets.some((nw) => nw.id === mw.id)
				if (presentInNostr && !mw.storedOnNostr) {
					return { ...mw, storedOnNostr: true, updatedAt: Math.max(mw.updatedAt, Date.now()) }
				}
				return mw
			})

			walletActions.saveWalletsToLocalStorage(finalWallets) // Persist merged list

			// Call the callback if it exists
			if (state.onWalletChange) {
				state.onWalletChange(finalWallets)
			}

			return { ...state, wallets: finalWallets }
		})
	},

	// Load wallets from localStorage
	loadWalletsFromLocalStorage: async (): Promise<Wallet[]> => {
		try {
			const savedWallets = localStorage.getItem('nwc_wallets')
			if (savedWallets) {
				const parsed = JSON.parse(savedWallets)
				// Ensure all fields are present
				return parsed.map((wallet: any) => ({
					id: wallet.id || uuidv4(),
					name: wallet.name || `Wallet ${Math.floor(Math.random() * 1000)}`,
					nwcUri: wallet.nwcUri,
					pubkey: wallet.pubkey || parseNwcUri(wallet.nwcUri)?.pubkey || 'unknown',
					relays: wallet.relays || [],
					storedOnNostr: wallet.storedOnNostr || false,
					createdAt: wallet.createdAt || Date.now(),
					updatedAt: wallet.updatedAt || Date.now(),
				}))
			}
		} catch (error) {
			console.error('Failed to load wallets from localStorage:', error)
		}
		return []
	},

	// Save wallets to local storage
	saveWalletsToLocalStorage: (wallets: Wallet[]): void => {
		try {
			localStorage.setItem('nwc_wallets', JSON.stringify(wallets))
		} catch (error) {
			console.error('Failed to save wallets to localStorage:', error)
			toast.error('Failed to save wallets to local storage')
		}
	},

	// Add a new wallet (does not save to Nostr directly anymore)
	addWallet: (walletData: Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'>, intendedStoreOnNostr: boolean): Wallet => {
		const timestamp = Date.now()

		const newWallet: Wallet = {
			id: uuidv4(),
			...walletData,
			storedOnNostr: intendedStoreOnNostr, // Reflects intent, actual save by mutation
			createdAt: timestamp,
			updatedAt: timestamp,
		}

		walletStore.setState((state) => {
			const updatedWallets = [...state.wallets, newWallet]
			walletActions.saveWalletsToLocalStorage(updatedWallets)

			// Call the callback if it exists
			if (state.onWalletChange) {
				state.onWalletChange(updatedWallets)
			}

			// UI component will handle calling the Nostr mutation if intendedStoreOnNostr is true
			return { ...state, wallets: updatedWallets }
		})
		return newWallet
	},

	// Remove a wallet (does not save to Nostr directly anymore)
	removeWallet: (walletId: string): void => {
		walletStore.setState((state) => {
			const updatedWallets = state.wallets.filter((wallet) => wallet.id !== walletId)
			walletActions.saveWalletsToLocalStorage(updatedWallets)

			// Call the callback if it exists
			if (state.onWalletChange) {
				state.onWalletChange(updatedWallets)
			}

			// UI component will handle calling the Nostr mutation
			return { ...state, wallets: updatedWallets }
		})
	},

	// Update a wallet (does not save to Nostr directly anymore)
	updateWallet: (walletId: string, updates: Partial<Omit<Wallet, 'id' | 'createdAt'>>): Wallet | undefined => {
		let updatedWallet: Wallet | undefined
		walletStore.setState((state) => {
			const walletIndex = state.wallets.findIndex((wallet) => wallet.id === walletId)

			if (walletIndex === -1) {
				console.error(`Wallet with ID ${walletId} not found for update`)
				return state
			}

			const newWallets = [...state.wallets]
			newWallets[walletIndex] = {
				...newWallets[walletIndex],
				...updates,
				updatedAt: Date.now(),
			}
			updatedWallet = newWallets[walletIndex]

			walletActions.saveWalletsToLocalStorage(newWallets)

			// Call the callback if it exists
			if (state.onWalletChange) {
				state.onWalletChange(newWallets)
			}

			// UI component will handle calling the Nostr mutation if needed
			return { ...state, wallets: newWallets }
		})
		return updatedWallet
	},

	// Get wallets
	getWallets: (): Wallet[] => {
		return walletStore.state.wallets
	},

	/**
	 * Returns a cached NWC client (NDK + NDKNWCWallet) for a given NWC URI and signer.
	 * Cache is cleared automatically when signer instance changes.
	 */
	getOrCreateNwcClient: async (nwcUri: string, signer: NDKSigner, timeoutMs: number = 10000): Promise<NwcClient | null> => {
		if (!nwcUri) return null
		if (!signer) return null

		if (cachedSigner !== signer) {
			await cleanupAllCachedNwcWalletListeners()
			cachedSigner = signer
		}

		const parsed = parseNwcUri(nwcUri)
		if (!parsed?.relay) return null

		const existing = nwcClientCache.get(nwcUri)
		if (existing) {
			try {
				const client = await existing
				if (client.relayUrl !== parsed.relay) {
					try {
						client.wallet.removeAllListeners?.()
					} catch {
						// ignore
					}
					nwcClientCache.delete(nwcUri)
				} else {
					const connectedRelays = client.ndk?.pool?.connectedRelays?.() || []
					if (connectedRelays.length === 0) {
						await withTimeout(client.ndk.connect(), timeoutMs, 'NWC relay connect')
					}
					return client
				}
			} catch {
				nwcClientCache.delete(nwcUri)
			}
		}

		const createPromise = (async (): Promise<NwcClient> => {
			const ndk = new NDK({ explicitRelayUrls: [parsed.relay] })
			ndk.signer = signer

			try {
				await withTimeout(ndk.connect(), timeoutMs, 'NWC relay connect')
			} catch (error) {
				throw error
			}

			const wallet = new NDKNWCWallet(ndk as any, { pairingCode: nwcUri })

			return {
				nwcUri,
				relayUrl: parsed.relay,
				ndk,
				wallet,
			}
		})()

		nwcClientCache.set(nwcUri, createPromise)

		try {
			return await createPromise
		} catch {
			nwcClientCache.delete(nwcUri)
			console.error('Failed to create NWC client')
			return null
		}
	},

	payInvoiceWithNwc: async (
		nwcUri: string,
		invoice: string,
		signer: NDKSigner,
		options?: { timeoutMs?: number },
	): Promise<{ preimage?: string; feesPaidMsats?: number }> => {
		if (!signer) {
			throw new Error('Connected wallet is not authorized')
		}
		if (!nwcUri || !invoice) {
			throw new Error('Could not pay invoice with connected wallet')
		}

		const timeoutMs = options?.timeoutMs ?? 10000
		const nwcClient = await walletActions.getOrCreateNwcClient(nwcUri, signer, timeoutMs)
		if (!nwcClient) {
			throw new Error('Could not pay invoice with connected wallet')
		}

		try {
			const result = await withTimeout(nwcClient.wallet.lnPay({ pr: invoice }), timeoutMs, 'NWC payment')
			const preimage = extractPreimageCandidate(result)
			const feesPaidMsats = extractFeesPaidMsats(result)

			return {
				...(preimage ? { preimage } : {}),
				...(feesPaidMsats !== undefined ? { feesPaidMsats } : {}),
			}
		} catch (error) {
			throw new Error(sanitizeNwcPaymentErrorMessage(error))
		}
	},
}

// React hook for consuming the store
export const useWallets = () => {
	const [state, setState] = useState(walletStore.state)

	useEffect(() => {
		const subscription = walletStore.subscribe(() => {
			setState(walletStore.state)
		})
		return subscription.unsubscribe
	}, [])

	return {
		wallets: state.wallets,
		isLoading: state.isLoading,
		isInitialized: state.isInitialized,
		...walletActions,
	}
}
