import { defaultRelaysUrls, ZAP_RELAYS } from '@/lib/constants'
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import type { NDKEvent, NDKFilter, NDKSigner, NDKSubscriptionOptions, NDKUser } from '@nostr-dev-kit/ndk'
import NDK, { NDKKind } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { configStore } from './config'
import { walletActions, walletStore, type Wallet } from './wallet'

export interface NDKState {
	ndk: NDK | null
	zapNdk: NDK | null
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

let configRelaySyncInitialized = false
let lastSyncedAppRelay: string | undefined

/**
 * Helper to connect an NDK instance with timeout
 * Returns true if at least one relay connected
 */
async function connectNdkWithTimeout(ndk: NDK, timeoutMs: number, label: string): Promise<boolean> {
	try {
		await Promise.race([
			ndk.connect(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} connection timeout`)), timeoutMs)),
		])
		return true
	} catch (error) {
		console.warn(`${label} connection issue:`, error)
		// Check if any relays connected despite the timeout
		try {
			const connected = ndk.pool?.connectedRelays() || []
			if (connected.length > 0) {
				console.log(`✅ ${label} partially connected to ${connected.length} relays`)
				return true
			}
		} catch {
			// Ignore pool access errors
		}
		return false
	}
}

/**
 * Determine which relays to use based on config and environment
 */
function getRelayUrls(overrideRelays?: string[]): string[] {
	const appRelay = configStore.state.config.appRelay
	// @ts-ignore - Bun.env is available in Bun runtime
	const localRelayOnly = typeof Bun !== 'undefined' && Bun.env?.LOCAL_RELAY_ONLY === 'true'

	if (appRelay) {
		return localRelayOnly ? [appRelay] : Array.from(new Set([appRelay, ...defaultRelaysUrls]))
	}
	return overrideRelays?.length ? overrideRelays : defaultRelaysUrls
}

export const ndkActions = {
	/**
	 * Ensure the instance relay (config.appRelay) is always present,
	 * even before a signer exists (read-only queries must still work).
	 */
	ensureAppRelayFromConfig: (): void => {
		const appRelay = configStore.state.config.appRelay
		if (!appRelay) return

		// Avoid repeated attempts when config updates but relay is unchanged
		if (lastSyncedAppRelay === appRelay) return

		// Add/connect to the relay if NDK is ready
		const added = ndkActions.addSingleRelay(appRelay)
		if (added) lastSyncedAppRelay = appRelay
	},

	/**
	 * Fetch events, but guarantee resolution even if some relays never EOSE.
	 * This prevents UI loading states from hanging indefinitely.
	 */
	fetchEventsWithTimeout: async (
		filters: NDKFilter | NDKFilter[],
		opts?: NDKSubscriptionOptions & { timeoutMs?: number },
	): Promise<Set<NDKEvent>> => {
		const ndk = ndkStore.state.ndk
		if (!ndk) throw new Error('NDK not initialized')

		const { timeoutMs = 8000, ...subOpts } = opts ?? {}

		return await new Promise<Set<NDKEvent>>((resolve) => {
			const events = new Map<string, NDKEvent>()
			let settled = false
			let timer: ReturnType<typeof setTimeout> | undefined

			const finalize = (subscription?: { stop: () => void }) => {
				if (settled) return
				settled = true
				if (timer) clearTimeout(timer)
				subscription?.stop()
				resolve(new Set(events.values()))
			}

			const subscription = ndk.subscribe(filters, {
				...subOpts,
				closeOnEose: true,
				onEvent: (event) => {
					const key = event.deduplicationKey()
					const existing = events.get(key)
					if (!existing) {
						events.set(key, event)
						return
					}
					const existingCreatedAt = existing.created_at || 0
					const nextCreatedAt = event.created_at || 0
					if (nextCreatedAt >= existingCreatedAt) {
						events.set(key, event)
					}
				},
				onEose: () => finalize(subscription),
				onClose: () => finalize(subscription),
			})

			timer = setTimeout(() => finalize(subscription), timeoutMs)
		})
	},

	/**
	 * Initialize NDK instances (does not connect yet)
	 */
	initialize: (relays?: string[]) => {
		const state = ndkStore.state
		if (state.ndk) return state.ndk

		if (!configRelaySyncInitialized) {
			configRelaySyncInitialized = true
			configStore.subscribe(({ currentVal }) => {
				const appRelay = currentVal.config.appRelay
				if (!appRelay) return
				if (lastSyncedAppRelay === appRelay) return
				const added = ndkActions.addSingleRelay(appRelay)
				if (added) lastSyncedAppRelay = appRelay
			})
		}

		const explicitRelays = getRelayUrls(relays)
		// @ts-ignore - Bun.env is available in Bun runtime
		const localRelayOnly = typeof Bun !== 'undefined' && Bun.env?.LOCAL_RELAY_ONLY === 'true'

		const ndk = new NDK({
			explicitRelayUrls: explicitRelays,
			enableOutboxModel: !localRelayOnly,
			aiGuardrails: {
				skip: new Set(['ndk-no-cache', 'fetch-events-usage']),
			},
		})

		const zapNdk = new NDK({
			explicitRelayUrls: ZAP_RELAYS,
		})

		ndkStore.setState((s) => ({
			...s,
			ndk,
			zapNdk,
			explicitRelayUrls: explicitRelays,
		}))

		// If config was already loaded before initialization, ensure appRelay is included.
		ndkActions.ensureAppRelayFromConfig()

		return ndk
	},

	/**
	 * Connect NDK to relays (non-blocking, runs in background)
	 */
	connect: async (timeoutMs = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.ndk || state.isConnected || state.isConnecting) return

		ndkStore.setState((s) => ({ ...s, isConnecting: true }))

		try {
			const connected = await connectNdkWithTimeout(state.ndk, timeoutMs, 'NDK')
			ndkStore.setState((s) => ({ ...s, isConnected: connected }))
			if (connected) console.log('✅ NDK connected to relays')

			// Also connect zap NDK in background
			void ndkActions.connectZapNdk(5000)
		} finally {
			ndkStore.setState((s) => ({ ...s, isConnecting: false }))
		}
	},

	/**
	 * Connect the dedicated zap monitoring NDK
	 */
	connectZapNdk: async (timeoutMs = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.zapNdk || state.isZapNdkConnected) return

		const connected = await connectNdkWithTimeout(state.zapNdk, timeoutMs, 'Zap NDK')
		ndkStore.setState((s) => ({ ...s, isZapNdkConnected: connected }))

		if (connected) {
			console.log('✅ Zap NDK connected to relays:', ZAP_RELAYS)
		} else {
			console.warn('⚠️ Zap NDK could not connect. Zap monitoring will be unavailable.')
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

			// Already present?
			if (state.explicitRelayUrls.includes(normalizedUrl)) return true

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
	 * @param onZapReceived Callback when zap is detected (receives eventId and optional receipt preimage)
	 * @param timeoutMs Optional timeout in milliseconds (default: 30 seconds)
	 * @param onTimeout Optional callback when timeout is reached without receiving a zap receipt
	 * @returns Cleanup function
	 */
	monitorZapPayment: (
		bolt11: string,
		onZapReceived: (receipt: { eventId: string; receiptPreimage?: string }) => void,
		timeoutMs: number = 30000,
		onTimeout?: () => void,
	): (() => void) => {
		console.log('👀 Starting zap payment monitoring for invoice:', bolt11.substring(0, 20) + '...')

		let hasReceivedZap = false
		const cleanupFunctions: Array<() => void> = []

		// Create zap subscription
		const stopSubscription = ndkActions.createZapReceiptSubscription((event: NDKEvent) => {
			const eventBolt11 = event.tagValue('bolt11')
			if (eventBolt11 === bolt11 && !hasReceivedZap) {
				hasReceivedZap = true

				// Try to extract preimage from zap receipt per NIP-57
				// The preimage tag is optional (MAY contain), so we need fallbacks
				const receiptPreimage = event.tagValue('preimage')

				// Log all available tags for debugging
				console.log('📋 Zap receipt tags:', {
					bolt11: eventBolt11?.substring(0, 30) + '...',
					receiptPreimage: receiptPreimage || 'not included',
					eventId: event.id,
					pubkey: event.pubkey.substring(0, 16) + '...',
					allTags: event.tags.map((t) => t[0]),
				})

				console.log('⚡ Zap receipt detected!', {
					preimageSource: receiptPreimage ? 'receipt' : 'event-id',
					receiptPreimage: receiptPreimage ? receiptPreimage.substring(0, 30) + '...' : 'not included',
					eventId: event.id,
				})
				onZapReceived({ eventId: event.id, receiptPreimage: receiptPreimage || undefined })

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
				if (onTimeout) {
					console.log('🔄 Triggering timeout callback...')
					onTimeout()
				} else {
					console.log('💡 Tip: The zap may have succeeded but the receipt may not have propagated to relays yet')
				}
				// Cleanup on timeout
				cleanupFunctions.forEach((fn) => fn())
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
