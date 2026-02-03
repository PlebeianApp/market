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

/**
 * Calculate exact per-mint balances using binary search with getMintsWithBalance.
 * This is a workaround for when wallet.mintBalances returns stale data.
 */
function calculateMintBalancesViaBinarySearch(wallet: NDKCashuWallet): Record<string, number> {
	const result: Record<string, number> = {}
	const totalBalance = wallet.balance?.amount ?? 0

	// Get all mints that have any balance
	const mintsWithBalance = wallet.getMintsWithBalance(1)
	const allMints = getAllMints(wallet)

	// Initialize all mints with 0
	for (const mint of allMints) {
		result[mint] = 0
	}

	// For each mint with balance, use binary search to find exact amount
	for (const mint of mintsWithBalance) {
		// Binary search between 1 and totalBalance to find max amount for this mint
		let low = 1
		let high = totalBalance
		let maxBalance = 0

		while (low <= high) {
			const mid = Math.floor((low + high) / 2)
			const mintsAtMid = wallet.getMintsWithBalance(mid)

			if (mintsAtMid.includes(mint)) {
				maxBalance = mid
				low = mid + 1
			} else {
				high = mid - 1
			}
		}

		result[mint] = maxBalance
	}

	return result
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
				console.log('[nip60] Balance updated event:', newBalance)
				const totalBalance = newBalance?.amount ?? 0

				// Get mint balances - use binary search if regular getter seems stale
				const regularMintBalances = { ...(wallet.mintBalances ?? {}) }
				const regularSum = Object.values(regularMintBalances).reduce((a, b) => a + b, 0)

				let mintBalances: Record<string, number>
				if (Math.abs(regularSum - totalBalance) > 1) {
					console.log('[nip60] balance_updated: mintBalances stale, using binary search')
					mintBalances = calculateMintBalancesViaBinarySearch(wallet)
				} else {
					mintBalances = regularMintBalances
				}

				console.log('[nip60] balance_updated: calculated mintBalances:', mintBalances)
				nip60Store.setState((s) => ({
					...s,
					balance: totalBalance,
					mintBalances,
					mints: getAllMints(wallet),
				}))
			})

			// Listen for status changes
			wallet.on('status_changed', (status: NDKWalletStatus) => {
				console.log('[nip60] Wallet status changed:', status)
				if (status === NDKWalletStatus.READY) {
					const allMints = getAllMints(wallet)
					const totalBalance = wallet.balance?.amount ?? 0
					const hasWallet = allMints.length > 0 || totalBalance > 0

					// Get mint balances - use binary search if regular getter seems stale
					const regularMintBalances = { ...(wallet.mintBalances ?? {}) }
					const regularSum = Object.values(regularMintBalances).reduce((a, b) => a + b, 0)
					const mintBalances =
						Math.abs(regularSum - totalBalance) > 1 ? calculateMintBalancesViaBinarySearch(wallet) : regularMintBalances

					nip60Store.setState((s) => ({
						...s,
						status: hasWallet ? 'ready' : 'no_wallet',
						balance: totalBalance,
						mints: allMints,
						mintBalances,
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
			const totalBalance = wallet.balance?.amount ?? 0
			const hasWallet = walletEvent !== null || allMints.length > 0 || totalBalance > 0

			// Get mint balances - use binary search if regular getter seems stale
			const regularMintBalances = { ...(wallet.mintBalances ?? {}) }
			const regularSum = Object.values(regularMintBalances).reduce((a, b) => a + b, 0)
			const initialMintBalances =
				Math.abs(regularSum - totalBalance) > 1 ? calculateMintBalancesViaBinarySearch(wallet) : regularMintBalances

			nip60Store.setState((s) => ({
				...s,
				status: hasWallet ? 'ready' : 'no_wallet',
				balance: totalBalance,
				mints: allMints,
				mintBalances: initialMintBalances,
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
		console.log('[nip60] Current wallet.balance:', wallet.balance)
		console.log('[nip60] Current wallet.mintBalances:', wallet.mintBalances)

		// Try to force balance recalculation by checking proofs if method exists
		if (typeof (wallet as any).checkProofs === 'function') {
			console.log('[nip60] Checking proofs...')
			await (wallet as any).checkProofs()
		}

		// Get the updated balance - read it fresh after recalculation
		const newBalance = wallet.balance?.amount ?? 0

		// First try the regular mintBalances getter
		const regularMintBalances = { ...(wallet.mintBalances ?? {}) }
		console.log('[nip60] wallet.mintBalances getter:', regularMintBalances)

		// Calculate sum of regular mint balances to check if they're stale
		const regularSum = Object.values(regularMintBalances).reduce((a, b) => a + b, 0)
		console.log('[nip60] Sum of mintBalances:', regularSum, 'vs total balance:', newBalance)

		// If the sum doesn't match the total balance, use binary search as fallback
		let newMintBalances: Record<string, number>
		if (Math.abs(regularSum - newBalance) > 1) {
			// Balances appear stale, use binary search hack
			console.log('[nip60] mintBalances appears stale, using binary search calculation...')
			newMintBalances = calculateMintBalancesViaBinarySearch(wallet)
			console.log('[nip60] Binary search calculated balances:', newMintBalances)
		} else {
			// Regular balances seem correct
			newMintBalances = regularMintBalances
			// Still ensure all known mints are present
			const knownMints = getAllMints(wallet)
			for (const mint of knownMints) {
				if (!(mint in newMintBalances)) {
					newMintBalances[mint] = 0
				}
			}
		}

		console.log('[nip60] After refresh - balance:', newBalance, 'mintBalances:', newMintBalances)

		nip60Store.setState((s) => ({
			...s,
			balance: newBalance,
			mintBalances: newMintBalances,
			mints: getAllMints(wallet),
		}))

		// Reload transactions
		await nip60Actions.loadTransactions()

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

		// Helper function to attempt withdrawal
		const attemptWithdraw = async (): Promise<boolean> => {
			console.log('[nip60] Balance before withdrawal:', wallet.balance, wallet.mintBalances)
			console.log('[nip60] Withdrawing to Lightning invoice:', invoice.substring(0, 50) + '...')
			const result = await wallet.lnPay({ pr: invoice })
			console.log('[nip60] Withdrawal result:', result)
			console.log('[nip60] Balance after lnPay:', wallet.balance, wallet.mintBalances)

			// Small delay to allow wallet to process the change
			await new Promise((resolve) => setTimeout(resolve, 500))

			// Refresh to update balance
			await nip60Actions.refresh()
			return true
		}

		try {
			return await attemptWithdraw()
		} catch (err) {
			console.error('[nip60] Failed to withdraw (first attempt):', err)

			// Check if this is a "token already spent" error
			const errorMessage = err instanceof Error ? err.message : String(err)
			if (errorMessage.toLowerCase().includes('already spent') || errorMessage.toLowerCase().includes('token spent')) {
				console.log('[nip60] Token already spent error - consolidating and retrying...')

				// Consolidate tokens to remove spent proofs
				try {
					await wallet.consolidateTokens()
					console.log('[nip60] Consolidation complete, retrying withdrawal...')
					await nip60Actions.refresh()

					// Retry the withdrawal
					return await attemptWithdraw()
				} catch (retryErr) {
					console.error('[nip60] Retry after consolidation failed:', retryErr)
					throw retryErr
				}
			}

			throw err
		}
	},

	/**
	 * Consolidate tokens - checks for spent proofs and cleans up wallet state
	 */
	consolidateTokens: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot consolidate without wallet')
			return
		}

		try {
			console.log('[nip60] Consolidating tokens (checking for spent proofs)...')
			await wallet.consolidateTokens()
			console.log('[nip60] Token consolidation complete')
			// Refresh to update balances after consolidation
			await nip60Actions.refresh()
		} catch (err) {
			console.error('[nip60] Failed to consolidate tokens:', err)
			// Don't throw - consolidation failure shouldn't block operations
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

		// Helper function to attempt send
		const attemptSend = async (): Promise<string | null> => {
			console.log('[nip60] Generating eCash token for', amount, 'sats from mint:', targetMint ?? 'any')
			console.log('[nip60] Wallet mints:', wallet.mints)
			console.log('[nip60] Mint balances:', wallet.mintBalances)

			// Check if we have enough balance at the target mint
			if (targetMint) {
				const mintBalance = wallet.mintBalances?.[targetMint] ?? 0
				console.log('[nip60] Balance at target mint:', mintBalance)
				if (mintBalance < amount) {
					throw new Error(`Insufficient balance at ${new URL(targetMint).hostname}. Available: ${mintBalance} sats`)
				}
			}

			const result = await wallet.send(amount, targetMint)
			console.log('[nip60] eCash token generated')
			console.log('[nip60] Balance after send:', wallet.balance, wallet.mintBalances)

			// Small delay to allow wallet to process the change
			await new Promise((resolve) => setTimeout(resolve, 500))

			// Refresh to update balance
			await nip60Actions.refresh()
			return result
		}

		try {
			return await attemptSend()
		} catch (err) {
			console.error('[nip60] Failed to send eCash (first attempt):', err)

			// Check if this is a "token already spent" error
			const errorMessage = err instanceof Error ? err.message : String(err)
			if (errorMessage.toLowerCase().includes('already spent') || errorMessage.toLowerCase().includes('token spent')) {
				console.log('[nip60] Token already spent error - consolidating and retrying...')

				// Consolidate tokens to remove spent proofs
				try {
					await wallet.consolidateTokens()
					console.log('[nip60] Consolidation complete, retrying send...')
					await nip60Actions.refresh()

					// Retry the send
					return await attemptSend()
				} catch (retryErr) {
					console.error('[nip60] Retry after consolidation failed:', retryErr)
					throw retryErr
				}
			}

			// Provide more user-friendly error messages
			if (err instanceof Error) {
				if (err.message.includes('amount preferences') || err.message.includes('keyset')) {
					throw new Error(`Cannot create exact amount of ${amount} sats. Try a different amount or mint.`)
				}
			}
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
