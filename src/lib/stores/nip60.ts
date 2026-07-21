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
	auctionP2pkPubkeysMatch,
	deriveAuctionChildP2pkPubkeyFromXpub,
	getAuctionP2pkLockPubkeyFromSecret,
	normalizeAuctionDerivationPath,
	toCompressedAuctionP2pkPubkey,
} from '@/lib/auctionP2pk'
import { AUCTION_MIN_BID_LEG_SATS } from '@/lib/auction/constants'
import { getAuctionHdAccountFromWalletKeys } from '@/lib/auctionHd'
import {
	CashuMint,
	CashuWallet,
	CheckStateEnum,
	getDecodedToken,
	getEncodedToken,
	type MintKeys,
	type MintKeyset,
	type Proof,
} from '@cashu/cashu-ts'
import { getP2PKLocktime } from '@/lib/utils/cashu'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { NDKEvent, NDKNutzap, NDKRelaySet, NDKUser, NDKZapper, type NDKFilter, type NDKTag } from '@nostr-dev-kit/ndk'
import { NDKCashuDeposit, NDKCashuWallet, NDKWalletStatus, type NDKWalletTransaction } from '@nostr-dev-kit/wallet'
import { HDKey } from '@scure/bip32'
import { Store } from '@tanstack/store'
import { ndkActions, ndkStore } from './ndk'
import { configStore } from './config'
import { findBidderRecordByRefundPubkey } from '@/lib/auction/bidderRecords'

const DEFAULT_MINT_KEY = 'nip60_default_mint'
const PENDING_TOKENS_KEY = 'nip60_pending_tokens'

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
	/**
	 * Single mint URL — kept for backwards compatibility with non-auction
	 * callers (e.g. legacy lock flows). If both `mint` and
	 * `preferredMints` are provided, `mint` wins (interpreted as an
	 * explicit override). Most call sites should pass `preferredMints`.
	 */
	mint?: string
	/**
	 * Ordered list of trusted mints (seller-declared). Walked in order;
	 * the first mint where the bidder's wallet has at least `amount`
	 * sats is used. When omitted, falls back to the wallet's default
	 * mint or any mint with sufficient balance.
	 */
	preferredMints?: string[]
	locktime: number
	refundPubkey: string
	/**
	 * Child pubkey (compressed secp256k1 hex) issued by the auction's path
	 * oracle. This is the 1-of-1 P2PK spend key on the resulting locked
	 * Cashu proofs. The bidder MUST have already verified (via
	 * verifyAuctionPathGrant) that this pubkey was derived from the
	 * auction's p2pk_xpub before calling lockAuctionBidFunds.
	 */
	lockPubkey: string
	auctionEventId?: string
	auctionCoordinates?: string
	sellerPubkey?: string
	pathIssuerPubkey?: string
	derivationPath?: string
	childPubkey?: string
	grantId?: string
}

export interface LockAuctionBidFundsResult {
	tokenId: string
	token: string
	/**
	 * The locked Cashu proofs themselves — same set the encoded `token`
	 * holds, exposed as the structured proof array so callers don't have
	 * to re-decode (which fails on v2 short keyset IDs without a mint
	 * keyset map). Callers that need the proof's `secret` / `Y` lookup
	 * should read these directly.
	 */
	proofs: Proof[]
	amount: number
	mintUrl: string
	lockPubkey: string
	locktime: number
	refundPubkey: string
	commitment: string
	keyScheme: AuctionP2pkKeyScheme
	derivationPath?: string
	childPubkey?: string
	grantId?: string
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
/**
 * Default `settlement_grace` value (seconds) baked into a freshly-created
 * auction event. Per-auction grace is authoritative at bid time — the bidder
 * reads `settlement_grace` from the auction event itself (see AUCTIONS.md
 * §4.1). This constant only seeds the default; quick-settle dev fixtures
 * override to a much shorter value, see scripts/seed.ts.
 *
 * 7200s (2 h) gives the seller a comfortable window to publish the kind-1024
 * settlement after bidding closes, without locking losers' capital
 * unreasonably long.
 */
export const AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS = 7200
export const getAuctionSettlementGraceSeconds = (): number => AUCTION_SETTLEMENT_GRACE_DEFAULT_SECONDS
/**
 * Wall-clock skew buffer added on top of a proof's embedded P2PK locktime before
 * the client attempts a refund-path reclaim. Guards against the local clock
 * briefly racing ahead of the mint's, which would produce a
 * "Witness is missing for p2pk signature" error from the mint.
 */
export const AUCTION_RECLAIM_SKEW_BUFFER_SECONDS = 30
/**
 * Minimum wall-clock gap between auto-reclaim sweeps. Without this the sweep
 * would fire on every wallet refresh (and every bid) and hammer the mint with
 * /swap calls per pending token, causing HTTP 429s that block the bid flow.
 */
const AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS = 60_000
/** Exponential backoff (seconds) between successive reclaim retries per token. */
const AUCTION_RECLAIM_BACKOFF_SECONDS = [30, 120, 600, 1800, 7200]
/**
 * Substrings in a mint error message that indicate the refund path will never
 * work for this token — retrying burns rate-limit budget for no reason. These
 * come from cashu-ts / mint responses when the proof's lock secret can't be
 * satisfied with any key the wallet holds.
 */
const AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS = ['witness is missing', 'signature is not valid', 'spending conditions not met']
let auctionAutoReclaimLastSweepMs = 0

/**
 * Resolve the earliest-reclaim timestamp for a bid token. We prefer the
 * authoritative locktime embedded in each proof's NUT-11 P2PK secret, but fall
 * back to the caller-supplied `contextLocktime` (the value the bidder stashed
 * when they placed the bid) when the secret parse turns up no usable value —
 * otherwise a token whose secret isn't parseable would look "never ready" and
 * produce the misleading "in a moment" error. A small buffer is always added
 * on top to ride out client/mint clock drift.
 */
export const getAuctionReclaimReadyAt = (token: string, contextLocktime?: number): number => {
	const fallback = contextLocktime && contextLocktime > 0 ? contextLocktime : 0
	let maxLocktime = fallback
	try {
		const decoded = getDecodedToken(token)
		if (decoded?.proofs?.length) {
			for (const proof of decoded.proofs) {
				try {
					const locktime = getP2PKLocktime(proof.secret)
					if (Number.isFinite(locktime) && locktime > maxLocktime) maxLocktime = locktime
				} catch {
					// Proof isn't a P2PK secret — doesn't contribute a locktime.
				}
			}
		}
	} catch {
		// Token won't decode — rely on the context fallback below.
	}
	return maxLocktime + AUCTION_RECLAIM_SKEW_BUFFER_SECONDS
}

/** Human-readable "Xs / Xm / Xh" label for a pending-reclaim wait period. */
export const formatReclaimWaitSeconds = (seconds: number): string => {
	if (!Number.isFinite(seconds) || seconds <= 0) return 'a moment'
	if (seconds < 60) return `${Math.ceil(seconds)}s`
	const minutes = Math.ceil(seconds / 60)
	if (minutes < 60) return `${minutes}m`
	const hours = Math.ceil(seconds / 3600)
	return `${hours}h`
}

/** Helper for UI: compute the ready-at across every pending leg of a bid group. */
export const getAuctionReclaimReadyAtForGroup = (tokens: { token: string; context?: { locktime?: number } }[]): number => {
	if (!tokens.length) return 0
	return tokens.reduce((max, entry) => {
		const readyAt = getAuctionReclaimReadyAt(entry.token, entry.context?.locktime)
		return readyAt > max ? readyAt : max
	}, 0)
}

const getReclaimBackoffSeconds = (previousAttempts: number): number => {
	if (previousAttempts <= 0) return 0
	const index = Math.min(previousAttempts - 1, AUCTION_RECLAIM_BACKOFF_SECONDS.length - 1)
	return AUCTION_RECLAIM_BACKOFF_SECONDS[index]
}

const isPermanentReclaimFailure = (err: unknown): boolean => {
	const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
	return AUCTION_RECLAIM_PERMANENT_ERROR_KEYWORDS.some((keyword) => message.includes(keyword))
}

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

const primeDevTestMintDepositWalletCache = async (wallet: NDKCashuWallet, targetMint: string): Promise<void> => {
	const normalizedTargetMint = normalizeMintUrl(targetMint)

	if (!isNip60WalletDevModeEnabled()) return
	if (!NIP60_DEV_TEST_MINTS.includes(normalizedTargetMint)) return
	if (wallet.cashuWallets.has(normalizedTargetMint)) return

	const { cashuWallet } = await createCashuWalletForMint(normalizedTargetMint)
	wallet.cashuWallets.set(normalizedTargetMint, cashuWallet)
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

const deriveChildPrivkeyFromXpriv = (xpriv: string, path: string): string => {
	const hdRoot = HDKey.fromExtendedKey(xpriv.trim())
	const child = hdRoot.derive(normalizeAuctionDerivationPath(path))
	if (!child.privateKey) {
		throw new Error('Failed to derive child private key from auction xpriv')
	}
	return toHex(child.privateKey)
}

const getCompressedCashuPubkeyFromPrivkey = (privkey: string): string => toHex(secp256k1.getPublicKey(hexToUint8(privkey.trim()), true))

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')

const hexToUint8 = (hex: string): Uint8Array => {
	const normalized = hex.trim()
	if (normalized.length % 2 !== 0) {
		throw new Error('Hex string must have an even length')
	}
	const bytes = new Uint8Array(normalized.length / 2)
	for (let index = 0; index < normalized.length; index += 2) {
		bytes[index / 2] = parseInt(normalized.slice(index, index + 2), 16)
	}
	return bytes
}

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
	const exact = wallet.privkeys.get(pubkey)?.privateKey
	if (exact) return exact

	for (const [walletPubkey, signer] of wallet.privkeys.entries()) {
		if (auctionP2pkPubkeysMatch(walletPubkey, pubkey) && signer.privateKey) {
			return signer.privateKey
		}
	}

	return null
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

const getOrCreateWalletCashuP2pk = async (wallet: NDKCashuWallet): Promise<string> => {
	const walletP2pk = await getOrCreateWalletP2pk(wallet)
	const walletPrivkey = getWalletPrivkeyForPubkey(wallet, walletP2pk)
	if (!walletPrivkey) {
		throw new Error('Current wallet does not expose a private key for Cashu P2PK')
	}

	return getCompressedCashuPubkeyFromPrivkey(walletPrivkey)
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
		/**
		 * Caller-supplied mint URL. When provided we skip the top-level
		 * `getDecodedToken(token)` call entirely. Necessary when the
		 * token carries NUT-2 v2 short keyset IDs (cashu-ts ≥2.x default)
		 * — without a keyset map cashu-ts cannot decode and the call
		 * would throw "A short keyset ID v2 was encountered, but got no
		 * keysets to map it to." The seller settlement path knows the
		 * mint from the bid event, so it can pass it in.
		 */
		mintUrl?: string
	},
): Promise<{ amount: number; mintUrl: string }> => {
	// Resolve mint URL up front. Prefer the caller's explicit value to
	// avoid the v2-short-ID decode trap (see the option doc above). Fall
	// back to decoding the token only if no override was provided.
	let mintUrl: string
	if (options?.mintUrl) {
		mintUrl = normalizeMintUrl(options.mintUrl)
	} else {
		mintUrl = normalizeMintUrl(getDecodedToken(token).mint)
	}
	const proofsWeHave = getProofsForMint(wallet, mintUrl)
	const { cashuWallet, keysetId } = await createCashuWalletForMint(mintUrl)
	try {
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
	} catch (error) {
		throw error
	}
}

const receiveTokenWithPrivkey = async (
	wallet: NDKCashuWallet,
	token: string,
	privkey: string,
	mintUrl?: string,
): Promise<{ amount: number; mintUrl: string }> => receiveTokenIntoWallet(wallet, token, { privkey, mintUrl })

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

const getProofsTotal = (proofs: Proof[]): number => proofs.reduce((sum, proof) => sum + proof.amount, 0)

const lockAuctionBidProofs = async (
	cashuWallet: CashuWallet,
	amount: number,
	proofs: Proof[],
	params: {
		includeDleq: boolean
		lockPubkey: string
		locktime: number
		refundPubkey: string
	},
) => {
	const spendableProofs = params.includeDleq ? proofs.filter((proof) => proof.dleq != null) : proofs
	if (getProofsTotal(spendableProofs) < amount) {
		throw new Error('Not enough funds available to send')
	}

	// cashu-ts 2.9 `send()` ignores `p2pk` when existing proofs exactly
	// satisfy the amount. Use `swap()` so every auction bid always receives
	// freshly minted NUT-11 P2PK proofs.
	return cashuWallet.swap(amount, spendableProofs, {
		p2pk: {
			pubkey: params.lockPubkey,
			locktime: params.locktime,
			refundKeys: [params.refundPubkey],
		},
	})
}

const assertAuctionBidProofsLockedToP2pk = (proofs: Proof[], expectedLockPubkey: string): void => {
	for (const proof of proofs) {
		let proofLockPubkey: string
		try {
			proofLockPubkey = toCompressedAuctionP2pkPubkey(getAuctionP2pkLockPubkeyFromSecret(proof.secret))
		} catch (error) {
			throw new Error(`Mint returned an unlocked auction bid proof: ${error instanceof Error ? error.message : String(error)}`)
		}
		if (proofLockPubkey !== expectedLockPubkey) {
			throw new Error('Mint returned an auction bid proof locked to the wrong P2PK pubkey')
		}
	}
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

			if (typeof window !== 'undefined' && isNip60WalletDevModeEnabled()) {
				;(window as any).__nip60 = {
					mintTestEcash: nip60Actions.mintTestEcash,
					getStatus: () => ({
						status: nip60Store.state.status,
						balance: nip60Store.state.balance,
						mints: nip60Store.state.mints,
						mintBalances: nip60Store.state.mintBalances,
					}),
				}
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

	getWalletCashuP2pk: async (): Promise<string> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		return await getOrCreateWalletCashuP2pk(wallet)
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
			const derivedPubkey = deriveAuctionChildP2pkPubkeyFromXpub(xpub, params.derivationPath)
			if (!auctionP2pkPubkeysMatch(derivedPubkey, params.expectedPubkey)) {
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

		const targetMint = mint ? normalizeMintUrl(mint) : state.defaultMint ? normalizeMintUrl(state.defaultMint) : null
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

			await primeDevTestMintDepositWalletCache(wallet, targetMint)

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
			error: null,
		}))
	},

	/**
	 * Clear a completed deposit result from the UI.
	 *
	 * This is intentionally separate from cancelDeposit(): cancelDeposit() is
	 * for abandoning an active pending deposit, while this only clears terminal
	 * success/error UI state after the mint has already resolved the deposit.
	 */
	clearDepositResult: (): void => {
		const { depositStatus } = nip60Store.state
		if (depositStatus !== 'success' && depositStatus !== 'error') return

		nip60Store.setState((s) => ({
			...s,
			activeDeposit: null,
			depositInvoice: null,
			depositStatus: 'idle',
			error: null,
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
		const amount = Math.floor(params.amount)
		if (!Number.isFinite(amount) || amount < AUCTION_MIN_BID_LEG_SATS) {
			throw new Error(`Bid lock amount must be at least ${AUCTION_MIN_BID_LEG_SATS} sats`)
		}

		const wallet = nip60Store.state.wallet
		const state = nip60Store.state
		if (!wallet || state.status !== 'ready') {
			throw new Error('NIP-60 wallet not ready')
		}

		const keyScheme: AuctionP2pkKeyScheme = 'hd_p2pk'
		const locktime = Math.floor(params.locktime)
		if (!Number.isFinite(locktime) || locktime <= 0) {
			throw new Error('Invalid bid locktime')
		}

		const rawRefundPubkey = params.refundPubkey?.trim()
		if (!rawRefundPubkey) {
			throw new Error('Refund pubkey is required')
		}
		let refundPubkey: string
		try {
			refundPubkey = toCompressedAuctionP2pkPubkey(rawRefundPubkey)
		} catch (error) {
			throw new Error(`Refund pubkey is invalid: ${error instanceof Error ? error.message : String(error)}`)
		}

		const rawLockPubkey = params.lockPubkey?.trim()
		if (!rawLockPubkey) {
			throw new Error('Lock pubkey is required — the bidder must obtain a path grant before locking')
		}
		let lockPubkey: string
		try {
			lockPubkey = toCompressedAuctionP2pkPubkey(rawLockPubkey)
		} catch (error) {
			throw new Error(`Lock pubkey is invalid: ${error instanceof Error ? error.message : String(error)}`)
		}

		// Mint selection order (AUCTIONS.md §4.1 + bid flow):
		//   1. `params.mint` explicit override — legacy callers only.
		//   2. `params.preferredMints` in order — auction's trusted mints
		//      walked seller-declared first; pick the first one where the
		//      bidder has enough balance for `amount` (delta).
		//   3. wallet's `defaultMint` — only when no preferred list given.
		//   4. any mint in the wallet with enough balance — last resort.
		// Falling through all four with no match yields a clear error
		// listing per-trusted-mint balances so the bidder knows where
		// to top up.
		const { totalBalance, mintBalances } = getBalancesFromState(wallet)
		let targetMint: string | undefined
		if (params.mint) {
			targetMint = params.mint
		} else if (params.preferredMints && params.preferredMints.length > 0) {
			targetMint = params.preferredMints.find((mint) => (mintBalances[mint] ?? 0) >= amount)
			if (!targetMint) {
				const breakdown = params.preferredMints.map((mint) => `${getMintHostname(mint)}: ${mintBalances[mint] ?? 0} sats`).join(', ')
				throw new Error(
					`No trusted mint has ${amount} sats. ${breakdown}. Deposit to one of the auction's trusted mints (or move existing funds there) and try again.`,
				)
			}
		} else if (state.defaultMint && (mintBalances[state.defaultMint] ?? 0) >= amount) {
			targetMint = state.defaultMint
		} else {
			targetMint = Object.keys(mintBalances).find((mint) => mintBalances[mint] >= amount)
		}
		if (!targetMint) {
			throw new Error(`No mint with sufficient balance. Available: ${totalBalance} sats`)
		}

		const mintBalance = mintBalances[targetMint] ?? 0
		if (mintBalance < amount) {
			throw new Error(`Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`)
		}

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

			// 1-of-1 P2PK lock. The seller alone cannot spend pre-locktime because
			// the derivation path that produced `lockPubkey` is held secret by the
			// auction's path oracle — see AUCTIONS.md §5.2.
			const buildLockOptions = (includeDleq: boolean) => ({
				includeDleq,
				lockPubkey,
				locktime,
				refundPubkey,
			})

			let lockedProofs: Proof[] = []
			let changeProofs: Proof[] = []

			try {
				const result = await lockAuctionBidProofs(cashuWallet, amount, selectedProofs, buildLockOptions(true))
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
					const retry = await lockAuctionBidProofs(cashuWallet, amount, mintProofs, buildLockOptions(false))
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
					const retryAfterConsolidate = await lockAuctionBidProofs(cashuWallet, amount, refreshedProofs, buildLockOptions(false))
					lockedProofs = retryAfterConsolidate.send
					changeProofs = retryAfterConsolidate.keep
				}
			}

			if (!lockedProofs.length) {
				throw new Error('Mint returned no locked proofs for bid')
			}
			assertAuctionBidProofsLockedToP2pk(lockedProofs, lockPubkey)

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
							pathIssuerPubkey: params.pathIssuerPubkey || '',
							lockPubkey,
							refundPubkey,
							locktime,
							derivationPath: params.derivationPath,
							childPubkey: params.childPubkey,
							grantId: params.grantId,
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

			// Apply the wallet-state delta SYNCHRONOUSLY before returning so
			// the balance UI doesn't briefly double-count the consumed
			// inputs. The mint already burned `selectedProofs` during the
			// swap, so we MUST pass them as `destroy:` — otherwise local
			// state retains them alongside the new `changeProofs` and the
			// displayed balance over-reports by `selectedTotal - amount`.
			// (The previous version offloaded this to a void-async block
			// + NUT-7 consolidation, which races the UI: refresh before
			// consolidation lands and you see the inflated number.)
			try {
				await wallet.state.update({
					mint: targetMint,
					store: changeProofs,
					destroy: selectedProofs,
				})
				// Synchronously re-read balance from wallet.state into the
				// store so the UI updates immediately (avoids a stale
				// inflated display until the async consolidation lands).
				const { totalBalance, mintBalances } = getBalancesFromState(wallet)
				nip60Store.setState((s) => ({
					...s,
					balance: totalBalance,
					mintBalances,
					mints: getAllMints(wallet),
				}))
			} catch (stateErr) {
				console.error('[nip60] Failed to reconcile wallet state after bid lock (non-fatal):', stateErr)
			}

			// Note: we used to also kick off `consolidateProofs()` here
			// in a void async block. That's no longer needed — `destroy:
			// selectedProofs` above already removes the spent proofs
			// locally, so we don't have to NUT-7-check them to discover
			// they're spent. Removing the consolidate eliminates a per-
			// bid mint round-trip (and the CORS / 429 noise it produced
			// against testnut).

			const commitment = await sha256Hex(token)

			return {
				tokenId,
				token,
				proofs: lockedProofs,
				amount: tokenAmount,
				mintUrl: targetMint,
				lockPubkey,
				locktime,
				refundPubkey,
				commitment,
				keyScheme,
				derivationPath: params.derivationPath,
				childPubkey: params.childPubkey || lockPubkey,
				grantId: params.grantId,
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
		if (!wallet || (nip60Store.state.status !== 'ready' && nip60Store.state.status !== 'no_wallet')) {
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

				if (nip60Store.state.status !== 'ready') {
					nip60Store.setState((s) => ({ ...s, status: 'ready' }))
				}

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
	 * Dev-only helper: pick a live seeded auction on the user's relays,
	 * top up the wallet with test ecash if needed, and publish a bid via
	 * the bidder-held-path flow. Restored in Phase 3 — delegates the
	 * heavy lifting to `publishAuctionBid` so this helper stays a thin
	 * UX wrapper rather than reimplementing the bid pipeline.
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

		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()
		if (!ndk) throw new Error('NDK not initialised')
		if (!signer) throw new Error('No signer available')
		const bidder = await signer.user()

		// Find a live auction. We pull recent kind-30408 events and
		// filter to ones that (a) we're not the seller of and (b) still
		// have time on the clock.
		const now = Math.floor(Date.now() / 1000)
		const auctions = Array.from(await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_KIND], limit: 100 }, { timeoutMs: 5000 }))
		const candidates = auctions.filter((auction) => {
			if (auction.pubkey === bidder.pubkey) return false
			const endAt = parseNonNegativeInt(getFirstTagValue(auction, 'end_at'), 0)
			const maxEndAt = parseNonNegativeInt(getFirstTagValue(auction, 'max_end_at'), 0) || endAt
			if (!endAt || maxEndAt <= now) return false
			const startAt = parseNonNegativeInt(getFirstTagValue(auction, 'start_at'), 0)
			if (startAt && startAt > now) return false
			return true
		})
		if (!candidates.length) throw new Error('No live seeded auction available to bid on')
		const selected = candidates[Math.floor(Math.random() * candidates.length)]

		// Pull the auction fields the publish flow needs.
		const dTag = getFirstTagValue(selected, 'd')
		const auctionCoordinates = dTag ? `${AUCTION_KIND}:${selected.pubkey}:${dTag}` : ''
		if (!auctionCoordinates) throw new Error('Selected auction has no `d` tag')
		const p2pkXpub = getFirstTagValue(selected, 'p2pk_xpub')
		if (!p2pkXpub) throw new Error('Selected auction is missing p2pk_xpub')
		const startAt = parseNonNegativeInt(getFirstTagValue(selected, 'start_at'), 0)
		const endAt = parseNonNegativeInt(getFirstTagValue(selected, 'end_at'), 0)
		const maxEndAt = parseNonNegativeInt(getFirstTagValue(selected, 'max_end_at'), 0) || endAt
		const settlementGraceSeconds =
			parseNonNegativeInt(getFirstTagValue(selected, 'settlement_grace'), 0) || getAuctionSettlementGraceSeconds()
		const startingBid = parseNonNegativeInt(getFirstTagValue(selected, 'starting_bid'), 0)
		const bidIncrement = parseNonNegativeInt(getFirstTagValue(selected, 'bid_increment'), 0) || 100
		const trustedMints = selected.tags.filter((tag) => tag[0] === 'mint' && tag[1]).map((tag) => tag[1])

		// Decide the bid amount: caller's preference, or a minimum
		// increment over the current top bid.
		const existingBids = Array.from(
			await ndkActions.fetchEventsWithTimeout({ kinds: [AUCTION_BID_KIND], '#e': [selected.id], limit: 200 }, { timeoutMs: 5000 }),
		)
		const currentTop = existingBids.reduce((max, bid) => {
			const amount = parseNonNegativeInt(getFirstTagValue(bid, 'amount'), 0)
			return amount > max ? amount : max
		}, 0)
		const minBid = currentTop > 0 ? currentTop + bidIncrement : startingBid
		const preferred = params?.preferredBidAmount ? Math.floor(params.preferredBidAmount) : minBid
		const bidAmount = Math.max(minBid, Number.isFinite(preferred) && preferred > 0 ? preferred : minBid)

		// Top up the wallet at the chosen mint if it can't cover the
		// bid. mintTestEcash works against the public testnut mints
		// only — that's a dev-only assumption, fine here.
		const mintForLock = params?.preferredMintUrl?.trim() || trustedMints[0]
		if (!mintForLock) throw new Error('Selected auction has no trusted mint')
		const { mintBalances } = getBalancesFromState(wallet)
		const balanceAtMint = mintBalances[mintForLock] ?? 0
		if (balanceAtMint < bidAmount) {
			const topUpAmount = bidAmount - balanceAtMint + 1000 // small safety buffer for fees / future bids
			await nip60Actions.mintTestEcash(topUpAmount, mintForLock)
		}

		const { publishAuctionBid } = await import('@/publish/auctions')
		type AuctionBidFormData = Parameters<typeof publishAuctionBid>[0]
		const formData: AuctionBidFormData = {
			auctionEventId: selected.id,
			auctionCoordinates,
			amount: bidAmount,
			auctionStartAt: startAt,
			auctionEffectiveEndAt: maxEndAt,
			auctionLocktimeAt: maxEndAt,
			settlementGraceSeconds,
			sellerPubkey: selected.pubkey,
			// Legacy field kept for back-compat with the publish form.
			// publishAuctionBid no longer uses it for path issuance.
			pathIssuerPubkey: '',
			p2pkXpub,
			mintCandidates: trustedMints.length ? trustedMints : [mintForLock],
		}

		const bidEventId = await publishAuctionBid(formData, signer, ndk)

		return {
			bidEventId,
			auctionEventId: selected.id,
			auctionCoordinates,
			auctionTitle: getFirstTagValue(selected, 'title') || 'untitled',
			mintUrl: mintForLock,
			bidAmount,
			minBid,
			topUpAmount: Math.max(0, bidAmount - balanceAtMint),
		}
	},

	/**
	 * Dev/wallet helper: settle one of the user's bids by publishing
	 * the kind-1025 path release. Thin wrapper over
	 * `publishBidderPathRelease` for the wallet dev panel (so the
	 * happy path is one click away from the existing
	 * `placeDevBidOnSeededAuction` helper).
	 */
	settleAuctionAsWinner: async (params: {
		bidEventId: string
		releaseReason?: 'settlement' | 'fallback_settlement' | 'voluntary_late'
		note?: string
	}): Promise<{ pathReleaseEventId: string }> => {
		const ndk = ndkActions.getNDK()
		const signer = ndkActions.getSigner()
		if (!ndk) throw new Error('NDK not initialised')
		if (!signer) throw new Error('No signer available')
		const { publishBidderPathRelease } = await import('@/publish/auctions')
		const result = await publishBidderPathRelease(
			{ bidEventId: params.bidEventId, releaseReason: params.releaseReason, note: params.note },
			signer,
			ndk,
		)
		return { pathReleaseEventId: result.pathReleaseEventId }
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

	/**
	 * Receive a P2PK-locked Cashu token and swap it into the wallet's
	 * spendable proofs. The caller MUST pass the unlocking `privkey`
	 * derived from `seller_xpriv + derivation_path`. `mintUrl` is
	 * optional but strongly recommended: cashu-ts ≥2.x emits NUT-2 v2
	 * short keyset IDs by default, and `getDecodedToken(token)`
	 * without a keyset map cannot expand them — it throws "A short
	 * keyset ID v2 was encountered, but got no keysets to map it to."
	 * The seller settlement path knows the mint from the winning bid
	 * event, so it can pass it in and skip the decode-to-find-mint
	 * step entirely.
	 */
	receiveLockedEcash: async (token: string, privkey: string, mintUrl?: string): Promise<boolean> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			console.warn('[nip60] Cannot receive locked ecash without wallet')
			return false
		}

		try {
			await receiveTokenWithPrivkey(wallet, token, privkey, mintUrl)
			await nip60Actions.refresh()
			return true
		} catch (err) {
			console.error('[nip60] Failed to receive locked ecash:', err)
			throw err
		}
	},

	/**
	 * Fetch a mint's current keysets — required to pass into
	 * `getDecodedToken` for tokens that carry NUT-2 v2 short keyset
	 * IDs (cashu-ts ≥2.x emits these by default). Used by the
	 * auction settlement preflight before `getDecodedToken`.
	 *
	 * Returns an empty array on failure — callers should treat this
	 * as "decode without keysets and hope the token uses long IDs",
	 * which is fine for older tokens but will surface the original
	 * "short keyset ID" error for new ones, giving the seller a
	 * useful actionable message instead of a silent hang.
	 */
	loadAuctionMintKeysets: async (mintUrl: string): Promise<import('@cashu/cashu-ts').MintKeyset[]> => {
		try {
			const { cashuWallet } = await createCashuWalletForMint(mintUrl)
			return cashuWallet.keysets
		} catch (err) {
			console.warn(`[nip60] loadAuctionMintKeysets failed for ${getMintHostname(mintUrl)}:`, err)
			return []
		}
	},

	/**
	 * Auction transfer sweep — under the path-oracle profile this is just
	 * the locktime-refund auto-sweep (AUCTIONS.md §8.1). The legacy
	 * `auction_refund_v1` DM ingestion has been removed: refund delivery
	 * isn't part of the v1 path-oracle protocol because the issuer holds
	 * no Cashu key material and can't proactively spend a loser's locked
	 * proofs (see spec §8.1). Losing bidders self-refund here.
	 */
	syncAuctionTransfers: async (): Promise<void> => {
		await nip60Actions.autoReclaimTimelockedBids()
	},

	/**
	 * Load pending tokens from localStorage
	 */
	loadPendingTokens: (): void => {
		const tokens = loadPendingTokens()
		nip60Store.setState((s) => ({ ...s, pendingTokens: tokens }))
	},

	/**
	 * Reclaim a pending token (if the recipient hasn't claimed it yet).
	 *
	 * Source of truth for the timelock is the Cashu proof secret itself, not the
	 * cached auction context (which may be stale/missing from an older session).
	 * A small skew buffer guards against the local clock briefly leading the
	 * mint's. Errors propagate so the caller can show the real message. A
	 * manual invocation resets `reclaimPermanentlyFailed` so the user can
	 * retry tokens auto-reclaim has given up on.
	 */
	reclaimToken: async (tokenId: string, options?: { manual?: boolean }): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet) {
			throw new Error('Wallet not initialized')
		}

		const pendingToken = nip60Store.state.pendingTokens.find((t) => t.id === tokenId)
		if (!pendingToken) {
			throw new Error('Pending token not found')
		}

		const auctionContext = resolveAuctionBidPendingContext(pendingToken)
		const now = Math.floor(Date.now() / 1000)
		const reclaimReadyAt = getAuctionReclaimReadyAt(pendingToken.token, auctionContext?.locktime)
		if (reclaimReadyAt > now) {
			const waitSeconds = reclaimReadyAt - now
			throw new Error(`Bid refund opens in ${formatReclaimWaitSeconds(waitSeconds)}`)
		}

		// Look up the refund privkey from three sources in order of
		// preference:
		//
		//   1. The auction's BidderBidRecord (`refundPrivateKey`). This
		//      is THE authoritative store under cashu_p2pk_bidder_path_v1
		//      — each bid leg generates a fresh refund keypair at lock
		//      time and persists the privkey there. Refund keys are
		//      intentionally NOT added to `wallet.privkeys` because that
		//      map is for the wallet's general signing keys; mixing in
		//      per-bid throwaway keys would bloat it across many bids.
		//   2. The wallet's `privkeys` map. Legacy path; covers older
		//      bids placed before the BidderBidRecord scheme existed and
		//      provides a safety net if the local record is missing but
		//      the user happens to also hold the privkey in their wallet.
		//   3. None → stop. Without the privkey the timelock refund
		//      branch can't be signed; falling through would just spam
		//      the mint with "witness missing" 4xx responses.
		const bidderRecord = auctionContext ? findBidderRecordByRefundPubkey(auctionContext.refundPubkey) : null
		const refundPrivkey =
			bidderRecord?.refundPrivateKey ?? (auctionContext ? getWalletPrivkeyForPubkey(wallet, auctionContext.refundPubkey) : null)

		if (auctionContext && !refundPrivkey) {
			const walletPrivkeyCount = wallet.privkeys.size
			console.warn(
				`[nip60] Reclaim aborted: no refund privkey found for refundPubkey ${auctionContext.refundPubkey} ` +
					`(checked BidderBidRecord + wallet.privkeys; wallet holds ${walletPrivkeyCount} privkey(s)). ` +
					`The bid was likely placed with a different browser/profile or local storage was cleared.`,
			)
			const reason =
				"This device does not hold the refund private key for this bid. The key only exists in the wallet that originally placed the bid (per-bid refund keys are stored in localStorage and aren't synced). Locked sats stay at the mint until that device reclaims them."
			const updatedTokens = nip60Store.state.pendingTokens.map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: (t.reclaimAttempts ?? 0) + 1,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Key mismatch is permanent — a new privkey won't
							// appear. Mark so auto-reclaim skips forever. A
							// manual retry from the UI will clear the flag in
							// case the user imports the original wallet later.
							reclaimPermanentlyFailed: !options?.manual,
						}
					: t,
			)
			savePendingTokens(updatedTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens: updatedTokens }))
			throw new Error(reason)
		}

		try {
			if (refundPrivkey) {
				await receiveTokenWithPrivkey(wallet, pendingToken.token, refundPrivkey, pendingToken.mintUrl)
			} else {
				// Non-auction pending token (e.g. a regular sendEcash token
				// the recipient hasn't claimed). Best-effort unsigned receive.
				await receiveTokenIntoWallet(wallet, pendingToken.token)
			}

			// Mark reclaimed so auto-reclaim won't retry it.
			const pendingTokens = nip60Store.state.pendingTokens.map((t) =>
				t.id === tokenId
					? {
							...t,
							status: 'reclaimed' as const,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: undefined,
							reclaimPermanentlyFailed: false,
						}
					: t,
			)
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			await nip60Actions.refresh()
		} catch (err) {
			const attempts = (pendingToken.reclaimAttempts ?? 0) + 1
			const permanent = isPermanentReclaimFailure(err)
			const reason = err instanceof Error ? err.message : String(err)
			const pendingTokens = nip60Store.state.pendingTokens.map((t) =>
				t.id === tokenId
					? {
							...t,
							reclaimAttempts: attempts,
							lastReclaimAttemptAt: now,
							reclaimFailureReason: reason,
							// Manual retry resets the "permanent" flag so the user can try again.
							reclaimPermanentlyFailed: options?.manual ? false : permanent || t.reclaimPermanentlyFailed,
						}
					: t,
			)
			savePendingTokens(pendingTokens)
			nip60Store.setState((s) => ({ ...s, pendingTokens }))

			console.error('[nip60] Failed to reclaim token:', err)
			throw err
		}
	},

	/**
	 * Silently reclaim every pending auction bid whose P2PK timelock has expired.
	 * Throttled to at most one sweep per AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS and
	 * skips tokens that are in cooldown or marked permanently-failed, so a bad
	 * token can't loop the bid flow into 429s from the mint.
	 */
	autoReclaimTimelockedBids: async (): Promise<void> => {
		const wallet = nip60Store.state.wallet
		if (!wallet || nip60Store.state.status !== 'ready') return

		const nowMs = Date.now()
		if (nowMs - auctionAutoReclaimLastSweepMs < AUCTION_AUTO_RECLAIM_MIN_INTERVAL_MS) return
		auctionAutoReclaimLastSweepMs = nowMs

		const now = Math.floor(nowMs / 1000)
		const candidates = nip60Store.state.pendingTokens.filter((token) => {
			if (token.status !== 'pending') return false
			if (token.reclaimPermanentlyFailed) return false
			const context = resolveAuctionBidPendingContext(token)
			if (!context) return false
			if (getAuctionReclaimReadyAt(token.token, context.locktime) > now) return false
			// Exponential backoff per token so a transient mint error doesn't
			// turn into a tight retry loop.
			const cooldown = getReclaimBackoffSeconds(token.reclaimAttempts ?? 0)
			const last = token.lastReclaimAttemptAt ?? 0
			return now - last >= cooldown
		})

		for (const token of candidates) {
			try {
				await nip60Actions.reclaimToken(token.id)
			} catch (err) {
				console.warn(`[nip60] Auto-reclaim skipped for token ${token.id}:`, err instanceof Error ? err.message : err)
			}
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
	 * Bulk-remove pending tokens by id. Used by the Bids UI to drop orphaned
	 * lock attempts from localStorage in one click. Does NOT touch the mint
	 * — the locked sats stay there and can only be reclaimed by a wallet that
	 * still holds the original refund privkey.
	 */
	removePendingTokens: (tokenIds: string[]): number => {
		if (!tokenIds.length) return 0
		const idSet = new Set(tokenIds)
		const before = nip60Store.state.pendingTokens.length
		const pendingTokens = nip60Store.state.pendingTokens.filter((t) => !idSet.has(t.id))
		if (pendingTokens.length === before) return 0
		savePendingTokens(pendingTokens)
		nip60Store.setState((s) => ({ ...s, pendingTokens }))
		return before - pendingTokens.length
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
