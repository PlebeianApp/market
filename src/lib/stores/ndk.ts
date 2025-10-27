import { defaultRelaysUrls, ZAP_RELAYS } from '@/lib/constants'
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import type { NDKSigner, NDKUser } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent, NDKKind } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { configStore } from './config'
import { walletActions, walletStore, type Wallet } from './wallet'

// Check for staging environment
const isStaging =
	(typeof process !== 'undefined' && process.env?.STAGING === 'true') ||
	(typeof import.meta !== 'undefined' && import.meta.env?.STAGING === 'true')

export interface NDKState {
	ndk: NDK | null
	zapNdk: NDK | null // Separate NDK instance for zap detection
	isConnecting: boolean
	isConnected: boolean
	isZapNdkConnected: boolean
	explicitRelayUrls: string[]
	activeNwcWalletUri: string | null
	signer?: NDKSigner
}

const initialState: NDKState = {
	ndk: null,
	zapNdk: null,
	isConnecting: false,
	isConnected: false,
	isZapNdkConnected: false,
	explicitRelayUrls: [],
	activeNwcWalletUri: null,
	signer: undefined,
}

export const ndkStore = new Store<NDKState>(initialState)

export const ndkActions = {
	initialize: (relays?: string[]) => {
		const state = ndkStore.state
		if (state.ndk) return state.ndk

		const appRelay = configStore.state.config.appRelay
		
		
		// In staging mode, ONLY use the staging relay from constants
		// In production with appRelay configured, use only the appRelay
		// Otherwise, use the provided relays or default relays
		let explicitRelays: string[]
		
		if (isStaging) {
			// Staging mode: ONLY use staging relay from constants, ignore appRelay
			explicitRelays = ['wss://relay.staging.plebeian.market']
		} else if (appRelay) {
			// Production with appRelay configured: use only appRelay
			explicitRelays = [appRelay]
		} else {
			// Production without appRelay: use provided relays or defaults
			explicitRelays = relays && relays.length > 0 ? relays : defaultRelaysUrls
		}


		const ndk = new NDK({
			explicitRelayUrls: explicitRelays,
		})

		// For ZAP relays, also respect staging mode
		const zapRelays = isStaging ? ['wss://relay.staging.plebeian.market'] : ZAP_RELAYS
		
		const zapNdk = new NDK({
			explicitRelayUrls: zapRelays,
		})

		ndkStore.setState((state) => ({
			...state,
			ndk,
			zapNdk,
			explicitRelayUrls: explicitRelays,
		}))

		if (ndk.signer) {
			ndkActions.selectAndSetInitialNwcWallet()
		}

		return ndk
	},

	connect: async (timeoutMs: number = 10000): Promise<void> => {
		const state = ndkStore.state
		
		if (!state.ndk || state.isConnected || state.isConnecting) {
			return
		}

		ndkStore.setState((state) => ({ ...state, isConnecting: true }))

		try {
			// Add timeout to prevent hanging on unresponsive relays
			const connectPromise = state.ndk.connect()
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
			})

			await Promise.race([connectPromise, timeoutPromise])
			ndkStore.setState((state) => ({ ...state, isConnected: true }))

			// Set up auth handlers for connected relays if we have a signer
			if (state.signer) {
				ndkActions.setupRelayAuth(state.ndk, state.signer)
			}

			// Also connect zap NDK (with timeout)
			await ndkActions.connectZapNdk(5000)
			
		} catch (error) {
			// Don't throw - allow app to continue even if some relays fail
			// Mark as connected if we have any working relays
			const connectedRelays = state.ndk?.pool?.connectedRelays() || []
			
			if (connectedRelays.length > 0) {
				ndkStore.setState((state) => ({ ...state, isConnected: true }))
				
				// Set up auth handlers for connected relays if we have a signer
				if (state.signer) {
					ndkActions.setupRelayAuth(state.ndk!, state.signer)
				}
			}
		} finally {
			ndkStore.setState((state) => ({ ...state, isConnecting: false }))
		}
	},

	connectZapNdk: async (timeoutMs: number = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.zapNdk || state.isZapNdkConnected) return

		try {
			// Add timeout to prevent hanging on unresponsive zap relays
			const connectPromise = state.zapNdk.connect()
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error('Zap connection timeout')), timeoutMs)
			})

			await Promise.race([connectPromise, timeoutPromise])
			ndkStore.setState((state) => ({ ...state, isZapNdkConnected: true }))
			console.log('✅ Zap NDK connected to relays:', ZAP_RELAYS)
		} catch (error) {
			console.error('Failed to connect Zap NDK:', error)
			// Don't throw - allow app to continue even if zap relays fail
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
			// Also set signer for zap NDK
			if (newState.zapNdk) {
				newState.zapNdk.signer = signer
			}
		} else {
			state.ndk.signer = signer
			// Also set signer for zap NDK
			if (state.zapNdk) {
				state.zapNdk.signer = signer
			}
		}

		ndkStore.setState((s) => ({ ...s, signer }))

		if (signer) {
			// Set up NIP-42 authentication for relays that require it
			ndkActions.setupRelayAuth(ndkStore.state.ndk!, signer)
			await ndkActions.selectAndSetInitialNwcWallet()
		} else {
			ndkActions.setActiveNwcWalletUri(null)
		}
	},

	removeSigner: () => {
		ndkActions.setSigner(undefined)
	},

	setupRelayAuth: (ndk: NDK, signer: NDKSigner) => {
		console.log('🔐 Setting up relay authentication handlers')
		
		// NDK should handle NIP-42 authentication automatically when a signer is present
		// The signer is already set on the NDK instance, so auth challenges should be handled automatically
		
		// Listen for auth events on the pool level
		ndk.pool?.on('relay:auth', async (relay: any, challenge: string) => {
			console.log('🔐 Received AUTH challenge from relay:', relay.url, 'challenge:', challenge)
			
			try {
				// Create auth event according to NIP-42
				const authEvent = new NDKEvent(ndk)
				authEvent.kind = 22242
				authEvent.content = ''
				authEvent.tags = [
					['relay', relay.url],
					['challenge', challenge]
				]
				authEvent.created_at = Math.floor(Date.now() / 1000)
				
				// Sign the auth event
				await authEvent.sign(signer)
				console.log('🔐 Signed auth event for relay:', relay.url)
				
				// Try to authenticate using NDK's built-in method if available
				if (relay.auth && typeof relay.auth === 'function') {
					await relay.auth(authEvent.rawEvent())
					console.log('🔐 Authenticated with relay using built-in method:', relay.url)
				} else {
					console.log('🔐 Auth event created, NDK should handle sending automatically')
				}
				
			} catch (error) {
				console.error('❌ Failed to authenticate with relay:', relay.url, error)
			}
		})
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

	getZapNdk: () => {
		return ndkStore.state.zapNdk
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

	/**
	 * Creates a zap receipt subscription for monitoring zap payments
	 * @param onZapEvent Callback function to handle zap events
	 * @param bolt11 Optional specific invoice to monitor
	 * @returns Cleanup function to stop the subscription
	 */
	createZapReceiptSubscription: (onZapEvent: (event: NDKEvent) => void, bolt11?: string): (() => void) => {
		const state = ndkStore.state
		if (!state.zapNdk || !state.isZapNdkConnected) {
			console.warn('Zap NDK not connected. Cannot create zap subscription.')
			return () => {}
		}

		const filters: any = {
			kinds: [NDKKind.Zap],
			since: Math.floor(Date.now() / 1000) - 60, // Look back 1 minute for recent zaps
		}

		const subscription = state.zapNdk.subscribe(filters, { closeOnEose: false })

		subscription.on('event', (event: NDKEvent) => {
			// If we're monitoring a specific invoice, filter by bolt11
			if (bolt11) {
				const eventBolt11 = event.tagValue('bolt11')
				if (eventBolt11 === bolt11) {
					onZapEvent(event)
				}
			} else {
				// No specific invoice filter, pass all zaps
				onZapEvent(event)
			}
		})

		subscription.start()

		console.log('🔔 Started zap receipt subscription', bolt11 ? `for invoice: ${bolt11.substring(0, 20)}...` : '(all zaps)')

		return () => {
			subscription.stop()
			console.log('🔕 Stopped zap receipt subscription')
		}
	},

	/**
	 * Monitors a specific lightning invoice for zap receipts
	 * @param bolt11 Lightning invoice to monitor
	 * @param onZapReceived Callback when zap is detected
	 * @param timeoutMs Optional timeout in milliseconds (default: 30 seconds)
	 * @returns Cleanup function
	 */
	monitorZapPayment: (bolt11: string, onZapReceived: (preimage: string) => void, timeoutMs: number = 30000): (() => void) => {
		console.log('👀 Starting zap payment monitoring for invoice:', bolt11.substring(0, 20) + '...')

		let hasReceivedZap = false
		const cleanupFunctions: Array<() => void> = []

		// Create zap subscription
		const stopSubscription = ndkActions.createZapReceiptSubscription((event: NDKEvent) => {
			const eventBolt11 = event.tagValue('bolt11')
			if (eventBolt11 === bolt11 && !hasReceivedZap) {
				hasReceivedZap = true
				const preimage = event.tagValue('preimage') || event.tagValue('payment_hash') || 'zap-receipt-confirmed'
				console.log('⚡ Zap receipt detected! Preimage:', preimage.substring(0, 20) + '...')
				onZapReceived(preimage)

				// Cleanup after successful detection
				setTimeout(() => {
					cleanupFunctions.forEach((fn) => fn())
				}, 100)
			}
		}, bolt11)

		cleanupFunctions.push(stopSubscription)

		// Set timeout for monitoring
		const timeout = setTimeout(() => {
			if (!hasReceivedZap) {
				console.log('⏰ Zap monitoring timeout reached for invoice:', bolt11.substring(0, 20) + '...')
				console.log('💡 Tip: The zap may have succeeded but the receipt may not have propagated to relays yet')
			}
		}, timeoutMs)

		cleanupFunctions.push(() => clearTimeout(timeout))

		// Return cleanup function
		return () => {
			console.log('🧹 Cleaning up zap monitoring for invoice:', bolt11.substring(0, 20) + '...')
			cleanupFunctions.forEach((fn) => fn())
		}
	},
}

export const useNDK = () => {
	return {
		...ndkStore.state,
		...ndkActions,
	}
}
