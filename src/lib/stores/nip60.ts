import { NDKCashuWallet, NDKCashuDeposit, type NDKWalletBalance, type NDKWalletTransaction, NDKWalletStatus } from '@nostr-dev-kit/wallet'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { ndkStore } from './ndk'

const DEFAULT_MINT_KEY = 'nip60_default_mint'

export interface Nip60State {
	wallet: NDKCashuWallet | null
	status: 'idle' | 'initializing' | 'ready' | 'no_wallet' | 'error'
	balance: number
	mintBalances: Record<string, number>
	mints: string[]
	defaultMint: string | null
	transactions: NDKWalletTransaction[]
	error: string | null
	// Active deposit tracking
	activeDeposit: NDKCashuDeposit | null
	depositInvoice: string | null
	depositStatus: 'idle' | 'pending' | 'success' | 'error'
}

const initialState: Nip60State = {
	wallet: null,
	status: 'idle',
	balance: 0,
	mintBalances: {},
	mints: [],
	defaultMint: typeof localStorage !== 'undefined' ? localStorage.getItem(DEFAULT_MINT_KEY) : null,
	transactions: [],
	error: null,
	activeDeposit: null,
	depositInvoice: null,
	depositStatus: 'idle',
}

export const nip60Store = new Store<Nip60State>(initialState)

// Keep track of transaction subscription cleanup
let transactionUnsubscribe: (() => void) | null = null

/**
 * Get all mints - combines configured mints with mints that have balances
 */
function getAllMints(wallet: NDKCashuWallet): string[] {
	const configuredMints = wallet.mints ?? []
	const balanceMints = Object.keys(wallet.mintBalances ?? {})
	// Combine and deduplicate
	return Array.from(new Set([...configuredMints, ...balanceMints]))
}

export const nip60Actions = {
	initialize: async (pubkey: string): Promise<void> => {
		const state = nip60Store.state

		// Don't re-initialize if already initializing or ready
		if (state.status === 'initializing') return
		if (state.status === 'ready' && state.wallet) return

		const ndk = ndkStore.state.ndk
		if (!ndk) {
			console.warn('[nip60] NDK not initialized')
			return
		}

		nip60Store.setState((s) => ({
			...s,
			status: 'initializing',
			error: null,
		}))

		try {
			console.log('[nip60] Initializing wallet for pubkey:', pubkey)
			console.log('[nip60] NDK signer:', ndk.signer ? 'present' : 'missing')
			console.log('[nip60] NDK pool relays:', Array.from(ndk.pool?.relays?.keys() ?? []))

			// First, try to fetch the existing wallet event (kind 17375)
			const walletEvent = await ndk.fetchEvent({ kinds: [17375], authors: [pubkey] })
			console.log('[nip60] Wallet event fetch result:', walletEvent ? 'found' : 'not found')

			let wallet: NDKCashuWallet

			if (walletEvent) {
				// Load wallet from existing event - this decrypts and loads mints/privkeys
				console.log('[nip60] Loading wallet from event:', walletEvent.id)
				const loadedWallet = await NDKCashuWallet.from(walletEvent)
				if (!loadedWallet) {
					throw new Error('Failed to load wallet from event')
				}
				wallet = loadedWallet
				console.log('[nip60] Wallet loaded from event, mints:', wallet.mints)
			} else {
				// No wallet event found - create a new wallet instance
				console.log('[nip60] No wallet event found, creating new instance')
				wallet = new NDKCashuWallet(ndk)
			}

			// Configure the wallet's relaySet from NDK's connected relays if not already set
			if (!wallet.relaySet) {
				const relayUrls = Array.from(ndk.pool?.relays?.keys() ?? [])
				if (relayUrls.length > 0) {
					wallet.relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk)
					console.log('[nip60] Configured wallet relaySet with:', relayUrls)
				}
			}

			// Store wallet in state FIRST so event handlers can use it
			nip60Store.setState((s) => ({
				...s,
				wallet,
			}))

			// Subscribe to balance updates
			wallet.on('balance_updated', (newBalance?: NDKWalletBalance) => {
				console.log('[nip60] Balance updated:', newBalance)
				nip60Store.setState((s) => ({
					...s,
					balance: newBalance?.amount ?? 0,
					mintBalances: wallet.mintBalances ?? {},
					mints: getAllMints(wallet),
				}))
			})

			// Listen for status changes
			wallet.on('status_changed', (status: NDKWalletStatus) => {
				console.log('[nip60] Wallet status changed:', status)
				if (status === NDKWalletStatus.READY) {
					const allMints = getAllMints(wallet)
					const hasWallet = allMints.length > 0 || (wallet.balance?.amount ?? 0) > 0
					nip60Store.setState((s) => ({
						...s,
						status: hasWallet ? 'ready' : 'no_wallet',
						balance: wallet.balance?.amount ?? 0,
						mints: allMints,
						mintBalances: wallet.mintBalances ?? {},
					}))
				} else if (status === NDKWalletStatus.FAILED) {
					nip60Store.setState((s) => ({
						...s,
						status: 'error',
						error: 'Wallet failed to load',
					}))
				}
			})

			// Start the wallet - this subscribes to token events and loads balance
			await wallet.start({ pubkey })
			const allMints = getAllMints(wallet)
			console.log('[nip60] Wallet started')
			console.log('[nip60] Configured mints:', wallet.mints)
			console.log('[nip60] All mints (including from balances):', allMints)
			console.log('[nip60] Balance:', wallet.balance)
			console.log('[nip60] Mint balances:', wallet.mintBalances)

			// Determine if user has an existing wallet (we found a wallet event OR have mints/balance)
			const hasWallet = walletEvent !== null || allMints.length > 0 || (wallet.balance?.amount ?? 0) > 0

			nip60Store.setState((s) => ({
				...s,
				status: hasWallet ? 'ready' : 'no_wallet',
				balance: wallet.balance?.amount ?? 0,
				mints: allMints,
				mintBalances: wallet.mintBalances ?? {},
			}))

			// Only load transactions if we have a wallet
			if (hasWallet) {
				void nip60Actions.loadTransactions()
			}
		} catch (err) {
			console.error('[nip60] Failed to initialize wallet:', err)
			nip60Store.setState((s) => ({
				...s,
				status: 'error',
				error: err instanceof Error ? err.message : 'Failed to initialize wallet',
			}))
		}
	},

	loadTransactions: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot load transactions without wallet')
			return
		}

		try {
			console.log('[nip60] Fetching transactions using wallet.fetchTransactions()...')
			const txs = await wallet.fetchTransactions()
			console.log('[nip60] Transactions fetched:', txs.length)

			nip60Store.setState((s) => ({
				...s,
				transactions: txs,
			}))

			// Subscribe to new transactions
			nip60Actions.subscribeToTransactions()
		} catch (err) {
			console.error('[nip60] Failed to fetch transactions:', err)
		}
	},

	subscribeToTransactions: (): void => {
		const wallet = nip60Store.state.wallet
		if (!wallet) return

		// Clean up existing subscription
		if (transactionUnsubscribe) {
			transactionUnsubscribe()
			transactionUnsubscribe = null
		}

		console.log('[nip60] Subscribing to transaction updates...')
		transactionUnsubscribe = wallet.subscribeTransactions((tx: NDKWalletTransaction) => {
			console.log('[nip60] New transaction received:', tx)
			nip60Store.setState((s) => {
				// Check if transaction already exists
				const exists = s.transactions.some((t) => t.id === tx.id)
				if (exists) return s

				// Add new transaction at the beginning (newest first)
				return {
					...s,
					transactions: [tx, ...s.transactions],
				}
			})
		})
	},

	/**
	 * Create a new NIP-60 wallet with the specified mints
	 */
	createWallet: async (mints: string[]): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.error('[nip60] Cannot create wallet - wallet instance not initialized')
			return
		}

		try {
			console.log('[nip60] Creating new wallet with mints:', mints)
			const result = await NDKCashuWallet.create(wallet.ndk, mints)
			console.log('[nip60] Wallet created:', result)

			// Re-initialize to pick up the new wallet
			nip60Store.setState(() => initialState)
			const ndk = ndkStore.state.ndk
			if (ndk?.signer) {
				const user = await ndk.signer.user()
				if (user?.pubkey) {
					await nip60Actions.initialize(user.pubkey)
				}
			}
		} catch (err) {
			console.error('[nip60] Failed to create wallet:', err)
			nip60Store.setState((s) => ({
				...s,
				error: err instanceof Error ? err.message : 'Failed to create wallet',
			}))
		}
	},

	reset: (): void => {
		// Clean up transaction subscription
		if (transactionUnsubscribe) {
			transactionUnsubscribe()
			transactionUnsubscribe = null
		}

		const state = nip60Store.state
		if (state.wallet) {
			state.wallet.stop()
			state.wallet.removeAllListeners?.()
		}
		nip60Store.setState(() => initialState)
	},

	getWallet: (): NDKCashuWallet | null => {
		return nip60Store.state.wallet
	},

	/**
	 * Refresh wallet balance and transactions
	 */
	refresh: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot refresh without wallet')
			return
		}

		console.log('[nip60] Refreshing wallet data...')

		// Update balance from wallet
		nip60Store.setState((s) => ({
			...s,
			balance: wallet.balance?.amount ?? 0,
			mintBalances: wallet.mintBalances ?? {},
			mints: getAllMints(wallet),
		}))

		// Reload transactions
		await nip60Actions.loadTransactions()
		const test = wallet.getMintsWithBalance(10)
		console.log('[nip60] Mints with balance >= 10:', test)

		console.log('[nip60] Refresh complete')
	},

	/**
	 * Add a mint to the wallet (locally, call publish to save)
	 */
	addMint: (mintUrl: string): void => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot add mint without wallet')
			return
		}

		// Normalize URL
		const normalizedUrl = mintUrl.trim().replace(/\/$/, '')
		if (!normalizedUrl) return

		// Check if already exists
		if (wallet.mints.includes(normalizedUrl)) {
			console.log('[nip60] Mint already exists:', normalizedUrl)
			return
		}

		console.log('[nip60] Adding mint:', normalizedUrl)
		wallet.mints = [...wallet.mints, normalizedUrl]

		// Update store state
		nip60Store.setState((s) => ({
			...s,
			mints: getAllMints(wallet),
		}))
	},

	/**
	 * Remove a mint from the wallet (locally, call publish to save)
	 */
	removeMint: (mintUrl: string): void => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot remove mint without wallet')
			return
		}

		console.log('[nip60] Removing mint:', mintUrl)
		wallet.mints = wallet.mints.filter((m) => m !== mintUrl)

		// Update store state - note: mints with balance will still show even after removal from config
		nip60Store.setState((s) => ({
			...s,
			mints: getAllMints(wallet),
			mintBalances: Object.fromEntries(Object.entries(s.mintBalances).filter(([m]) => m !== mintUrl)),
		}))
	},

	/**
	 * Publish wallet changes to Nostr
	 */
	publishWallet: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot publish without wallet')
			return
		}

		try {
			console.log('[nip60] Publishing wallet with mints:', wallet.mints)
			await wallet.publish()
			console.log('[nip60] Wallet published successfully')
		} catch (err) {
			console.error('[nip60] Failed to publish wallet:', err)
			throw err
		}
	},

	/**
	 * Set the default mint for deposits
	 */
	setDefaultMint: (mintUrl: string | null): void => {
		console.log('[nip60] Setting default mint:', mintUrl)
		if (mintUrl) {
			localStorage.setItem(DEFAULT_MINT_KEY, mintUrl)
		} else {
			localStorage.removeItem(DEFAULT_MINT_KEY)
		}
		nip60Store.setState((s) => ({
			...s,
			defaultMint: mintUrl,
		}))
	},

	/**
	 * Start a Lightning deposit (mint ecash)
	 * @param amount Amount in sats to deposit
	 * @param mint Optional mint URL (uses default if not specified)
	 */
	startDeposit: async (amount: number, mint?: string): Promise<string | null> => {
		const wallet = nip60Store.state.wallet
		const state = nip60Store.state
		if (!wallet) {
			console.warn('[nip60] Cannot deposit without wallet')
			return null
		}

		const targetMint = mint ?? state.defaultMint
		if (!targetMint) {
			console.warn('[nip60] No mint specified and no default mint set')
			nip60Store.setState((s) => ({
				...s,
				depositStatus: 'error',
				error: 'No mint specified. Please select a default mint first.',
			}))
			return null
		}

		// Ensure wallet has the target mint configured
		if (!wallet.mints.includes(targetMint)) {
			console.log('[nip60] Adding target mint to wallet:', targetMint)
			wallet.mints = [...wallet.mints, targetMint]
		}

		try {
			console.log('[nip60] Starting deposit of', amount, 'sats to mint:', targetMint)
			nip60Store.setState((s) => ({
				...s,
				depositStatus: 'pending',
				error: null,
			}))

			const deposit = wallet.deposit(amount, targetMint)
			const invoice = await deposit.start()

			console.log('[nip60] Deposit invoice generated:', invoice?.substring(0, 50) + '...')

			nip60Store.setState((s) => ({
				...s,
				activeDeposit: deposit,
				depositInvoice: invoice ?? null,
			}))

			// Listen for deposit completion
			deposit.on('success', (token) => {
				console.log('[nip60] Deposit successful, token received:', token)
				nip60Store.setState((s) => ({
					...s,
					depositStatus: 'success',
					activeDeposit: null,
					depositInvoice: null,
				}))
				// Refresh to update balance
				void nip60Actions.refresh()
			})

			deposit.on('error', (err: Error | string) => {
				console.error('[nip60] Deposit error:', err)
				nip60Store.setState((s) => ({
					...s,
					depositStatus: 'error',
					error: typeof err === 'string' ? err : err.message,
					activeDeposit: null,
					depositInvoice: null,
				}))
			})

			return invoice ?? null
		} catch (err) {
			console.error('[nip60] Failed to start deposit:', err)
			nip60Store.setState((s) => ({
				...s,
				depositStatus: 'error',
				error: err instanceof Error ? err.message : 'Failed to start deposit',
				activeDeposit: null,
				depositInvoice: null,
			}))
			return null
		}
	},

	/**
	 * Cancel an active deposit
	 */
	cancelDeposit: (): void => {
		console.log('[nip60] Cancelling deposit')
		nip60Store.setState((s) => ({
			...s,
			activeDeposit: null,
			depositInvoice: null,
			depositStatus: 'idle',
		}))
	},

	/**
	 * Withdraw to Lightning (melt ecash)
	 * @param invoice Lightning invoice to pay
	 */
	withdrawLightning: async (invoice: string): Promise<boolean> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot withdraw without wallet')
			return false
		}

		try {
			console.log('[nip60] Withdrawing to Lightning invoice:', invoice.substring(0, 50) + '...')
			const result = await wallet.lnPay({ pr: invoice })
			console.log('[nip60] Withdrawal result:', result)

			// Refresh to update balance
			await nip60Actions.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to withdraw:', err)
			throw err
		}
	},

	/**
	 * Send eCash - generates a Cashu token string
	 * @param amount Amount in sats to send
	 * @param mint Optional mint URL to send from
	 */
	sendEcash: async (amount: number, mint?: string): Promise<string | null> => {
		const wallet = nip60Store.state.wallet
		const state = nip60Store.state
		if (!wallet) {
			console.warn('[nip60] Cannot send without wallet')
			return null
		}

		const targetMint = mint ?? state.defaultMint ?? undefined

		// Ensure wallet has mints configured - sync from mintBalances if needed
		if (wallet.mints.length === 0) {
			const balanceMints = Object.keys(wallet.mintBalances ?? {})
			if (balanceMints.length > 0) {
				console.log('[nip60] Syncing mints from mintBalances:', balanceMints)
				wallet.mints = balanceMints
			}
		}

		// If target mint specified but not in wallet.mints, add it
		if (targetMint && !wallet.mints.includes(targetMint)) {
			console.log('[nip60] Adding target mint to wallet:', targetMint)
			wallet.mints = [...wallet.mints, targetMint]
		}

		try {
			console.log('[nip60] Generating eCash token for', amount, 'sats from mint:', targetMint ?? 'any')
			console.log('[nip60] Wallet mints:', wallet.mints)
			const result = await wallet.send(amount, targetMint)
			console.log('[nip60] eCash token generated')

			// Refresh to update balance
			await nip60Actions.refresh()
			return result
		} catch (err) {
			console.error('[nip60] Failed to send eCash:', err)
			throw err
		}
	},

	/**
	 * Receive eCash - redeem a Cashu token
	 * @param token Cashu token string to receive
	 */
	receiveEcash: async (token: string): Promise<boolean> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot receive without wallet')
			return false
		}

		try {
			console.log('[nip60] Receiving eCash token...')
			await wallet.receiveToken(token)
			console.log('[nip60] eCash token received successfully')

			// Refresh to update balance
			await nip60Actions.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to receive eCash:', err)
			throw err
		}
	},
}

export const useNip60 = () => {
	return {
		...nip60Store.state,
		...nip60Actions,
	}
}
