import {
	getMintHostname,
	getProofsForMint,
	loadUserData,
	saveUserData,
	type AuctionBidPendingTokenContext,
	type PendingToken,
	type PendingTokenContext,
} from '@/lib/wallet'
import {
	AUCTION_BID_ENVELOPE_MARKER,
	AUCTION_BID_TOKEN_TOPIC,
	AUCTION_REFUND_TOPIC,
	AUCTION_TRANSFER_DM_KIND,
	parseAuctionRefundEnvelope,
} from '@/lib/auctionTransfers'
import { getAuctionHdAccountFromWalletKeys } from '@/lib/auctionHd'
import {
	CashuMint,
	CashuWallet,
	CheckStateEnum,
	getEncodedToken,
	getTokenMetadata,
	type MintKeys,
	type MintKeyset,
	type Proof,
} from '@cashu/cashu-ts'
import { NDKEvent, NDKNutzap, NDKRelaySet, NDKUser, NDKZapper, type NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKCashuDeposit, NDKCashuWallet, NDKWalletStatus, type NDKWalletTransaction } from '@nostr-dev-kit/wallet'
import { HDKey } from '@scure/bip32'
import { Store } from '@tanstack/store'
import { ndkActions, ndkStore } from './ndk'
import { configStore } from './config'

const DEFAULT_MINT_KEY = 'nip60_default_mint'
const PENDING_TOKENS_KEY = 'nip60_pending_tokens'
const AUCTION_TRANSFER_MESSAGE_IDS_KEY = 'nip60_auction_transfer_message_ids'

// Re-export for backward compatibility
export type PendingNip60Token = PendingToken

export interface Nip60LightningPaymentResult {
	preimage?: string
}

export interface Nip60NutzapResult {
	eventId: string
	event: NDKNutzap
}

export interface Nip60TestMintResult {
	mintUrl: string
	amount: number
	quoteId: string
	proofsMinted: number
}

export interface Nip60DevAuctionBidResult {
	bidEventId: string
	auctionEventId: string
	auctionCoordinates: string
	auctionTitle: string
	mintUrl: string
	bidAmount: number
	minBid: number
	topUpAmount: number
}

export type AuctionP2pkKeyScheme = 'hd_p2pk'

export interface LockAuctionBidFundsParams {
	amount: number
	mint?: string
	lockPubkey?: string
	locktime: number
	refundPubkey: string
	auctionEventId?: string
	auctionCoordinates?: string
	sellerPubkey?: string
	p2pkXpub?: string
}

export interface LockAuctionBidFundsResult {
	tokenId: string
	token: string
	amount: number
	mintUrl: string
	lockPubkey: string
	locktime: number
	refundPubkey: string
	commitment: string
	keyScheme: AuctionP2pkKeyScheme
	derivationPath?: string
	childPubkey?: string
}

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

const DEV_TEST_MINT_URL = process.env.APP_DEV_TEST_MINT_URL || 'https://testnut.cashu.space'
export const NIP60_DEV_TEST_MINTS = Array.from(
	new Set(
		[DEV_TEST_MINT_URL, 'https://testnut.cashu.space', 'https://nofees.testnut.cashu.space']
			.map((mint) => mint.trim().replace(/\/$/, ''))
			.filter(Boolean),
	),
)
const NIP60_WALLET_KIND = 17375 as unknown as NonNullable<NDKFilter['kinds']>[number]
const NIP60_WALLET_FETCH_TIMEOUT_MS = 5000
const NIP60_WALLET_LOAD_TIMEOUT_MS = 5000
const NIP60_WALLET_START_TIMEOUT_MS = 7000
const AUCTION_KIND = 30408 as unknown as NonNullable<NDKFilter['kinds']>[number]
const AUCTION_BID_KIND = 1023 as unknown as NonNullable<NDKFilter['kinds']>[number]
export const AUCTION_SETTLEMENT_GRACE_SECONDS = 3600
const HD_DERIVATION_PATH_DEPTH = 5
const HD_MAX_INDEX = 0x7fffffff

export const nip60Store = new Store<Nip60State>(initialState)

// Keep track of transaction subscription cleanup
let transactionUnsubscribe: (() => void) | null = null
let autoCleanupPromise: Promise<void> | null = null
let lastAutoCleanupAt = 0

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const normalizeMintUrl = (mintUrl: string): string => mintUrl.trim().replace(/\/$/, '')

const getDevTestMintCandidates = (preferredMintUrl?: string): string[] => {
	const normalizedPreferredMint = preferredMintUrl ? normalizeMintUrl(preferredMintUrl) : ''
	const preferred = normalizedPreferredMint && NIP60_DEV_TEST_MINTS.includes(normalizedPreferredMint) ? [normalizedPreferredMint] : []
	return Array.from(new Set([...preferred, ...NIP60_DEV_TEST_MINTS].filter(Boolean)))
}

const isKeysetVerificationError = (err: unknown): err is Error => err instanceof Error && err.message.includes("Couldn't verify keyset ID")

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const ensureWalletRuntimeDefaults = (wallet: NDKCashuWallet, ndk: NDKEvent['ndk']): void => {
	if (!ndk) return

	if (isNip60WalletDevModeEnabled()) {
		wallet.mints = Array.from(new Set([...(wallet.mints ?? []), ...NIP60_DEV_TEST_MINTS]))
	}

	if (!wallet.relaySet) {
		const connectedRelayUrls = (ndk.pool?.connectedRelays?.() ?? []).map((relay) => relay.url)
		const fallbackRelayUrls = Array.from(ndk.pool?.relays?.keys() ?? [])
		const relayCandidates = connectedRelayUrls.length > 0 ? connectedRelayUrls : fallbackRelayUrls
		const relayUrls = relayCandidates.map(normalizeRelayUrl).filter((url) => !!url)
		if (relayUrls.length > 0) {
			wallet.relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk)
		}
	}
}

const getDevTestMintKeyset = async (cashuMint: CashuMint, targetMint: string): Promise<{ keysets: MintKeyset[]; mintKeys: MintKeys }> => {
	const keysetResponse = await cashuMint.getKeySets()
	const satKeysets = keysetResponse.keysets.filter((keyset) => keyset.unit === 'sat')
	const activeSatKeyset = satKeysets.find((keyset) => keyset.active) ?? satKeysets[0]
	if (!activeSatKeyset) {
		throw new Error(`Mint ${getMintHostname(targetMint)} has no sat keysets`)
	}

	const keysResponse = await cashuMint.getKeys(activeSatKeyset.id)
	const mintKeys = keysResponse.keysets.find((keyset) => keyset.id === activeSatKeyset.id) ?? keysResponse.keysets[0]
	if (!mintKeys) {
		throw new Error(`Mint ${getMintHostname(targetMint)} returned no keys for keyset ${activeSatKeyset.id}`)
	}

	return {
		keysets: satKeysets,
		mintKeys,
	}
}

const createCashuWalletForMint = async (targetMint: string): Promise<{ cashuWallet: CashuWallet; keysetId?: string }> => {
	const normalizedTargetMint = normalizeMintUrl(targetMint)
	const cashuMint = new CashuMint(normalizedTargetMint)
	const cashuWallet = new CashuWallet(cashuMint)

	try {
		await cashuWallet.loadMint()
		return { cashuWallet }
	} catch (err) {
		if (!isNip60WalletDevModeEnabled() || !NIP60_DEV_TEST_MINTS.includes(normalizedTargetMint) || !isKeysetVerificationError(err)) {
			throw err
		}

		// testnut is currently serving a keyset ID that cashu-ts rejects. Seed the dev wallet
		// with the raw keyset metadata so we can keep exercising the faucet flow in dev mode.
		const { keysets, mintKeys } = await getDevTestMintKeyset(cashuMint, normalizedTargetMint)
		return {
			cashuWallet: new CashuWallet(cashuMint, {
				keysets,
				keys: mintKeys,
			}),
			keysetId: mintKeys.id,
		}
	}
}

const consolidateMintProofs = async (wallet: NDKCashuWallet, mint: string): Promise<void> => {
	const allProofs = wallet.state.getProofs({ mint, includeDeleted: true, onlyAvailable: false })
	if (allProofs.length === 0) return

	const { cashuWallet } = await createCashuWalletForMint(mint)
	const proofStates = await cashuWallet.checkProofsStates(allProofs)

	const spentProofs: Proof[] = []
	const unspentProofs: Proof[] = []
	const pendingProofs: Proof[] = []

	allProofs.forEach((proof, index) => {
		const state = proofStates[index]?.state
		if (state === CheckStateEnum.SPENT) {
			spentProofs.push(proof)
		} else if (state === CheckStateEnum.UNSPENT) {
			unspentProofs.push(proof)
		} else {
			pendingProofs.push(proof)
		}
	})

	if (spentProofs.length === 0) return

	if (pendingProofs.length > 0) {
		const pendingAmount = pendingProofs.reduce((sum, proof) => sum + proof.amount, 0)
		wallet.state.reserveProofs(pendingProofs, pendingAmount)
	}

	await wallet.state.update(
		{
			mint,
			store: [...unspentProofs, ...pendingProofs],
			destroy: spentProofs,
		},
		'Consolidate',
	)
}

const consolidateWalletProofs = async (wallet: NDKCashuWallet): Promise<void> => {
	const mints = Array.from(
		wallet.state
			.getMintsProofs({
				validStates: new Set(['available', 'reserved', 'deleted'] as any),
			})
			.keys(),
	).filter(Boolean)

	for (const mint of mints) {
		try {
			await consolidateMintProofs(wallet, mint)
		} catch (err) {
			console.error(`[nip60] Failed to consolidate mint ${mint}:`, err)
		}
	}
}

const normalizeRelayUrl = (relayUrl: string): string => relayUrl.trim().replace(/\/+$/, '')

const getFirstTagValue = (event: NDKEvent, tagName: string): string => event.tags.find((tag) => tag[0] === tagName)?.[1] || ''

const getTagValues = (event: NDKEvent, tagName: string): string[] =>
	event.tags.filter((tag) => tag[0] === tagName && !!tag[1]).map((tag) => tag[1])

const parseNonNegativeInt = (value: string, fallback: number = 0): number => {
	const parsed = parseInt(value, 10)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const ACTIVE_BID_STATUSES = new Set(['locked', 'accepted', 'active', 'unknown'])

const resolveLatestActiveBidByBidder = (bidEvents: NDKEvent[], bidderPubkey: string): NDKEvent | null => {
	const bidderBids = bidEvents.filter((bidEvent) => {
		if (bidEvent.pubkey !== bidderPubkey) return false
		const status = getFirstTagValue(bidEvent, 'status') || 'unknown'
		return ACTIVE_BID_STATUSES.has(status)
	})
	if (!bidderBids.length) return null

	return bidderBids.sort((a, b) => {
		const amountDelta = parseNonNegativeInt(getFirstTagValue(b, 'amount'), 0) - parseNonNegativeInt(getFirstTagValue(a, 'amount'), 0)
		if (amountDelta !== 0) return amountDelta
		const createdAtDelta = (b.created_at || 0) - (a.created_at || 0)
		if (createdAtDelta !== 0) return createdAtDelta
		return b.id.localeCompare(a.id)
	})[0]
}

const getRandomNonHardenedIndex = (): number => {
	if (globalThis.crypto?.getRandomValues) {
		const values = new Uint32Array(1)
		globalThis.crypto.getRandomValues(values)
		return values[0] % HD_MAX_INDEX
	}
	return Math.floor(Math.random() * HD_MAX_INDEX)
}

const generateDerivationPath = (): string => {
	const levels = Array.from({ length: HD_DERIVATION_PATH_DEPTH }, () => getRandomNonHardenedIndex())
	return `m/${levels.join('/')}`
}

const normalizeDerivationPath = (path: string): string => {
	const trimmed = path.trim()
	if (!trimmed) {
		throw new Error('Missing derivation path')
	}
	return trimmed.startsWith('m/') || trimmed === 'm' ? trimmed : `m/${trimmed.replace(/^\/+/, '')}`
}

const deriveChildPubkeyFromXpub = (xpub: string, path: string): string => {
	const hdRoot = HDKey.fromExtendedKey(xpub.trim())
	const child = hdRoot.derive(normalizeDerivationPath(path))
	if (!child.publicKey) {
		throw new Error('Failed to derive child pubkey from p2pk_xpub')
	}
	return toHex(child.publicKey)
}

const deriveChildPrivkeyFromXpriv = (xpriv: string, path: string): string => {
	const hdRoot = HDKey.fromExtendedKey(xpriv.trim())
	const child = hdRoot.derive(normalizeDerivationPath(path))
	if (!child.privateKey) {
		throw new Error('Failed to derive child private key from auction xpriv')
	}
	return toHex(child.privateKey)
}

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')

const sha256Hex = async (value: string): Promise<string> => {
	if (!globalThis.crypto?.subtle) {
		return ''
	}
	const encoded = new TextEncoder().encode(value)
	const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
	return toHex(new Uint8Array(digest))
}

const isLocalDevHost = (): boolean => {
	if (typeof window === 'undefined') return false
	const host = window.location.hostname
	return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
}

export const isNip60WalletDevModeEnabled = (): boolean => {
	const explicit = process.env.APP_NIP60_DEV_MODE
	if (explicit === 'true') return true
	if (explicit === 'false') return false

	const stage = configStore.state.isLoaded ? configStore.state.config.stage : process.env.APP_STAGE
	if (stage === 'staging') return true

	const env = process.env.NODE_ENV
	return env !== 'production' || isLocalDevHost()
}

export const NIP60_WALLET_DEV_MODE = isNip60WalletDevModeEnabled()

const loadPendingTokens = (): PendingToken[] => loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, [])

const savePendingTokens = (tokens: PendingToken[]): void => saveUserData(PENDING_TOKENS_KEY, tokens)

const loadAuctionTransferMessageIds = (): string[] => loadUserData<string[]>(AUCTION_TRANSFER_MESSAGE_IDS_KEY, [])

const saveAuctionTransferMessageIds = (messageIds: string[]): void => saveUserData(AUCTION_TRANSFER_MESSAGE_IDS_KEY, messageIds)

const updatePendingTokenRecord = (tokenId: string, updater: (token: PendingNip60Token) => PendingNip60Token): PendingNip60Token | null => {
	let updatedToken: PendingNip60Token | null = null
	const pendingTokens = nip60Store.state.pendingTokens.map((token) => {
		if (token.id !== tokenId) return token
		updatedToken = updater(token)
		return updatedToken
	})

	if (!updatedToken) return null

	savePendingTokens(pendingTokens)
	nip60Store.setState((s) => ({ ...s, pendingTokens }))
	return updatedToken
}

const markPendingTokensByBidEventIds = (bidEventIds: string[], status: PendingNip60Token['status']): void => {
	if (!bidEventIds.length) return
	const wanted = new Set(bidEventIds)
	const pendingTokens = nip60Store.state.pendingTokens.map((token) => {
		const context = token.context
		if (context?.kind !== 'auction_bid') return token
		if (!context.bidEventId || !wanted.has(context.bidEventId)) return token
		return { ...token, status }
	})
	savePendingTokens(pendingTokens)
	nip60Store.setState((s) => ({ ...s, pendingTokens }))
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

function extractPreimageCandidate(result: unknown): string | undefined {
	if (!result || typeof result !== 'object') return undefined
	const r = result as Record<string, unknown>

	const candidates = [
		r.preimage,
		r.payment_preimage,
		r.paymentPreimage,
		r.preimage_hex,
		r.preimageHex,
		(r.result as any)?.preimage,
		(r.response as any)?.preimage,
	].filter((v): v is string => typeof v === 'string' && v.length > 0)

	return candidates[0]
}

const getWalletPrivkeyForPubkey = (wallet: NDKCashuWallet, pubkey?: string): string | null => {
	if (!pubkey) return null
	return wallet.privkeys.get(pubkey)?.privateKey || null
}

const adoptWalletAccess = async (targetWallet: NDKCashuWallet, sourceWallet: NDKCashuWallet): Promise<void> => {
	for (const signer of sourceWallet.privkeys.values()) {
		if (signer.privateKey) {
			await targetWallet.addPrivkey(signer.privateKey)
		}
	}

	targetWallet.mints = Array.from(new Set([...(targetWallet.mints ?? []), ...(sourceWallet.mints ?? [])]))
	targetWallet.relaySet ??= sourceWallet.relaySet

	const sourceP2pk = await sourceWallet.getP2pk()
	const sourceSigner = sourceWallet.privkeys.get(sourceP2pk)
	if (sourceSigner?.privateKey) {
		;(targetWallet as NDKCashuWallet & { _p2pk?: string; signer?: NDKCashuWallet['signer'] })._p2pk = sourceP2pk
		targetWallet.signer = sourceSigner
	}
}

const loadWalletFromLatestEvent = async (ownerPubkey: string): Promise<NDKCashuWallet | null> => {
	const ndk = ndkStore.state.ndk
	if (!ndk) return null

	try {
		const events = Array.from(
			await ndkActions.fetchEventsWithTimeout(
				{
					kinds: [NIP60_WALLET_KIND],
					authors: [ownerPubkey],
					limit: 5,
				},
				{ timeoutMs: NIP60_WALLET_FETCH_TIMEOUT_MS },
			),
		)
		const walletEvent = events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] ?? null
		if (!walletEvent) return null

		const loadedWallet = await withTimeout(NDKCashuWallet.from(walletEvent), NIP60_WALLET_LOAD_TIMEOUT_MS, 'nip60 wallet reload')
		if (!loadedWallet) return null

		ensureWalletRuntimeDefaults(loadedWallet, ndk)
		return loadedWallet
	} catch (err) {
		console.warn('[nip60] Failed to reload wallet from latest event:', err)
		return null
	}
}

const resolveAuctionBidPendingContext = (pendingToken: PendingNip60Token): AuctionBidPendingTokenContext | null => {
	return pendingToken.context?.kind === 'auction_bid' ? pendingToken.context : null
}

const getOrCreateWalletP2pk = async (wallet: NDKCashuWallet): Promise<string> => {
	const hadPrivkeys = wallet.privkeys.size > 0
	const p2pk = await wallet.getP2pk()

	if (!hadPrivkeys && wallet.privkeys.size > 0) {
		try {
			await wallet.publish()
		} catch (err) {
			console.error('[nip60] Failed to persist generated wallet p2pk:', err)
		}
	}

	return p2pk
}

const getAuctionHdAccountFromWallet = async (wallet: NDKCashuWallet): Promise<HDKey> => {
	const walletP2pk = await getOrCreateWalletP2pk(wallet)
	const walletPrivkey = getWalletPrivkeyForPubkey(wallet, walletP2pk)
	if (!walletPrivkey) {
		throw new Error('Current wallet does not expose the auction HD root private key')
	}

	return getAuctionHdAccountFromWalletKeys(walletP2pk, walletPrivkey)
}

const receiveTokenIntoWallet = async (
	wallet: NDKCashuWallet,
	token: string,
	options?: {
		privkey?: string
	},
): Promise<{ amount: number; mintUrl: string }> => {
	const mintUrl = normalizeMintUrl(getTokenMetadata(token).mint)
	const proofsWeHave = getProofsForMint(wallet, mintUrl)
	const { cashuWallet, keysetId } = await createCashuWalletForMint(mintUrl)
	const receivedProofs = await cashuWallet.receive(token, {
		proofsWeHave,
		...(options?.privkey ? { privkey: options.privkey } : {}),
		...(keysetId ? { keysetId } : {}),
	})

	await wallet.state.update({
		store: receivedProofs,
		mint: mintUrl,
	})

	return {
		amount: receivedProofs.reduce((sum, proof) => sum + proof.amount, 0),
		mintUrl,
	}
}

const receiveTokenWithPrivkey = async (
	wallet: NDKCashuWallet,
	token: string,
	privkey: string,
): Promise<{ amount: number; mintUrl: string }> => receiveTokenIntoWallet(wallet, token, { privkey })

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
			// First, try to fetch the existing wallet event (kind 17375) with timeout.
			let walletEvent: NDKEvent | null = null
			try {
				const events = Array.from(
					await ndkActions.fetchEventsWithTimeout(
						{
							kinds: [NIP60_WALLET_KIND],
							authors: [pubkey],
							limit: 5,
						},
						{ timeoutMs: NIP60_WALLET_FETCH_TIMEOUT_MS },
					),
				)
				walletEvent = events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] ?? null
			} catch (fetchErr) {
				console.warn('[nip60] Wallet event fetch timed out or failed, continuing with empty wallet:', fetchErr)
			}

			let wallet: NDKCashuWallet

			if (walletEvent) {
				try {
					// Load wallet from existing event - this decrypts and loads mints/privkeys
					const loadedWallet = await withTimeout(
						NDKCashuWallet.from(walletEvent),
						NIP60_WALLET_LOAD_TIMEOUT_MS,
						'nip60 wallet decrypt/load',
					)
					if (!loadedWallet) {
						throw new Error('Failed to load wallet from event')
					}
					wallet = loadedWallet
				} catch (loadErr) {
					console.warn('[nip60] Failed to load wallet event, falling back to new wallet instance:', loadErr)
					wallet = new NDKCashuWallet(ndk)
				}
			} else {
				// No wallet event found - create a new wallet instance
				wallet = new NDKCashuWallet(ndk)
			}

			ensureWalletRuntimeDefaults(wallet, ndk)

			// Store wallet in state FIRST so event handlers can use it
			nip60Store.setState((s) => ({
				...s,
				wallet,
			}))

			// Subscribe to balance updates
			wallet.on('balance_updated', () => {
				const { totalBalance, mintBalances } = getBalancesFromState(wallet)
				nip60Store.setState((s) => ({
					...s,
					balance: totalBalance,
					mintBalances,
					mints: getAllMints(wallet),
				}))
			})

			// Listen for status changes
			wallet.on('status_changed', (status: NDKWalletStatus) => {
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

			// Start the wallet - this subscribes to token events and loads balance.
			// In local relay-only mode, this can hang if relays don't respond; force timeout so UI can recover.
			let startTimedOut = false
			try {
				await withTimeout(wallet.start({ pubkey }), NIP60_WALLET_START_TIMEOUT_MS, 'nip60 wallet start')
			} catch (startErr) {
				startTimedOut = true
				console.warn('[nip60] Wallet start timed out, continuing with fallback state:', startErr)
			}
			const { totalBalance, mintBalances } = getBalancesFromState(wallet)
			const allMints = getAllMints(wallet)

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
				if (!startTimedOut) {
					void nip60Actions.loadTransactions()
					// Perform a background cleanup pass so spent proofs are removed without manual refresh.
					void nip60Actions.runAutoCleanup({ force: true })
				}
			}

			// Load pending tokens from localStorage
			nip60Actions.loadPendingTokens()
			void nip60Actions.syncAuctionTransfers()
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
			const txs = await wallet.fetchTransactions()
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

		transactionUnsubscribe = wallet.subscribeTransactions((tx: NDKWalletTransaction) => {
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

			// Outgoing payments can leave stale proofs visible until consolidation.
			// Run cleanup in the background to keep balances accurate without manual refresh.
			if (tx.direction === 'out') {
				void nip60Actions.runAutoCleanup()
			}
		})
	},

	/**
	 * Consolidate spent proofs and refresh wallet state in the background.
	 * Uses dedupe + cooldown so we can call this from multiple lifecycle points safely.
	 */
	runAutoCleanup: async (options?: { force?: boolean; minIntervalMs?: number }): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) return

		const force = options?.force ?? false
		const minIntervalMs = options?.minIntervalMs ?? 30_000
		const now = Date.now()

		if (!force && now - lastAutoCleanupAt < minIntervalMs) return
		if (autoCleanupPromise) return await autoCleanupPromise

		autoCleanupPromise = (async () => {
			try {
				await nip60Actions.refresh({ consolidate: true })
				lastAutoCleanupAt = Date.now()
			} catch (err) {
				console.error('[nip60] Auto cleanup failed:', err)
			}
		})()

		try {
			await autoCleanupPromise
		} finally {
			autoCleanupPromise = null
		}
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
			const result = await NDKCashuWallet.create(wallet.ndk, mints)
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

	getWalletP2pk: async (): Promise<string> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		return await getOrCreateWalletP2pk(wallet)
	},

	getAuctionP2pkXpub: async (): Promise<string> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const account = await getAuctionHdAccountFromWallet(wallet)
		const xpub = account.publicExtendedKey
		if (!xpub) {
			throw new Error('Failed to derive auction hd xpub')
		}
		return xpub
	},

	getAuctionHdChildPrivkey: async (params: { derivationPath: string; expectedPubkey?: string }): Promise<string> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const account = await getAuctionHdAccountFromWallet(wallet)
		const xpriv = account.privateExtendedKey
		const xpub = account.publicExtendedKey
		if (!xpriv || !xpub) {
			throw new Error('Failed to derive auction hd account keys')
		}

		if (params.expectedPubkey) {
			const derivedPubkey = deriveChildPubkeyFromXpub(xpub, params.derivationPath)
			if (derivedPubkey !== params.expectedPubkey) {
				throw new Error('Auction bid child pubkey does not match current wallet-derived HD root')
			}
		}

		return deriveChildPrivkeyFromXpriv(xpriv, params.derivationPath)
	},

	getWalletPrivkey: (pubkey?: string): string | null => {
		const wallet = nip60Store.state.wallet
		if (!wallet) return null
		return getWalletPrivkeyForPubkey(wallet, pubkey)
	},

	ensureWalletPrivkey: async (pubkey?: string, ownerPubkey?: string): Promise<string | null> => {
		if (!pubkey) return null

		const currentWallet = nip60Store.state.wallet
		const existingPrivkey = currentWallet ? getWalletPrivkeyForPubkey(currentWallet, pubkey) : null
		if (existingPrivkey) return existingPrivkey

		const resolvedOwnerPubkey =
			ownerPubkey ??
			(await ndkStore.state.ndk?.signer
				?.user()
				.then((user) => user.pubkey)
				.catch(() => '')) ??
			''
		if (!resolvedOwnerPubkey) return null

		const loadedWallet = await loadWalletFromLatestEvent(resolvedOwnerPubkey)
		if (!loadedWallet) return null

		if (currentWallet) {
			await adoptWalletAccess(currentWallet, loadedWallet)
			nip60Store.setState((s) => ({ ...s, wallet: currentWallet }))
			return getWalletPrivkeyForPubkey(currentWallet, pubkey)
		}

		nip60Store.setState((s) => ({ ...s, wallet: loadedWallet }))
		return getWalletPrivkeyForPubkey(loadedWallet, pubkey)
	},

	updatePendingTokenContext: (tokenId: string, context: PendingTokenContext): PendingNip60Token | null => {
		return updatePendingTokenRecord(tokenId, (token) => ({
			...token,
			context,
		}))
	},

	markPendingAuctionBidTokensClaimed: (bidEventIds: string[]): void => {
		markPendingTokensByBidEventIds(bidEventIds, 'claimed')
	},

	consolidateProofs: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot consolidate without wallet')
			return
		}

		try {
			await consolidateWalletProofs(wallet)
		} catch (err) {
			console.error('[nip60] Failed to consolidate tokens:', err)
			throw err
		}
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

		// Consolidate tokens if requested - this checks for spent proofs
		if (shouldConsolidate) {
			try {
				await nip60Actions.consolidateProofs()
			} catch (err) {
				console.error('[nip60] Failed to consolidate tokens:', err)
				// Continue with refresh even if consolidation fails
			}
		}

		// Get balances directly from wallet state (source of truth)
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)

		nip60Store.setState((s) => ({
			...s,
			balance: totalBalance,
			mintBalances,
			mints: getAllMints(wallet),
		}))

		// Reload transactions
		await nip60Actions.loadTransactions()
		await nip60Actions.syncAuctionTransfers()
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
			await wallet.publish()
		} catch (err) {
			console.error('[nip60] Failed to publish wallet:', err)
			throw err
		}
	},

	/**
	 * Set the default mint for deposits
	 */
	setDefaultMint: (mintUrl: string | null): void => {
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
			wallet.mints = [...wallet.mints, targetMint]
		}

		try {
			nip60Store.setState((s) => ({
				...s,
				depositStatus: 'pending',
				error: null,
			}))

			const deposit = wallet.deposit(amount, targetMint)
			const invoice = await deposit.start()

			nip60Store.setState((s) => ({
				...s,
				activeDeposit: deposit,
				depositInvoice: invoice ?? null,
			}))

			// Listen for deposit completion
			deposit.on('success', (token) => {
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
		nip60Store.setState((s) => ({
			...s,
			activeDeposit: null,
			depositInvoice: null,
			depositStatus: 'idle',
		}))
	},

	/**
	 * Pay a Lightning invoice using this NIP-60 wallet.
	 * Returns preimage when the wallet provides it.
	 */
	payLightningInvoice: async (invoice: string): Promise<Nip60LightningPaymentResult> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const attemptPayInvoice = async (): Promise<Nip60LightningPaymentResult> => {
			const result = await wallet.lnPay({ pr: invoice })
			await new Promise((resolve) => setTimeout(resolve, 500))
			await nip60Actions.runAutoCleanup({ force: true, minIntervalMs: 0 })
			return { preimage: extractPreimageCandidate(result) }
		}

		try {
			return await attemptPayInvoice()
		} catch (err) {
			console.error('[nip60] Failed to pay lightning invoice (first attempt):', err)
			const errorMessage = err instanceof Error ? err.message : String(err)

			// Handle state sync errors - consolidate and retry
			const isStateError =
				errorMessage.toLowerCase().includes('already spent') ||
				errorMessage.toLowerCase().includes('token spent') ||
				errorMessage.toLowerCase().includes('proof not found')

			if (isStateError) {
				try {
					await nip60Actions.consolidateProofs()
					await nip60Actions.refresh()
					return await attemptPayInvoice()
				} catch (retryErr) {
					console.error('[nip60] Retry after consolidation failed:', retryErr)
					await nip60Actions.refresh()
					throw retryErr
				}
			}

			await nip60Actions.refresh()
			throw err
		}
	},

	/**
	 * Send a NIP-61 nutzap from this NIP-60 wallet.
	 */
	zapWithNutzap: async (params: { target: NDKEvent | NDKUser; amountSats: number; comment?: string }): Promise<Nip60NutzapResult> => {
		const wallet = nip60Store.state.wallet
		const ndk = ndkStore.state.ndk
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}
		if (!ndk || !ndk.signer) {
			throw new Error('NDK signer not available')
		}

		const { target, amountSats, comment } = params
		if (!Number.isFinite(amountSats) || amountSats <= 0) {
			throw new Error('Invalid zap amount')
		}

		const zapper = new NDKZapper(target, amountSats * 1000, 'msat', {
			ndk,
			signer: ndk.signer,
			comment,
			cashuPay: async (payment) => wallet.cashuPay(payment),
		})

		const results = await zapper.zap(['nip61'])
		const nutzap = Array.from(results.values()).find((result): result is NDKNutzap => result instanceof NDKNutzap)
		if (!nutzap) {
			const error = Array.from(results.values()).find((result): result is Error => result instanceof Error)
			throw new Error(error?.message || 'Failed to send nutzap')
		}

		await nip60Actions.runAutoCleanup({ force: true, minIntervalMs: 0 })
		return { eventId: nutzap.id, event: nutzap }
	},

	/**
	 * Withdraw to Lightning (melt ecash)
	 * @param invoice Lightning invoice to pay
	 */
	withdrawLightning: async (invoice: string): Promise<boolean> => {
		try {
			await nip60Actions.payLightningInvoice(invoice)
			return true
		} catch (err) {
			console.error('[nip60] Failed to withdraw:', err)
			throw err
		}
	},

	lockAuctionBidFunds: async (params: LockAuctionBidFundsParams): Promise<LockAuctionBidFundsResult> => {
		const wallet = nip60Store.state.wallet
		const state = nip60Store.state
		if (!wallet || state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const amount = Math.floor(params.amount)
		if (!Number.isFinite(amount) || amount <= 0) {
			throw new Error('Bid amount must be a positive integer')
		}

		const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
		const locktime = Math.floor(params.locktime)
		if (!Number.isFinite(locktime) || locktime <= 0) {
			throw new Error('Invalid bid locktime')
		}

		const refundPubkey = params.refundPubkey?.trim()
		if (!refundPubkey) {
			throw new Error('Refund pubkey is required')
		}

		const { totalBalance, mintBalances } = getBalancesFromState(wallet)
		let targetMint = params.mint ?? state.defaultMint ?? undefined
		if (!targetMint) {
			targetMint = Object.keys(mintBalances).find((mint) => mintBalances[mint] >= amount)
		}
		if (!targetMint) {
			throw new Error(`No mint with sufficient balance. Available: ${totalBalance} sats`)
		}

		const mintBalance = mintBalances[targetMint] ?? 0
		if (mintBalance < amount) {
			throw new Error(`Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`)
		}

		const xpub = params.p2pkXpub?.trim()
		if (!xpub) {
			throw new Error('Auction is missing p2pk_xpub')
		}

		const derivationPath = generateDerivationPath()
		const childPubkey = deriveChildPubkeyFromXpub(xpub, derivationPath)
		const lockPubkey = childPubkey

		const mintProofs = getProofsForMint(wallet, targetMint)
		if (mintProofs.length === 0) {
			throw new Error(`No proofs available at ${getMintHostname(targetMint)}. Try refreshing your wallet.`)
		}

		const { selected: selectedProofs, total: selectedTotal } = selectProofs(mintProofs, amount)
		if (selectedTotal < amount) {
			throw new Error(`Could not select enough proofs. Need ${amount}, have ${selectedTotal}`)
		}

		try {
			const { cashuWallet } = await createCashuWalletForMint(targetMint)

			const buildSendOptions = (includeDleq: boolean) => ({
				includeDleq,
				p2pk: {
					pubkey: lockPubkey,
					locktime,
					refundKeys: [refundPubkey],
				},
			})

			let lockedProofs: Proof[] = []
			let changeProofs: Proof[] = []

			try {
				const result = await cashuWallet.send(amount, selectedProofs, buildSendOptions(true))
				lockedProofs = result.send
				changeProofs = result.keep
			} catch (primaryErr) {
				const message = primaryErr instanceof Error ? primaryErr.message.toLowerCase() : String(primaryErr).toLowerCase()
				const insufficient = message.includes('not enough funds available to send')
				if (!insufficient) {
					throw primaryErr
				}

				try {
					// Some wallet states contain proofs without DLEQ metadata.
					// Retry without DLEQ requirement using full mint proofs for demo reliability.
					const retry = await cashuWallet.send(amount, mintProofs, buildSendOptions(false))
					lockedProofs = retry.send
					changeProofs = retry.keep
				} catch (secondaryErr) {
					const secondaryMessage = secondaryErr instanceof Error ? secondaryErr.message.toLowerCase() : String(secondaryErr).toLowerCase()
					const stillInsufficient = secondaryMessage.includes('not enough funds available to send')
					if (!stillInsufficient) {
						throw secondaryErr
					}

					// Last-resort path: reconcile wallet state, then retry once.
					try {
						await nip60Actions.consolidateProofs()
					} catch (consolidateErr) {
						console.error('[nip60] Consolidation during bid send retry failed:', consolidateErr)
					}

					const refreshedProofs = getProofsForMint(wallet, targetMint)
					const retryAfterConsolidate = await cashuWallet.send(amount, refreshedProofs, buildSendOptions(false))
					lockedProofs = retryAfterConsolidate.send
					changeProofs = retryAfterConsolidate.keep
				}
			}

			if (!lockedProofs.length) {
				throw new Error('Mint returned no locked proofs for bid')
			}

			const token = getEncodedToken({
				mint: targetMint,
				proofs: lockedProofs,
			})
			const tokenAmount = lockedProofs.reduce((sum, proof) => sum + proof.amount, 0)
			const tokenId = generateId()
			const pendingContext: AuctionBidPendingTokenContext | undefined =
				params.auctionEventId && params.sellerPubkey
					? {
							kind: 'auction_bid',
							auctionEventId: params.auctionEventId,
							auctionCoordinates: params.auctionCoordinates,
							sellerPubkey: params.sellerPubkey,
							escrowPubkey: lockPubkey,
							lockPubkey,
							refundPubkey,
							locktime,
						}
					: undefined

			const pendingToken: PendingNip60Token = {
				id: tokenId,
				token,
				amount: tokenAmount,
				mintUrl: targetMint,
				createdAt: Date.now(),
				status: 'pending',
				...(pendingContext ? { context: pendingContext } : {}),
			}
			const pendingTokens = [...nip60Store.state.pendingTokens, pendingToken]
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			// Wallet state reconciliation is intentionally async so bid publishing
			// is not blocked by local wallet maintenance operations.
			void (async () => {
				if (changeProofs.length > 0) {
					try {
						await wallet.state.update({
							store: changeProofs,
							mint: targetMint,
						})
					} catch (changeErr) {
						console.error('[nip60] Failed to receive bid change proofs (non-fatal):', changeErr)
					}
				}

				try {
					await nip60Actions.consolidateProofs()
				} catch (consolidateErr) {
					console.error('[nip60] Bid lock consolidation error (non-fatal):', consolidateErr)
				}

				try {
					await nip60Actions.refresh()
				} catch (refreshErr) {
					console.error('[nip60] Bid lock refresh error (non-fatal):', refreshErr)
				}
			})()

			const commitment = await sha256Hex(token)

			return {
				tokenId,
				token,
				amount: tokenAmount,
				mintUrl: targetMint,
				lockPubkey,
				locktime,
				refundPubkey,
				commitment,
				keyScheme,
				derivationPath,
				childPubkey,
			}
		} catch (err) {
			console.error('[nip60] Failed to lock auction bid funds:', err)
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
		if (mintBalance < amount) {
			throw new Error(`Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`)
		}

		// Get proofs for this mint using shared utility
		const mintProofs = getProofsForMint(wallet, targetMint)

		if (mintProofs.length === 0) {
			throw new Error(`No proofs available at ${getMintHostname(targetMint)}. Try refreshing your wallet.`)
		}

		// Select proofs to use
		const { selected: selectedProofs, total: selectedTotal } = selectProofs(mintProofs, amount)

		if (selectedTotal < amount) {
			throw new Error(`Could not select enough proofs. Need ${amount}, have ${selectedTotal}`)
		}

		try {
			const { cashuWallet } = await createCashuWalletForMint(targetMint)

			let tokenProofs: Proof[]
			let changeProofs: Proof[] = []

			if (selectedTotal === amount) {
				// Exact amount - use proofs directly
				tokenProofs = selectedProofs
			} else {
				// Need to swap for exact amount + change
				const swapResult = await cashuWallet.swap(amount, selectedProofs)
				tokenProofs = swapResult.send
				changeProofs = swapResult.keep
			}

			// Create the token
			const token = getEncodedToken({
				mint: targetMint,
				proofs: tokenProofs,
			})

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
					await wallet.state.update({
						store: changeProofs,
						mint: targetMint,
					})
				} catch (changeErr) {
					console.error('[nip60] Failed to add change proofs (will recover on consolidation):', changeErr)
				}
			}

			// Consolidate to sync state (detect spent proofs)
			try {
				await nip60Actions.consolidateProofs()
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
				try {
					await nip60Actions.consolidateProofs()
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
	 * Dev-only helper: mint free test ecash from configured dev mints into the NIP-60 wallet.
	 */
	mintTestEcash: async (
		amount: number,
		mintUrl: string = DEV_TEST_MINT_URL,
		options?: { allowFallback?: boolean },
	): Promise<Nip60TestMintResult> => {
		if (!isNip60WalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const mintAmount = Math.floor(amount)
		if (!Number.isFinite(mintAmount) || mintAmount <= 0) {
			throw new Error('Mint amount must be a positive integer')
		}
		const allowFallback = options?.allowFallback ?? true
		const normalizedPreferredMint = mintUrl.trim().replace(/\/$/, '')
		const candidates = allowFallback
			? getDevTestMintCandidates(mintUrl)
			: normalizedPreferredMint
				? [normalizedPreferredMint]
				: getDevTestMintCandidates(mintUrl)
		const failures: string[] = []

		for (const targetMint of candidates) {
			try {
				const { cashuWallet, keysetId } = await createCashuWalletForMint(targetMint)
				const quote = await cashuWallet.createMintQuote(mintAmount)
				const proofs = await cashuWallet.mintProofs(mintAmount, quote.quote, keysetId ? { keysetId } : undefined)

				if (!proofs.length) {
					throw new Error('Mint returned no proofs')
				}

				await wallet.state.update({
					store: proofs,
					mint: targetMint,
				})

				if (!wallet.mints.includes(targetMint)) {
					nip60Actions.addMint(targetMint)
				}
				if (!nip60Store.state.defaultMint) {
					nip60Actions.setDefaultMint(targetMint)
				}

				await nip60Actions.refresh()

				return {
					mintUrl: targetMint,
					amount: mintAmount,
					quoteId: quote.quote,
					proofsMinted: proofs.length,
				}
			} catch (err) {
				failures.push(`${targetMint}: ${getErrorMessage(err)}`)
			}
		}

		throw new Error(`Failed to mint test ecash from dev mints: ${failures.join('; ')}`)
	},

	/**
	 * Dev-only helper: pick a live seeded auction, top up with test ecash if needed, and publish a locked bid event.
	 */
	placeDevBidOnSeededAuction: async (params?: {
		preferredBidAmount?: number
		preferredMintUrl?: string
	}): Promise<Nip60DevAuctionBidResult> => {
		if (!isNip60WalletDevModeEnabled()) {
			throw new Error('Dev wallet actions are disabled in this environment')
		}

		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const ndk = ndkStore.state.ndk
		const signer = ndk?.signer
		if (!ndk || !signer) {
			throw new Error('NDK signer not available')
		}

		const bidderPubkey = (await signer.user()).pubkey
		const preferredMint = params?.preferredMintUrl ? normalizeMintUrl(params.preferredMintUrl) : ''
		const devMintCandidates = getDevTestMintCandidates(preferredMint)
		const now = Math.floor(Date.now() / 1000)

		const auctionEvents = Array.from(
			await ndkActions.fetchEventsWithTimeout(
				{
					kinds: [AUCTION_KIND],
					limit: 300,
				},
				{ timeoutMs: 8000 },
			),
		)

		type CandidateAuction = {
			event: NDKEvent
			dTag: string
			title: string
			startAt: number
			endAt: number
			startingBid: number
			bidIncrement: number
			acceptedMints: string[]
			escrowPubkey: string
			p2pkXpub: string
		}

		const candidates: CandidateAuction[] = auctionEvents
			.map((event) => {
				const dTag = getFirstTagValue(event, 'd')
				const title = getFirstTagValue(event, 'title') || 'Untitled Auction'
				const startAt = parseNonNegativeInt(getFirstTagValue(event, 'start_at'), 0)
				const endAt = parseNonNegativeInt(getFirstTagValue(event, 'end_at'), 0)
				const startingBid = parseNonNegativeInt(getFirstTagValue(event, 'starting_bid') || getFirstTagValue(event, 'price'), 0)
				const bidIncrement = Math.max(1, parseNonNegativeInt(getFirstTagValue(event, 'bid_increment'), 1))
				const acceptedMints = getTagValues(event, 'mint').map(normalizeMintUrl)
				const escrowPubkey = getFirstTagValue(event, 'escrow_pubkey') || event.pubkey
				const p2pkXpub = getFirstTagValue(event, 'p2pk_xpub')
				return { event, dTag, title, startAt, endAt, startingBid, bidIncrement, acceptedMints, escrowPubkey, p2pkXpub }
			})
			.filter((auction) => {
				if (!auction.dTag) return false
				if (auction.event.pubkey === bidderPubkey) return false
				if (auction.endAt <= now) return false
				if (auction.startAt > now) return false
				return true
			})
			.sort((a, b) => a.endAt - b.endAt)

		const selected =
			candidates.find((auction) => auction.acceptedMints.some((mint) => devMintCandidates.includes(mint))) ||
			candidates.find((auction) => auction.acceptedMints.length > 0)

		if (!selected) {
			throw new Error('No live seeded auction found for bidding')
		}

		const bidMint = selected.acceptedMints.find((mint) => devMintCandidates.includes(mint)) || selected.acceptedMints[0]
		const bidEvents = Array.from(
			await ndkActions.fetchEventsWithTimeout(
				{
					kinds: [AUCTION_BID_KIND],
					'#e': [selected.event.id],
					limit: 500,
				},
				{ timeoutMs: 8000 },
			),
		)
		const highestBid = bidEvents.reduce((max, bidEvent) => {
			const amount = parseNonNegativeInt(getFirstTagValue(bidEvent, 'amount'), 0)
			return amount > max ? amount : max
		}, selected.startingBid)

		const minBid = Math.max(selected.startingBid, highestBid + selected.bidIncrement)
		const requestedAmount = params?.preferredBidAmount ? Math.floor(params.preferredBidAmount) : minBid
		const bidAmount = Number.isFinite(requestedAmount) && requestedAmount >= minBid ? requestedAmount : minBid
		const previousBid = resolveLatestActiveBidByBidder(bidEvents, bidderPubkey)
		const previousAmount = previousBid ? parseNonNegativeInt(getFirstTagValue(previousBid, 'amount'), 0) : 0
		if (previousAmount > 0 && bidAmount <= previousAmount) {
			throw new Error(`Rebid must exceed your current bid of ${previousAmount.toLocaleString()} sats`)
		}

		const deltaAmount = Math.max(0, bidAmount - previousAmount)
		if (deltaAmount <= 0) {
			throw new Error('No additional funds required for this rebid')
		}

		const { mintBalances } = getBalancesFromState(wallet)
		const existingMintBalance = mintBalances[bidMint] ?? 0
		const topUpAmount = Math.max(0, deltaAmount - existingMintBalance)
		let effectiveBidMint = bidMint
		if (topUpAmount > 0) {
			const mintResult = await nip60Actions.mintTestEcash(topUpAmount, bidMint)
			effectiveBidMint = mintResult.mintUrl
		}

		const auctionCoordinates = `30408:${selected.event.pubkey}:${selected.dTag}`
		const locktime = Math.max(selected.endAt + AUCTION_SETTLEMENT_GRACE_SECONDS, now + 60)
		const bidderRefundPubkey = await nip60Actions.getWalletP2pk()
		const lockedBid = await nip60Actions.lockAuctionBidFunds({
			amount: deltaAmount,
			mint: effectiveBidMint,
			lockPubkey: selected.escrowPubkey,
			locktime,
			refundPubkey: bidderRefundPubkey,
			auctionEventId: selected.event.id,
			auctionCoordinates,
			sellerPubkey: selected.event.pubkey,
			p2pkXpub: selected.p2pkXpub,
		})
		const bidNonce = globalThis.crypto?.randomUUID?.() || generateId()

		const bidEvent = new NDKEvent(ndk)
		bidEvent.kind = 1023
		bidEvent.content = JSON.stringify({
			type: 'cashu_bid_commitment',
			amount: bidAmount,
			delta_amount: deltaAmount,
			prev_amount: previousAmount,
			mint: lockedBid.mintUrl,
			commitment: lockedBid.commitment,
			key_scheme: lockedBid.keyScheme,
			dev_mode: true,
		})
		bidEvent.tags = [
			['e', selected.event.id],
			['a', auctionCoordinates],
			['p', selected.event.pubkey],
			['amount', String(bidAmount), 'SAT'],
			['delta_amount', String(deltaAmount), 'SAT'],
			['currency', 'SAT'],
			['mint', lockedBid.mintUrl],
			['commitment', lockedBid.commitment],
			['locktime', String(lockedBid.locktime)],
			['refund_pubkey', lockedBid.refundPubkey],
			['created_for_end_at', String(selected.endAt)],
			['bid_nonce', bidNonce],
			['status', 'locked'],
			['schema', 'auction_bid_v1'],
			['key_scheme', lockedBid.keyScheme],
		]
		if (previousBid) {
			bidEvent.tags.push(['prev_bid', previousBid.id])
			bidEvent.tags.push(['prev_amount', String(previousAmount), 'SAT'])
		}
		if (lockedBid.derivationPath) {
			bidEvent.tags.push(['derivation_path', lockedBid.derivationPath])
		}
		if (lockedBid.childPubkey) {
			bidEvent.tags.push(['child_pubkey', lockedBid.childPubkey])
		}

		await bidEvent.sign(signer)
		const bidEnvelopeEvent = new NDKEvent(ndk)
		bidEnvelopeEvent.kind = AUCTION_TRANSFER_DM_KIND
		bidEnvelopeEvent.content = JSON.stringify({
			type: AUCTION_BID_TOKEN_TOPIC,
			auctionEventId: selected.event.id,
			auctionCoordinates,
			bidEventId: bidEvent.id,
			bidderPubkey,
			sellerPubkey: selected.event.pubkey,
			escrowPubkey: selected.escrowPubkey,
			refundPubkey: lockedBid.refundPubkey,
			lockPubkey: lockedBid.lockPubkey,
			locktime: lockedBid.locktime,
			mintUrl: lockedBid.mintUrl,
			amount: lockedBid.amount,
			totalBidAmount: bidAmount,
			commitment: lockedBid.commitment,
			bidNonce,
			token: lockedBid.token,
			createdAt: Date.now(),
		})
		bidEnvelopeEvent.tags = [
			['p', selected.escrowPubkey],
			['t', AUCTION_BID_TOKEN_TOPIC],
			['e', selected.event.id],
			['e', bidEvent.id, '', AUCTION_BID_ENVELOPE_MARKER],
			['a', auctionCoordinates],
			['mint', lockedBid.mintUrl],
			['commitment', lockedBid.commitment],
		]
		await bidEnvelopeEvent.encrypt(new NDKUser({ pubkey: selected.escrowPubkey }), signer, 'nip44')
		await bidEnvelopeEvent.sign(signer)
		await ndkActions.publishEvent(bidEnvelopeEvent)
		await ndkActions.publishEvent(bidEvent)
		nip60Actions.updatePendingTokenContext(lockedBid.tokenId, {
			kind: 'auction_bid',
			auctionEventId: selected.event.id,
			auctionCoordinates,
			bidEventId: bidEvent.id,
			sellerPubkey: selected.event.pubkey,
			escrowPubkey: selected.escrowPubkey,
			lockPubkey: lockedBid.lockPubkey,
			refundPubkey: lockedBid.refundPubkey,
			locktime: lockedBid.locktime,
		})

		return {
			bidEventId: bidEvent.id,
			auctionEventId: selected.event.id,
			auctionCoordinates,
			auctionTitle: selected.title,
			mintUrl: lockedBid.mintUrl,
			bidAmount,
			minBid,
			topUpAmount,
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
			await receiveTokenIntoWallet(wallet, token)

			// Refresh to update balance
			await nip60Actions.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to receive eCash:', err)
			throw err
		}
	},

	receiveLockedEcash: async (token: string, privkey: string): Promise<boolean> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot receive locked ecash without wallet')
			return false
		}

		try {
			await receiveTokenWithPrivkey(wallet, token, privkey)
			await nip60Actions.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to receive locked ecash:', err)
			throw err
		}
	},

	syncAuctionTransfers: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		const ndk = ndkStore.state.ndk
		const signer = ndk?.signer
		if (!wallet || !ndk || !signer || nip60Store.state.status !== 'ready') return

		const recipientPubkey = (await signer.user()).pubkey
		const processedIds = new Set(loadAuctionTransferMessageIds())
		const refundEvents = Array.from(
			await ndkActions.fetchEventsWithTimeout(
				{
					kinds: [AUCTION_TRANSFER_DM_KIND],
					'#p': [recipientPubkey],
					'#t': [AUCTION_REFUND_TOPIC],
					limit: 200,
				},
				{ timeoutMs: 4000 },
			),
		).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))

		let changed = false

		for (const event of refundEvents) {
			if (processedIds.has(event.id)) continue

			try {
				const decryptable = new NDKEvent(ndk, event.rawEvent())
				await decryptable.decrypt(new NDKUser({ pubkey: event.pubkey }), signer, 'nip44')
				const envelope = parseAuctionRefundEnvelope(decryptable.content)
				if (!envelope || envelope.recipientPubkey !== recipientPubkey) continue

				for (const refund of envelope.refunds) {
					await receiveTokenIntoWallet(wallet, refund.token)
				}

				markPendingTokensByBidEventIds(envelope.sourceBidEventIds, 'claimed')
				processedIds.add(event.id)
				changed = true
			} catch (err) {
				console.error('[nip60] Failed to sync auction refund message:', err)
			}
		}

		if (changed) {
			saveAuctionTransferMessageIds(Array.from(processedIds))
			await nip60Actions.refresh()
		}
	},

	/**
	 * Load pending tokens from localStorage
	 */
	loadPendingTokens: (): void => {
		const tokens = loadPendingTokens()
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
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

		try {
			const auctionContext = resolveAuctionBidPendingContext(pendingToken)
			const refundPrivkey = getWalletPrivkeyForPubkey(wallet, auctionContext?.refundPubkey)

			if (auctionContext && refundPrivkey) {
				await receiveTokenWithPrivkey(wallet, pendingToken.token, refundPrivkey)
			} else {
				await receiveTokenIntoWallet(wallet, pendingToken.token)
			}

			// Update status to reclaimed
			const pendingTokens = nip60Store.state.pendingTokens.map((t) => (t.id === tokenId ? { ...t, status: 'reclaimed' as const } : t))
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			// Refresh balances
			await nip60Actions.refresh()
			return true
		} catch (err) {
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
