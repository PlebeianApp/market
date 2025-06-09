import { defaultRelaysUrls } from '@/lib/constants'
import type { NDKSigner, NDKUser } from '@nostr-dev-kit/ndk'
import NDK from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { configStore } from './config'
import { walletActions, type Wallet } from './wallet'
import { fetchUserNwcWallets, fetchNwcWalletBalance } from '@/queries/wallet'
import { walletStore } from './wallet'

export interface NDKState {
	ndk: NDK | null
	isConnecting: boolean
	isConnected: boolean
	explicitRelayUrls: string[]
	activeNwcWalletUri: string | null
	signer?: NDKSigner
}

const initialState: NDKState = {
	ndk: null,
	isConnecting: false,
	isConnected: false,
	explicitRelayUrls: [],
	activeNwcWalletUri: null,
	signer: undefined,
}

export const ndkStore = new Store<NDKState>(initialState)

export const ndkActions = {
	initialize: (relays?: string[]) => {
		const state = ndkStore.state
		if (state.ndk) return state.ndk

		const LOCAL_ONLY = configStore.state.config.appRelay

		const appRelay = configStore.state.config.appRelay
		const explicitRelays = LOCAL_ONLY ? ([appRelay].filter(Boolean) as string[]) : relays && relays.length > 0 ? relays : defaultRelaysUrls

		const ndk = new NDK({
			explicitRelayUrls: explicitRelays,
		})

		ndkStore.setState((state) => ({
			...state,
			ndk,
			explicitRelayUrls: explicitRelays,
		}))

		if (ndk.signer) {
			ndkActions.selectAndSetInitialNwcWallet()
		}

		return ndk
	},

	connect: async (): Promise<void> => {
		const state = ndkStore.state
		if (!state.ndk || state.isConnected || state.isConnecting) return

		ndkStore.setState((state) => ({ ...state, isConnecting: true }))

		try {
			await state.ndk.connect()
			ndkStore.setState((state) => ({ ...state, isConnected: true }))
		} finally {
			ndkStore.setState((state) => ({ ...state, isConnecting: false }))
		}
	},

	addExplicitRelay: (relayUrls: string[]): string[] => {
		const state = ndkStore.state
		if (!state.ndk) return []

		relayUrls.forEach((relayUrl) => {
			state.ndk!.addExplicitRelay(relayUrl)
		})

		const updatedUrls = Array.from(new Set([...state.explicitRelayUrls, ...relayUrls]))
		ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
		return updatedUrls
	},

	addSingleRelay: (relayUrl: string): boolean => {
		const state = ndkStore.state
		if (!state.ndk) return false

		try {
			// Normalize the URL (add wss:// if missing)
			const normalizedUrl = relayUrl.startsWith('ws://') || relayUrl.startsWith('wss://') ? relayUrl : `wss://${relayUrl}`

			state.ndk.addExplicitRelay(normalizedUrl)

			const updatedUrls = Array.from(new Set([...state.explicitRelayUrls, normalizedUrl]))
			ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
			return true
		} catch (error) {
			console.error('Failed to add relay:', error)
			return false
		}
	},

	removeRelay: (relayUrl: string): boolean => {
		const state = ndkStore.state
		if (!state.ndk) return false

		try {
			// Remove from NDK pool
			const relay = state.ndk.pool.relays.get(relayUrl)
			if (relay) {
				state.ndk.pool.removeRelay(relayUrl)
			}

			// Update state
			const updatedUrls = state.explicitRelayUrls.filter((url) => url !== relayUrl)
			ndkStore.setState((state) => ({ ...state, explicitRelayUrls: updatedUrls }))
			return true
		} catch (error) {
			console.error('Failed to remove relay:', error)
			return false
		}
	},

	getRelays: () => {
		const state = ndkStore.state
		if (!state.ndk) return { explicit: [], outbox: [] }

		return {
			explicit: Array.from(state.ndk.pool.relays.values()),
			outbox: state.ndk.outboxPool ? Array.from(state.ndk.outboxPool.relays.values()) : [],
		}
	},

	connectToDefaultRelays: (): boolean => {
		try {
			ndkActions.addExplicitRelay(defaultRelaysUrls)
			return true
		} catch (error) {
			console.error('Failed to connect to default relays:', error)
			return false
		}
	},

	setSigner: async (signer: NDKSigner | undefined) => {
		const state = ndkStore.state
		if (!state.ndk) {
			console.warn('Attempted to set signer before NDK was initialized. Initializing NDK now.')
			ndkActions.initialize()
			if (!ndkStore.state.ndk) {
				console.error('NDK initialization failed. Cannot set signer.')
				return
			}
			const newState = ndkStore.state
			newState.ndk!.signer = signer
		} else {
			state.ndk.signer = signer
		}

		ndkStore.setState((s) => ({ ...s, signer }))

		if (signer) {
			await ndkActions.selectAndSetInitialNwcWallet()
		} else {
			ndkActions.setActiveNwcWalletUri(null)
		}
	},

	removeSigner: () => {
		ndkActions.setSigner(undefined)
	},

	setActiveNwcWalletUri: (uri: string | null) => {
		ndkStore.setState((state) => ({ ...state, activeNwcWalletUri: uri }))
	},

	selectAndSetInitialNwcWallet: async () => {
		const ndk = ndkStore.state.ndk
		if (!ndk || !ndk.signer) {
			console.warn('NDK or signer not available for NWC wallet selection.')
			return
		}

		let user: NDKUser | null = null
		try {
			user = await ndk.signer.user()
		} catch (e) {
			console.error('Error getting user from signer:', e)
			return
		}

		if (!user || !user.pubkey) {
			console.warn('User or user pubkey not available from signer.')
			return
		}

		const userPubkey = user.pubkey

		// Set loading state for wallet operations
		walletStore.setState((state) => ({ ...state, isLoading: true }))

		await walletActions.initialize()

		try {
			const nostrWallets = await fetchUserNwcWallets(userPubkey)
			if (nostrWallets && nostrWallets.length > 0) {
				walletActions.setNostrWallets(nostrWallets as Wallet[])
			}
		} catch (error) {
			console.error('Failed to fetch or merge Nostr NWC wallets during initial setup:', error)
		}

		const allWallets = walletActions.getWallets()

		if (allWallets.length === 0) {
			ndkActions.setActiveNwcWalletUri(null)
			// Clear loading state when done
			walletStore.setState((state) => ({ ...state, isLoading: false }))
			return
		}

		let highestBalance = -1
		let bestWallet: Wallet | null = null

		const balancePromises = allWallets
			.filter((wallet) => wallet.nwcUri)
			.map(async (wallet) => {
				try {
					const balanceInfo = await fetchNwcWalletBalance(wallet.nwcUri)
					const currentBalance = balanceInfo?.balance ?? -1
					return { ...wallet, balance: currentBalance }
				} catch (error) {
					console.error(`Failed to fetch balance for wallet ${wallet.name} (ID: ${wallet.id}):`, error)
					return { ...wallet, balance: -1 }
				}
			})

		const walletsWithBalances = await Promise.all(balancePromises)

		for (const wallet of walletsWithBalances) {
			if (wallet.balance > highestBalance) {
				highestBalance = wallet.balance
				bestWallet = wallet
			}
		}

		if (bestWallet && bestWallet.nwcUri) {
			ndkActions.setActiveNwcWalletUri(bestWallet.nwcUri)
		} else {
			ndkActions.setActiveNwcWalletUri(null)
		}

		// Clear loading state when done
		walletStore.setState((state) => ({ ...state, isLoading: false }))
	},

	getNDK: () => {
		return ndkStore.state.ndk
	},

	getUser: async (): Promise<NDKUser | null> => {
		const state = ndkStore.state
		if (!state.ndk || !state.ndk.signer) return null
		try {
			return await state.ndk.signer.user()
		} catch (e) {
			console.error('Error fetching user from signer in getUser:', e)
			return null
		}
	},

	getSigner: () => {
		return ndkStore.state.ndk?.signer
	},
}

export const useNDK = () => {
	return {
		...ndkStore.state,
		...ndkActions,
	}
}
