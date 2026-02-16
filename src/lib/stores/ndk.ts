import { defaultRelaysUrls, ZAP_RELAYS, DEFAULT_PUBLIC_RELAYS, MAIN_RELAY_BY_STAGE, BUG_RELAY, type Stage } from '@/lib/constants'
import { fetchNwcWalletBalance, fetchUserNwcWallets } from '@/queries/wallet'
import { fetchUserRelayListWithPreferences } from '@/queries/relay-list'
import type { NDKFilter, NDKSigner, NDKSubscriptionOptions, NDKUser } from '@nostr-dev-kit/ndk'
import NDK, { NDKEvent, NDKKind, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { configStore } from './config'
import { nip60Actions } from './nip60'
import { walletActions, walletStore, type Wallet } from './wallet'

export interface NDKState {
	ndk: NDK | null
	zapNdk: NDK | null
	isConnecting: boolean
	isConnected: boolean
	isZapNdkConnected: boolean
	explicitRelayUrls: string[]
	writeRelayUrls: string[] // Relays we're allowed to write to (staging restriction)
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
	writeRelayUrls: [],
	activeNwcWalletUri: null,
	signer: undefined,
}

export const ndkStore = new Store<NDKState>(initialState)

let configRelaySyncInitialized = false
let lastSyncedAppRelay: string | undefined
let connectPromise: Promise<void> | null = null
let connectZapPromise: Promise<void> | null = null

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
 * Get the current stage from config.
 * Returns undefined if config hasn't been loaded yet.
 */
function getCurrentStage(): Stage | undefined {
	if (!configStore.state.isLoaded) return undefined
	return configStore.state.config.stage || 'development'
}

/**
 * Get the main relay for the current stage.
 * Returns undefined if config hasn't been loaded yet (prevents localhost relay in production).
 */
export function getMainRelay(): string | undefined {
	const appRelay = configStore.state.config.appRelay
	if (appRelay) return appRelay // Server-provided appRelay takes precedence
	const stage = getCurrentStage()
	if (!stage) return undefined // Config not loaded yet, don't assume a stage
	return MAIN_RELAY_BY_STAGE[stage]
}

/**
 * Get the write relay(s) for the current stage
 * Staging: staging relay + bug relay
 * Development: main relay only (prevents leaking test/dev data to public relays)
 * Production: all connected relays
 */
export function getWriteRelays(): string[] {
	const stage = getCurrentStage()
	if (stage === 'staging') {
		const mainRelay = getMainRelay()
		return mainRelay ? [mainRelay, BUG_RELAY] : [BUG_RELAY]
	}
	if (stage === 'development') {
		const mainRelay = getMainRelay()
		return mainRelay ? [mainRelay] : []
	}
	// Production: write to all connected relays
	return ndkStore.state.explicitRelayUrls
}

/**
 * Get an NDKRelaySet configured for write operations.
 * Staging: only staging relay + bug relay
 * Development: only the main relay (prevents leaking to public relays)
 * Production: undefined (NDK default = all connected relays)
 */
export function getWriteRelaySet(): NDKRelaySet | undefined {
	const ndk = ndkStore.state.ndk
	if (!ndk) return undefined

	const stage = getCurrentStage()
	if (stage === 'staging') {
		const writeRelays = getWriteRelays()
		console.log(`📝 Staging mode: restricting writes to ${writeRelays.join(', ')}`)
		return NDKRelaySet.fromRelayUrls(writeRelays, ndk)
	}
	if (stage === 'development') {
		const writeRelays = getWriteRelays()
		console.log(`📝 Development mode: restricting writes to ${writeRelays.join(', ')}`)
		return NDKRelaySet.fromRelayUrls(writeRelays, ndk)
	}

	// Production: return undefined to use default behavior (all relays)
	return undefined
}

/**
 * Determine which relays to use based on config and environment
 */
function getRelayUrls(overrideRelays?: string[]): string[] {
	const stage = getCurrentStage()
	// @ts-ignore - Bun.env is available in Bun runtime
	const localRelayOnly = typeof Bun !== 'undefined' && Bun.env?.LOCAL_RELAY_ONLY === 'true'

	// Get main relay (from config or stage default)
	// Will be undefined if config hasn't loaded yet, preventing localhost relay in production
	const mainRelay = getMainRelay()

	// Development mode: only use local/main relay to prevent polluting public relays
	// This applies to both server (Bun) and browser environments
	if (stage === 'development' && mainRelay) {
		return [mainRelay]
	}

	// Server-side with LOCAL_RELAY_ONLY flag: only local relay
	if (localRelayOnly && mainRelay) {
		return [mainRelay]
	}

	// Override relays take precedence if provided (include main relay if available)
	if (overrideRelays?.length) {
		const relays = mainRelay ? [mainRelay, ...overrideRelays] : overrideRelays
		return Array.from(new Set(relays))
	}

	// Standard case: main relay (if available) + public default relays
	const relays = mainRelay ? [mainRelay, ...DEFAULT_PUBLIC_RELAYS] : DEFAULT_PUBLIC_RELAYS
	return Array.from(new Set(relays))
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
		const stage = getCurrentStage()

		// Disable outbox model for staging, development, and local-only mode
		// This prevents NDK from discovering and connecting to additional relays
		const enableOutbox = stage !== 'staging' && stage !== 'development' && !localRelayOnly

		const ndk = new NDK({
			explicitRelayUrls: explicitRelays,
			enableOutboxModel: enableOutbox,
			aiGuardrails: {
				skip: new Set(['ndk-no-cache', 'fetch-events-usage']),
			},
		})

		// In development / local-relay-only mode, monitor zaps on the local relays instead of public ZAP_RELAYS.
		// This avoids connecting to public infrastructure while still enabling zap receipt monitoring.
		const zapNdk =
			stage === 'development' || localRelayOnly
				? new NDK({ explicitRelayUrls: explicitRelays })
				: new NDK({ explicitRelayUrls: ZAP_RELAYS })

		// Determine write relays - staging only writes to main relay, others write to all
		const mainRelay = getMainRelay()
		const writeRelays =
			stage === 'staging' && mainRelay
				? [mainRelay] // Staging: only main relay
				: explicitRelays // Others: all explicit relays

		ndkStore.setState((s) => ({
			...s,
			ndk,
			zapNdk,
			explicitRelayUrls: explicitRelays,
			writeRelayUrls: writeRelays,
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
		if (!state.ndk) return
		if (state.isConnected) return
		if (state.isConnecting) {
			if (connectPromise) return await connectPromise
			return
		}

		connectPromise = (async () => {
			ndkStore.setState((s) => ({ ...s, isConnecting: true }))

			try {
				const connected = await connectNdkWithTimeout(state.ndk!, timeoutMs, 'NDK')
				ndkStore.setState((s) => ({ ...s, isConnected: connected }))
				if (connected) console.log('✅ NDK connected to relays')

				// Also connect zap NDK in background (if available - skipped in local-relay-only mode)
				if (state.zapNdk) {
					void ndkActions.connectZapNdk(5000)
				}
			} finally {
				ndkStore.setState((s) => ({ ...s, isConnecting: false }))
				connectPromise = null
			}
		})()

		return await connectPromise
	},

	/**
	 * Connect the dedicated zap monitoring NDK
	 */
	connectZapNdk: async (timeoutMs = 10000): Promise<void> => {
		const state = ndkStore.state
		if (!state.zapNdk) return
		if (state.isZapNdkConnected) return
		if (connectZapPromise) return await connectZapPromise

		connectZapPromise = (async () => {
			const connected = await connectNdkWithTimeout(state.zapNdk!, timeoutMs, 'Zap NDK')
			ndkStore.setState((s) => ({ ...s, isZapNdkConnected: connected }))

			if (connected) {
				console.log('✅ Zap NDK connected to relays:', ZAP_RELAYS)
			} else {
				console.warn('⚠️ Zap NDK could not connect. Zap monitoring will be unavailable.')
			}
		})().finally(() => {
			connectZapPromise = null
		})

		return await connectZapPromise
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
			await Promise.all([ndkActions.loadRelaysFromNostr(), ndkActions.selectAndSetInitialNwcWallet()])

			// Initialize NIP-60 Cashu wallet
			try {
				const user = await signer.user()
				if (user?.pubkey) {
					void nip60Actions.initialize(user.pubkey)
				}
			} catch (e) {
				console.error('[ndk] Failed to initialize NIP-60 wallet:', e)
			}
		} else {
			ndkActions.setActiveNwcWalletUri(null)
			nip60Actions.reset()
		}
	},

	/**
	 * Load user's relay list from Nostr (kind 10002)
	 * This enables the outbox model to work properly by adding user's preferred relays
	 */
	loadRelaysFromNostr: async (): Promise<void> => {
		const ndk = ndkStore.state.ndk
		if (!ndk || !ndk.signer) {
			console.warn('NDK or signer not available for loading relays')
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
			console.warn('User or user pubkey not available from signer')
			return
		}

		try {
			const relayPrefs = await fetchUserRelayListWithPreferences(user.pubkey)
			if (relayPrefs && relayPrefs.length > 0) {
				console.log(`📡 Loading ${relayPrefs.length} relays from user's Nostr relay list`)
				for (const relay of relayPrefs) {
					ndkActions.addSingleRelay(relay.url)
				}
			} else {
				console.log('📡 No relay list found on Nostr for user')
			}
		} catch (error) {
			console.error('Failed to load relays from Nostr:', error)
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
	 * Publish an event respecting the current stage's write restrictions.
	 * In staging, events are only published to the staging relay.
	 * In production/development, events are published to all connected relays.
	 *
	 * @param event The NDKEvent to publish (must already be signed)
	 * @returns Promise resolving to the set of relays the event was published to
	 */
	publishEvent: async (event: NDKEvent): Promise<Set<any>> => {
		const relaySet = getWriteRelaySet()
		return event.publish(relaySet)
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
