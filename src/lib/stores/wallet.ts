import { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { toast } from 'sonner'
import { v4 as uuidv4 } from 'uuid'
import { ndkActions } from './ndk'

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
interface WalletState {
	wallets: Wallet[]
	isInitialized: boolean
	isLoading: boolean
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

// Nostr tag constants for wallet events
const WALLET_LIST_KIND = NDKKind.AppSpecificData
const WALLET_LIST_LABEL = 'wallet_list'

// Actions for the wallet store
export const walletActions = {
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
					// Nostr wallet takes precedence if timestamps are newer or equal,
					// or if local one wasn't marked as stored on nostr
					if (walletWithNostrFlag.updatedAt >= mergedWallets[existingIndex].updatedAt || !mergedWallets[existingIndex].storedOnNostr) {
						mergedWallets[existingIndex] = walletWithNostrFlag
					}
				} else {
					mergedWallets.push(walletWithNostrFlag)
				}
			})
			// Also, update local wallets that might now be confirmed on Nostr
			// This ensures `storedOnNostr` is true if a local wallet matches one from Nostr.
			const finalWallets = mergedWallets.map((mw) => {
				const presentInNostr = nostrWallets.some((nw) => nw.id === mw.id)
				if (presentInNostr && !mw.storedOnNostr) {
					return { ...mw, storedOnNostr: true, updatedAt: Math.max(mw.updatedAt, Date.now()) }
				}
				return mw
			})

			walletActions.saveWalletsToLocalStorage(finalWallets) // Persist merged list
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
			// UI component will handle calling the Nostr mutation if needed
			return { ...state, wallets: newWallets }
		})
		return updatedWallet
	},

	// Get wallets
	getWallets: (): Wallet[] => {
		return walletStore.state.wallets
	},
}

// React hook for consuming the store
export const useWallets = () => {
	return {
		...walletStore.state,
		...walletActions,
	}
}
