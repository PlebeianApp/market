import { NDKCashuWallet, NDKCashuDeposit, type NDKWalletBalance, type NDKWalletTransaction, NDKWalletStatus } from '@nostr-dev-kit/wallet'
import { NDKRelaySet } from '@nostr-dev-kit/ndk'
import { Store } from '@tanstack/store'
import { CashuMint, CashuWallet, getEncodedToken, getDecodedToken, type Proof } from '@cashu/cashu-ts'
import { ndkStore } from './ndk'
import { loadUserData, saveUserData, getProofsForMint, getMintHostname, type PendingToken } from '@/lib/wallet'

const DEFAULT_MINT_KEY = 'nip60_default_mint'
const PENDING_TOKENS_KEY = 'nip60_pending_tokens'

// Re-export for backward compatibility
export type PendingNip60Token = PendingToken

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
	// Pending tokens tracking (tokens generated but not yet claimed by recipient)
	pendingTokens: PendingNip60Token[]
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
	pendingTokens: [],
}

export const nip60Store = new Store<Nip60State>(initialState)

// Keep track of transaction subscription cleanup
let transactionUnsubscribe: (() => void) | null = null

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const loadPendingTokens = (): PendingToken[] => loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, [])

const savePendingTokens = (tokens: PendingToken[]): void => saveUserData(PENDING_TOKENS_KEY, tokens)

/**
 * Select proofs from available proofs to meet the target amount.
 * Returns selected proofs and their total value.
 */
function selectProofs(proofs: Proof[], amount: number): { selected: Proof[]; total: number } {
	// Sort proofs by amount (smallest first) for better selection
	const sorted = [...proofs].sort((a, b) => a.amount - b.amount)
	const selected: Proof[] = []
	let total = 0

	for (const proof of sorted) {
		if (total >= amount) break
		selected.push(proof)
		total += proof.amount
	}

	return { selected, total }
}

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
 * Get accurate balances directly from wallet state.
 * wallet.state.dump() provides the source of truth for proofs and balances.
 */
function getBalancesFromState(wallet: NDKCashuWallet): { totalBalance: number; mintBalances: Record<string, number> } {
	const dump = wallet.state.dump()
	const mintBalances = { ...dump.balances }

	// Ensure all configured mints are present (even with 0 balance)
	for (const mint of wallet.mints ?? []) {
		if (!(mint in mintBalances)) {
			mintBalances[mint] = 0
		}
	}

	return {
		totalBalance: dump.totalBalance,
		mintBalances,
	}
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
			wallet.on('balance_updated', () => {
				console.log('[nip60] Balance updated event')
				const { totalBalance, mintBalances } = getBalancesFromState(wallet)
				console.log('[nip60] balance_updated:', { totalBalance, mintBalances })
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
					const { totalBalance, mintBalances } = getBalancesFromState(wallet)
					const allMints = getAllMints(wallet)
					const hasWallet = allMints.length > 0 || totalBalance > 0

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
			const { totalBalance, mintBalances } = getBalancesFromState(wallet)
			const allMints = getAllMints(wallet)
			console.log('[nip60] Wallet started')
			console.log('[nip60] Configured mints:', wallet.mints)
			console.log('[nip60] All mints (including from balances):', allMints)
			console.log('[nip60] Balance:', totalBalance)
			console.log('[nip60] Mint balances:', mintBalances)

			// Determine if user has an existing wallet (we found a wallet event OR have mints/balance)
			const hasWallet = walletEvent !== null || allMints.length > 0 || totalBalance > 0

			nip60Store.setState((s) => ({
				...s,
				status: hasWallet ? 'ready' : 'no_wallet',
				balance: totalBalance,
				mints: allMints,
				mintBalances,
			}))

			// Only load transactions if we have a wallet
			if (hasWallet) {
				void nip60Actions.loadTransactions()
			}

			// Load pending tokens from localStorage
			nip60Actions.loadPendingTokens()
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
	 * @param options.consolidate If true, consolidate tokens first (checks for spent proofs)
	 */
	refresh: async (options?: { consolidate?: boolean }): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot refresh without wallet')
			return
		}

		const shouldConsolidate = options?.consolidate ?? false

		console.log('[nip60] Refreshing wallet data...', shouldConsolidate ? '(with consolidation)' : '')

		// Consolidate tokens if requested - this checks for spent proofs
		if (shouldConsolidate) {
			try {
				console.log('[nip60] Consolidating tokens (checking for spent proofs)...')
				await wallet.consolidateTokens()
				console.log('[nip60] Token consolidation complete')
			} catch (err) {
				console.error('[nip60] Failed to consolidate tokens:', err)
				// Continue with refresh even if consolidation fails
			}
		}

		// Get balances directly from wallet state (source of truth)
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)
		console.log('[nip60] After refresh - balance:', totalBalance, 'mintBalances:', mintBalances)

		nip60Store.setState((s) => ({
			...s,
			balance: totalBalance,
			mintBalances,
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
			const errorMessage = err instanceof Error ? err.message : String(err)

			// Handle state sync errors - consolidate and retry
			const isStateError =
				errorMessage.toLowerCase().includes('already spent') ||
				errorMessage.toLowerCase().includes('token spent') ||
				errorMessage.toLowerCase().includes('proof not found')

			if (isStateError) {
				console.log('[nip60] State sync error - consolidating and retrying...')
				try {
					await wallet.consolidateTokens()
					console.log('[nip60] Consolidation complete, retrying withdrawal...')
					await nip60Actions.refresh()

					// Retry the withdrawal
					return await attemptWithdraw()
				} catch (retryErr) {
					console.error('[nip60] Retry after consolidation failed:', retryErr)
					// Always refresh to show accurate balance
					await nip60Actions.refresh()
					throw retryErr
				}
			}

			// Always refresh after error to sync state
			await nip60Actions.refresh()
			throw err
		}
	},

	/**
	 * Send eCash - generates a Cashu token string
	 * Uses cashu-ts directly to avoid NDKCashuWallet state sync bugs.
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

		// Get current state
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)

		// Determine target mint
		let targetMint = mint ?? state.defaultMint ?? undefined

		// If no mint specified, find one with sufficient balance
		if (!targetMint) {
			targetMint = Object.keys(mintBalances).find((m) => mintBalances[m] >= amount)
		}

		if (!targetMint) {
			throw new Error(`No mint with sufficient balance. Available: ${totalBalance} sats`)
		}

		const mintBalance = mintBalances[targetMint] ?? 0
		console.log('[nip60] Balance at target mint:', targetMint, mintBalance)
		if (mintBalance < amount) {
			throw new Error(`Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`)
		}

		// Get proofs for this mint using shared utility
		const mintProofs = getProofsForMint(wallet, targetMint)

		if (mintProofs.length === 0) {
			throw new Error(`No proofs available at ${getMintHostname(targetMint)}. Try refreshing your wallet.`)
		}

		console.log('[nip60] Generating eCash token for', amount, 'sats from', targetMint)
		console.log(
			'[nip60] Available proofs:',
			mintProofs.length,
			'Total:',
			mintProofs.reduce((s, p) => s + p.amount, 0),
		)

		// Select proofs to use
		const { selected: selectedProofs, total: selectedTotal } = selectProofs(mintProofs, amount)

		if (selectedTotal < amount) {
			throw new Error(`Could not select enough proofs. Need ${amount}, have ${selectedTotal}`)
		}

		console.log('[nip60] Selected proofs:', selectedProofs.length, 'Total:', selectedTotal)

		try {
			// Create CashuWallet for mint operations
			const cashuMint = new CashuMint(targetMint)
			const cashuWallet = new CashuWallet(cashuMint)

			// Load mint keys
			await cashuWallet.loadMint()

			let tokenProofs: Proof[]
			let changeProofs: Proof[] = []

			if (selectedTotal === amount) {
				// Exact amount - use proofs directly
				tokenProofs = selectedProofs
			} else {
				// Need to swap for exact amount + change
				console.log('[nip60] Swapping proofs to get exact amount...')
				const swapResult = await cashuWallet.swap(amount, selectedProofs)
				tokenProofs = swapResult.send
				changeProofs = swapResult.keep
				console.log('[nip60] Swap complete. Send:', tokenProofs.length, 'Keep:', changeProofs.length)
			}

			// Create the token
			const token = getEncodedToken({
				mint: targetMint,
				proofs: tokenProofs,
			})

			console.log('[nip60] Token created:', token.substring(0, 50) + '...')

			// Save to pending tokens IMMEDIATELY before any state updates
			const pendingToken: PendingNip60Token = {
				id: generateId(),
				token,
				amount: tokenProofs.reduce((s, p) => s + p.amount, 0),
				mintUrl: targetMint,
				createdAt: Date.now(),
				status: 'pending',
			}

			const pendingTokens = [...nip60Store.state.pendingTokens, pendingToken]
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			console.log('[nip60] Token saved to pending list:', pendingToken.id)

			// The proofs we used are now "spent" at the mint.
			// NDKCashuWallet stores proofs in Nostr events, and the wallet will detect
			// spent proofs on the next consolidateTokens() call.
			//
			// The token is already saved to pending list, so even if state sync fails,
			// the token won't be lost - user can reclaim or share it.
			//
			// For change proofs, we need to add them back to the wallet
			if (changeProofs.length > 0) {
				try {
					// Receive the change proofs back into the wallet
					const changeToken = getEncodedToken({ mint: targetMint, proofs: changeProofs })
					await wallet.receiveToken(changeToken)
					console.log('[nip60] Change proofs added back to wallet')
				} catch (changeErr) {
					console.error('[nip60] Failed to add change proofs (will recover on consolidation):', changeErr)
				}
			}

			// Consolidate to sync state (detect spent proofs)
			try {
				console.log('[nip60] Consolidating to sync wallet state...')
				await wallet.consolidateTokens()
			} catch (consolidateErr) {
				console.error('[nip60] Consolidation error (non-fatal):', consolidateErr)
			}

			// Refresh to update balance display
			await nip60Actions.refresh()

			return token
		} catch (err) {
			console.error('[nip60] Failed to send eCash:', err)

			// Check if this is a "proofs already spent" error from the mint
			const errorMessage = err instanceof Error ? err.message : String(err)
			if (errorMessage.toLowerCase().includes('already spent') || errorMessage.toLowerCase().includes('token spent')) {
				console.log('[nip60] Proofs were spent - consolidating...')
				try {
					await wallet.consolidateTokens()
					await nip60Actions.refresh()
				} catch (consolidateErr) {
					console.error('[nip60] Consolidation failed:', consolidateErr)
				}
				throw new Error('Some proofs were already spent. Please try again.')
			}

			// Provide more user-friendly error messages
			if (err instanceof Error) {
				if (err.message.includes('amount preferences') || err.message.includes('keyset')) {
					throw new Error(`Cannot create exact amount of ${amount} sats. Try a different amount.`)
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

	/**
	 * Load pending tokens from localStorage
	 */
	loadPendingTokens: (): void => {
		const tokens = loadPendingTokens()
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
		console.log('[nip60] Loaded pending tokens:', tokens.length)
	},

	/**
	 * Reclaim a pending token (if recipient hasn't claimed it yet)
	 * This receives the token back into our wallet
	 */
	reclaimToken: async (tokenId: string): Promise<boolean> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = nip60Store.state.pendingTokens.find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		console.log('[nip60] Attempting to reclaim token:', tokenId)

		try {
			// Try to receive the token back
			await wallet.receiveToken(pendingToken.token)

			// Update status to reclaimed
			const pendingTokens = nip60Store.state.pendingTokens.map((t) => (t.id === tokenId ? { ...t, status: 'reclaimed' as const } : t))
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			// Refresh balances
			await nip60Actions.refresh()

			console.log('[nip60] Token reclaimed successfully')
			return true
		} catch (err) {
			// Token was already claimed by recipient
			console.log('[nip60] Token already claimed:', err)

			// Mark as claimed
			const pendingTokens = nip60Store.state.pendingTokens.map((t) => (t.id === tokenId ? { ...t, status: 'claimed' as const } : t))
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			return false
		}
	},

	/**
	 * Remove a pending token from the list
	 */
	removePendingToken: (tokenId: string): void => {
		const pendingTokens = nip60Store.state.pendingTokens.filter((t) => t.id !== tokenId)
		savePendingTokens(pendingTokens)
		nip60Store.setState((s) => ({ ...s, pendingTokens }))
		console.log('[nip60] Pending token removed:', tokenId)
	},

	/**
	 * Get active pending tokens (not claimed or reclaimed)
	 */
	getActivePendingTokens: (): PendingNip60Token[] => {
		return nip60Store.state.pendingTokens.filter((t) => t.status === 'pending')
	},
}

export const useNip60 = () => {
	return {
		...nip60Store.state,
		...nip60Actions,
	}
}
