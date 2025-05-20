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
	// Initialize the wallet store
	initialize: async (): Promise<void> => {
		if (walletStore.state.isInitialized) return

		walletStore.setState((state) => ({ ...state, isLoading: true }))

		try {
			// Load wallets from local storage first
			const localWallets = await walletActions.loadWalletsFromLocalStorage()

			// Check if user is logged in to fetch encrypted wallets from Nostr
			const user = await ndkActions.getUser()
			if (user) {
				const nostrWallets = await walletActions.loadWalletsFromNostr()

				// Merge wallets, preferring Nostr wallets over local ones with the same ID
				const mergedWallets = [...localWallets]

				nostrWallets.forEach((nostrWallet) => {
					const existingIndex = mergedWallets.findIndex((w) => w.id === nostrWallet.id)
					if (existingIndex >= 0) {
						mergedWallets[existingIndex] = nostrWallet
					} else {
						mergedWallets.push(nostrWallet)
					}
				})

				walletStore.setState((state) => ({
					...state,
					wallets: mergedWallets,
					isInitialized: true,
					isLoading: false,
				}))
			} else {
				// Just use local wallets if not logged in
				walletStore.setState((state) => ({
					...state,
					wallets: localWallets,
					isInitialized: true,
					isLoading: false,
				}))
			}
		} catch (error) {
			console.error('Error initializing wallet store:', error)
			toast.error('Failed to load wallets')
			walletStore.setState((state) => ({ ...state, isLoading: false, isInitialized: true }))
		}
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

	// Load wallets from Nostr
	loadWalletsFromNostr: async (): Promise<Wallet[]> => {
		try {
			const ndk = ndkActions.getNDK()
			const user = await ndkActions.getUser()

			if (!ndk || !user) {
				console.warn('Cannot load wallets from Nostr: NDK or user not available')
				return []
			}

			// Fetch encrypted wallet list events
			const walletEvents = await ndk.fetchEvents({
				kinds: [WALLET_LIST_KIND],
				authors: [user.pubkey],
				'#l': [WALLET_LIST_LABEL],
			})

			if (walletEvents.size === 0) {
				return []
			}

			// Find the most recent wallet list event
			let mostRecentEvent: NDKEvent | undefined
			let mostRecentTimestamp = 0

			walletEvents.forEach((event) => {
				if (event.created_at && event.created_at > mostRecentTimestamp) {
					mostRecentEvent = event
					mostRecentTimestamp = event.created_at
				}
			})

			if (!mostRecentEvent) {
				return []
			}

			// Get the content
			try {
				// Most recent event should already have the content from the fetch
				const content = mostRecentEvent.content || '[]'
				const wallets = JSON.parse(content)

				// Validate and sanitize the data
				return wallets.map((wallet: any) => ({
					id: wallet.id || uuidv4(),
					name: wallet.name || `Wallet ${Math.floor(Math.random() * 1000)}`,
					nwcUri: wallet.nwcUri,
					pubkey: wallet.pubkey || '',
					relays: wallet.relays || [],
					storedOnNostr: true,
					createdAt: wallet.createdAt || Date.now(),
					updatedAt: wallet.updatedAt || Date.now(),
				}))
			} catch (e) {
				console.error('Failed to parse wallet list:', e)
				return []
			}
		} catch (error) {
			console.error('Failed to load wallets from Nostr:', error)
			return []
		}
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

	// Save wallets to Nostr (encrypted)
	saveWalletsToNostr: async (wallets: Wallet[]): Promise<boolean> => {
		try {
			const ndk = ndkActions.getNDK()
			const user = await ndkActions.getUser()

			if (!ndk || !user) {
				console.warn('Cannot save wallets to Nostr: NDK or user not available')
				return false
			}

			// Create a new event to store the wallet list
			const event = new NDKEvent(ndk)
			event.kind = WALLET_LIST_KIND
			event.created_at = Math.floor(Date.now() / 1000)

			// Add tags
			event.tags = [
				['l', WALLET_LIST_LABEL],
				['client', 'plebeian.market'],
			]

			// Only include necessary fields for each wallet
			const walletsToStore = wallets.map((wallet) => ({
				id: wallet.id,
				name: wallet.name,
				nwcUri: wallet.nwcUri,
				pubkey: wallet.pubkey,
				relays: wallet.relays,
				createdAt: wallet.createdAt,
				updatedAt: wallet.updatedAt,
			}))

			// Encrypt the wallet list for the user - NDKEvent content property
			event.content = JSON.stringify(walletsToStore)

			// Sign and publish the event
			await event.sign()
			await event.publish()

			return true
		} catch (error) {
			console.error('Failed to save wallets to Nostr:', error)
			toast.error('Failed to encrypt and save wallets to Nostr')
			return false
		}
	},

	// Add a new wallet
	addWallet: async (wallet: Omit<Wallet, 'id' | 'createdAt' | 'updatedAt'>, storeOnNostr: boolean): Promise<Wallet> => {
		const timestamp = Date.now()

		const newWallet: Wallet = {
			id: uuidv4(),
			...wallet,
			storedOnNostr: storeOnNostr,
			createdAt: timestamp,
			updatedAt: timestamp,
		}

		walletStore.setState((state) => {
			const updatedWallets = [...state.wallets, newWallet]

			// Save to localStorage
			walletActions.saveWalletsToLocalStorage(updatedWallets)

			// If requested, save to Nostr
			if (storeOnNostr) {
				walletActions.saveWalletsToNostr(updatedWallets).then((success) => {
					if (!success) {
						// Fallback if Nostr save fails
						newWallet.storedOnNostr = false
						toast.warning('Wallet saved locally only. Nostr storage failed.')
					}
				})
			}

			return { ...state, wallets: updatedWallets }
		})

		return newWallet
	},

	// Remove a wallet
	removeWallet: async (walletId: string): Promise<void> => {
		walletStore.setState((state) => {
			const updatedWallets = state.wallets.filter((wallet) => wallet.id !== walletId)

			// Save to localStorage
			walletActions.saveWalletsToLocalStorage(updatedWallets)

			// Check if any wallet was stored on Nostr and update there too
			const hadNostrWallets = state.wallets.some((wallet) => wallet.storedOnNostr)
			if (hadNostrWallets) {
				walletActions.saveWalletsToNostr(updatedWallets).catch((error) => {
					console.error('Failed to update wallet list on Nostr after deletion:', error)
					toast.warning('Wallet removed locally, but could not update Nostr storage')
				})
			}

			return { ...state, wallets: updatedWallets }
		})
	},

	// Update a wallet
	updateWallet: async (walletId: string, updates: Partial<Omit<Wallet, 'id' | 'createdAt'>>): Promise<void> => {
		walletStore.setState((state) => {
			const walletIndex = state.wallets.findIndex((wallet) => wallet.id === walletId)

			if (walletIndex === -1) {
				console.error(`Wallet with ID ${walletId} not found`)
				return state
			}

			const updatedWallets = [...state.wallets]
			updatedWallets[walletIndex] = {
				...updatedWallets[walletIndex],
				...updates,
				updatedAt: Date.now(),
			}

			// Save to localStorage
			walletActions.saveWalletsToLocalStorage(updatedWallets)

			// Update Nostr if the wallet or any in the collection is stored there
			const shouldUpdateNostr =
				updatedWallets[walletIndex].storedOnNostr || 'storedOnNostr' in updates || state.wallets.some((wallet) => wallet.storedOnNostr)

			if (shouldUpdateNostr) {
				walletActions.saveWalletsToNostr(updatedWallets).catch((error) => {
					console.error('Failed to update wallet on Nostr:', error)
					toast.warning('Wallet updated locally, but could not update Nostr storage')
				})
			}

			return { ...state, wallets: updatedWallets }
		})
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
